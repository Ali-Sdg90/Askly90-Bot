require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

// اگر Node.js نسخهٔ قدیمی داری و global fetch وجود نداره، از node-fetch استفاده کن
let fetchFunction = global.fetch;
if (!fetchFunction) {
    // dynamic import so module only required when needed
    fetchFunction = (...args) =>
        import("node-fetch").then(({ default: nf }) => nf(...args));
}

// --- Environment variables ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL;
const SERVER_URL = process.env.SERVER_URL;
const SERVER_PORT = process.env.PORT || 3000;

// new envs
// ALLOWED_TELEGRAM_IDS should be a comma-separated list of numeric telegram ids.
// If empty or not set => allow everyone.
const rawAllowedIds = (process.env.ALLOWED_TELEGRAM_IDS || "").trim();
const ALLOWED_TELEGRAM_IDS = rawAllowedIds
    ? rawAllowedIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
    : [];
const allowedTelegramIdsSet = new Set(ALLOWED_TELEGRAM_IDS.map(String));

// usage limit per 24 hours (default 20)
const USAGE_LIMIT_PER_24H = parseInt(
    process.env.USAGE_LIMIT_PER_24H || "20",
    10
);

// sanity checks
if (!BOT_TOKEN) {
    console.error(
        "Missing BOT_TOKEN in environment. Set BOT_TOKEN in your .env file."
    );
    process.exit(1);
}
if (!SERVER_URL) {
    console.error(
        "Missing SERVER_URL in environment. Set SERVER_URL (e.g. https://example.com)."
    );
    process.exit(1);
}
if (!PERPLEXITY_API_KEY) {
    console.warn(
        "Warning: PERPLEXITY_API_KEY not set. Perplexity calls will fail until you set it."
    );
}

// --- Initialize bot and webserver ---
const telegramBot = new Telegraf(BOT_TOKEN);
const webApp = express();
webApp.use(bodyParser.json());

const allowedOrigins = [
    "http://172.19.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
];

webApp.use(
    cors({
        origin: function (origin, callback) {
            // اگر origin undefined باشه (مثلاً درخواست server-to-server یا curl)، اجازه بده
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error("Not allowed by CORS"), false);
        },
        credentials: true,
    })
);

// کمک برای کش پراکسی‌ها
webApp.use((_req, res, next) => {
    res.setHeader("Vary", "Origin");
    next();
});

// --- In-memory reservation store (use Redis/DB in production) ---
const reservationStore = new Map();
/*
reservation object shape:
{
  reservationId,
  userQuery,
  creatorTelegramId,    // user who initiated / chose inline result
  privateMessageId,     // message_id of placeholder sent by bot in user's PM
  status,               // "pending" | "ready" | "failed"
  answerText,
  createdAtTimestamp
}
*/

// --- Usage tracking (24h sliding window) ---
const usageMap = new Map(); // userId (string) -> array of timestamps (ms)

function pruneUsageArray(arr) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
    return arr.filter((t) => t > cutoff);
}

function getUsageCount(userId) {
    const key = String(userId);
    const arr = usageMap.get(key) || [];
    const pruned = pruneUsageArray(arr);
    usageMap.set(key, pruned);
    return pruned.length;
}

function incrementUsage(userId) {
    const key = String(userId);
    const arr = usageMap.get(key) || [];
    const pruned = pruneUsageArray(arr);
    pruned.push(Date.now());
    usageMap.set(key, pruned);
    return pruned.length;
}

function isOverLimit(userId) {
    const count = getUsageCount(userId);
    return count >= USAGE_LIMIT_PER_24H;
}

// --- Helpers ---
function createReservationEntry(userQueryText, creatorTelegramId) {
    const reservationId = uuidv4();
    const reservationEntry = {
        reservationId,
        userQuery: userQueryText,
        creatorTelegramId: creatorTelegramId || null,
        privateMessageId: null,
        status: "pending",
        answerText: null,
        createdAtTimestamp: Date.now(),
    };
    reservationStore.set(reservationId, reservationEntry);
    return reservationEntry;
}

function markReservationAsReady(reservationId, finalAnswerText) {
    const reservationEntry = reservationStore.get(reservationId);
    if (!reservationEntry) return null;
    reservationEntry.status = "ready";
    reservationEntry.answerText = finalAnswerText;
    return reservationEntry;
}

function escapeHtmlForWeb(unsafeString = "") {
    return String(unsafeString)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function isUserAllowed(userId) {
    // اگر لیست خالی باشه یعنی همه مجازند
    if (allowedTelegramIdsSet.size === 0) return true;
    return allowedTelegramIdsSet.has(String(userId));
}

function splitToChunks(text, chunkSize = 3800) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

async function sendLongMessage(chatId, text) {
    const chunks = splitToChunks(text);
    for (const chunk of chunks) {
        await telegramBot.telegram.sendMessage(chatId, chunk);
    }
}

// --- Perplexity API caller ---
async function callPerplexityApi(userQuestion, options = {}) {
    console.log("Calling Perplexity API with question:", userQuestion);

    if (!PERPLEXITY_API_KEY) {
        throw new Error("PERPLEXITY_API_KEY is not set in environment");
    }

    const requestPayload = {
        model: PERPLEXITY_MODEL,
        messages: [
            {
                role: "system",
                content:
                    "You are a helpful assistant. Reply only in plain text. Do not use markdown, formatting, links, citations, or images. Keep answers short, simple, and conversational. Do not provide resources or related questions.",
            },
            { role: "user", content: userQuestion },
        ],
        temperature: 0.3,
        top_p: 0.8,
        top_k: 0,
        presence_penalty: 0,
        frequency_penalty: 1,
        max_tokens: 500,
        stream: false,
        return_citations: false,
        return_images: false,
        return_related_questions: false,
    };

    const timeoutMilliseconds = options.timeoutMilliseconds || 35000;
    const abortController =
        typeof AbortController !== "undefined" ? new AbortController() : null;
    if (abortController)
        setTimeout(() => abortController.abort(), timeoutMilliseconds);

    const response = await fetchFunction(
        "https://api.perplexity.ai/chat/completions",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestPayload),
            signal: abortController ? abortController.signal : undefined,
        }
    );

    if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(
            `Perplexity API error ${response.status}: ${responseText}`
        );
    }

    const responseJson = await response.json();
    const returnedContent = responseJson?.choices?.[0]?.message?.content;
    if (typeof returnedContent === "string" && returnedContent.length > 0) {
        return returnedContent;
    }

    // fallbacks for unexpected shapes
    if (typeof responseJson?.choices?.[0]?.message === "string")
        return responseJson.choices[0].message;
    if (typeof responseJson?.answer === "string") return responseJson.answer;
    return JSON.stringify(responseJson);
}

// API: برگرداندن وضعیت رزرو به صورت JSON
webApp.get("/api/reservation/:reservationId", (req, res) => {
    const reservationId = req.params.reservationId;
    const reservationEntry = reservationStore.get(reservationId);
    if (!reservationEntry) {
        return res.status(404).json({ error: "not_found" });
    }
    // برگردانده شده به صورت امن (بدون HTML)
    return res.json({
        reservationId: reservationEntry.reservationId,
        userQuery: reservationEntry.userQuery,
        status: reservationEntry.status,
        answerText: reservationEntry.answerText,
        createdAtTimestamp: reservationEntry.createdAtTimestamp,
    });
});

// --- Telegram inline_query handler ---
// وقتی کاربر @YourBot ... تایپ می‌کند، برای او یک reservation ایجاد می‌کنیم و
// نتیجه‌ای برمی‌گردانیم که لینک /answer/<reservationId> را شامل است.
// دیگر از switch_pm_parameter استفاده نمیکنیم (درخواست شما بود).
telegramBot.on("inline_query", async (context) => {
    try {
        const userQueryText = context.inlineQuery.query || "(no query)";
        const userId = String(context.inlineQuery.from.id);

        // console.log(">>", userId);
        // console.log(">>", allowedTelegramIdsSet);
        // console.log(">>", isUserAllowed(userId));

        // بررسی اجازهٔ دسترسی
        if (!isUserAllowed(userId)) {
            const deniedResult = {
                type: "article",
                id: `denied-${uuidv4()}`,
                title: "شما دسترسی استفاده از بات را ندارید.",
                input_message_content: {
                    message_text:
                        "متأسفیم، شما اجازهٔ استفاده از این سرویس را ندارید. در صورت نیاز با ادمین (@Ali_Sdg90) تماس بگیرید.",
                },
                description: "کاربر مجاز نیست.",
            };
            await context.answerInlineQuery([deniedResult], {
                cache_time: 0,
                is_personal: true,
            });
            return;
        }

        // بررسی سقف استفاده 24 ساعته (این مرحله فقط پیش‌بینی کنه — شمارش نهایی هنگام انتخاب / chosen_inline_result انجام میشه)
        if (isOverLimit(userId)) {
            const limitResult = {
                type: "article",
                id: `limit-${uuidv4()}`,
                title: "سقف استفاده در روز تمام شده است!",
                input_message_content: {
                    message_text: `شما در ۲۴ ساعت گذشته بیش از ${USAGE_LIMIT_PER_24H} درخواست ثبت کرده‌اید. لطفاً بعد از گذشت ۲۴ ساعت دوباره تلاش کنید.`,
                },
                description: `سقف ${USAGE_LIMIT_PER_24H} درخواست در 24 ساعت.`,
            };
            await context.answerInlineQuery([limitResult], {
                cache_time: 0,
                is_personal: true,
            });
            return;
        }

        // همه چیز اوکیه — بساز و نتیجهٔ زیباتر برگردون
        const newReservation = createReservationEntry(
            userQueryText,
            context.inlineQuery.from.id
        );

        // TODO: userQueryText === "(no query)"

        const inlineArticleResult = {
            type: "article",
            id: newReservation.reservationId,
            title: "ثبت سؤال برای پردازش توسط هوش مصنوعی",
            input_message_content: {
                // این پیام وقتی در چت ارسال میشه برای دیگران هم قابل مشاهده است؛
                // ما کوتاه و واضح مینویسیم که پاسخ به صورت پیام خصوصی ارسال خواهد شد.
                message_text: `✅ سؤال شما ثبت شد.\n\nسؤال: ${userQueryText}\n\nپاسخ را به‌صورت خصوصی از طرف بات دریافت خواهید کرد.\n\n لینک مشاهده وضعیت و جواب: ${SERVER_URL}/answer/${newReservation.reservationId}`,
            },
            description: `ثبت سوال برای پردازش توسط هوش مصنوعی.`,
        };

        await context.answerInlineQuery([inlineArticleResult], {
            cache_time: 0,
            is_personal: true,
            // switch_pm_text و switch_pm_parameter حذف شده طبق درخواست شما
        });
    } catch (error) {
        console.error("inline_query handler error:", error);
    }
});

webApp.get("/answer/:reservationId", (request, response) => {
    const reservationId = request.params.reservationId;
    const reservationEntry = reservationStore.get(reservationId);
    if (!reservationEntry) {
        return response.status(404)
            .send(`<html><body style="font-family:system-ui, -apple-system, Roboto, 'Segoe UI', Arial;">
      <h3 style="color:#c0392b">Not found</h3>
      <p>رزروی با این شناسه پیدا نشد.</p>
    </body></html>`);
    }

    // اگر در حالت pending هست، نمایش کارت زیبا با پیشنهاد رفتن به فرانت‌اند جدا
    if (reservationEntry.status === "pending") {
        return response.send(`<!doctype html>
<html lang="fa">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>جواب رزرو — در حال آماده‌سازی</title>
<style>
  :root{ --bg:#0f172a; --card:#0b1220; --muted:#9aa4b2; --accent:#60a5fa; --glass: rgba(255,255,255,0.04); }
  body{ margin:0; font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; background:linear-gradient(180deg,#071329 0%, #041025 100%); color:#e6eef8; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; direction:rtl; }
  .card{ width:100%; max-width:820px; background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); border-radius:12px; padding:24px; box-shadow: 0 8px 30px rgba(2,6,23,0.7); border:1px solid rgba(255,255,255,0.03); }
  h1{ margin:0 0 8px 0; font-size:20px; }
  p{ margin:0 0 12px 0; color:var(--muted); }
  .query{ background:var(--glass); padding:12px; border-radius:8px; white-space:pre-wrap; }
  .meta{ display:flex; gap:8px; margin-top:14px; align-items:center; }
  .status{ padding:6px 10px; background:#1f2937; border-radius:999px; font-size:13px; color:var(--accent); }
  .link{ margin-left:auto; color:#fff; text-decoration:none; background:linear-gradient(90deg,#3b82f6,#06b6d4); padding:8px 12px; border-radius:8px; box-shadow:0 4px 14px rgba(59,130,246,0.18); }
  footer{ margin-top:16px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>جواب در حال آماده‌سازی است…</h1>
    <p>سؤال شما ثبت شده و در صف پاسخ‌دهی قرار دارد. این صفحه خلاصهٔ وضعیت را نمایش می‌دهد.</p>

    <div class="query">${escapeHtmlForWeb(reservationEntry.userQuery)}</div>

    <div class="meta">
      <div class="status">وضعیت: ${escapeHtmlForWeb(
          reservationEntry.status
      )}</div>
    </div>

    <footer>وقتی جواب آماده شد، این صفحه به‌روزرسانی کن. همچنین لینک اشتراک‌گذاری پایین‌ صفحه قرار دارد.</footer>
  </div>
</body>
</html>`);
    }

    return response.send(`<!doctype html>
<html lang="fa">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>جواب شما</title>
<style>
  :root{ --bg:#0f172a; --card:#071029; --muted:#9aa4b2; --accent:#60a5fa; --glass: rgba(255,255,255,0.03); }
  body{ margin:0; font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto; background:linear-gradient(180deg,#071329 0%, #041025 100%); color:#e6eef8; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; direction:rtl; }
  .card{ width:100%; max-width:900px; background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); border-radius:12px; padding:24px; box-shadow: 0 8px 30px rgba(2,6,23,0.7); border:1px solid rgba(255,255,255,0.03); }
  h1{ margin:0 0 12px 0; font-size:22px; }
  pre{ background:var(--glass); padding:16px; border-radius:8px; white-space:pre-wrap; overflow:auto; font-family:sans-serif; font-size:14px; color:#dff1ff; }
  .meta{ display:flex; gap:8px; margin-top:12px; align-items:center; }
  .link{ margin-left:auto; color:#fff; text-decoration:none; background:linear-gradient(90deg,#3b82f6,#06b6d4); padding:8px 12px; border-radius:8px; }
  .muted{ color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>پاسخ شما</h1>
    <div class="muted">سؤال: ${escapeHtmlForWeb(
        reservationEntry.userQuery
    )}</div>
    <pre>${escapeHtmlForWeb(reservationEntry.answerText || "بدون جواب")}</pre>

    <div class="meta">
      <div class="muted">وضعیت: ${escapeHtmlForWeb(
          reservationEntry.status
      )}</div>
    </div>
  </div>
</body>
</html>`);
});

// --- Telegram chosen_inline_result handler ---
// وقتی کاربر نتیجهٔ inline را انتخاب کرد، اینجا اجرا می‌شود.
// حالا: چک دسترسی، چک سقف استفاده، سپس ارسال placeholder به PM و پردازش Perplexity.
// اگر کاربر مجاز نباشد یا سقف تمام شده باشد، پیام مناسبی در PM براش میفرستیم.
telegramBot.on("chosen_inline_result", async (context) => {
    try {
        const chosenResultId = context.update.chosen_inline_result.result_id;
        const userWhoChose = context.update.chosen_inline_result.from;
        const userId = String(userWhoChose.id);
        const reservationEntry = reservationStore.get(chosenResultId);

        if (!reservationEntry) {
            console.warn(
                "chosen_inline_result: reservation not found for id:",
                chosenResultId
            );
            // اطلاع به کاربر که رزرو پیدا نشد
            try {
                await telegramBot.telegram.sendMessage(
                    userId,
                    "رزروی مربوطه پیدا نشد. لطفاً مجدداً تلاش کنید."
                );
            } catch (_) {}
            return;
        }

        // دوباره بررسی اجازهٔ استفاده
        if (!isUserAllowed(userId)) {
            try {
                await telegramBot.telegram.sendMessage(
                    userId,
                    "متأسفیم، شما اجازهٔ استفاده از این سرویس را ندارید."
                );
            } catch (err) {
                console.warn("failed to notify disallowed user:", err.message);
            }
            return;
        }

        // بررسی سقف استفاده (اینجا شمارش نهایی و محافظت انجام میشه)
        if (isOverLimit(userId)) {
            try {
                await telegramBot.telegram.sendMessage(
                    userId,
                    `شما در ۲۴ ساعت گذشته به حداکثر ${USAGE_LIMIT_PER_24H} درخواست رسیده‌اید. لطفاً بعد از گذشت ۲۴ ساعت دوباره تلاش کنید.`
                );
            } catch (err) {
                console.warn(
                    "failed to notify rate-limited user:",
                    err.message
                );
            }
            return;
        }

        // ثبت اینکه این کاربر این رزرو را انتخاب کرده
        reservationEntry.creatorTelegramId = userWhoChose.id;

        // افزایش شمارش استفاده (فقط وقتی واقعاً انتخاب شد)
        incrementUsage(userId);

        // ارسال پیام placeholder در پیام خصوصی کاربر
        let placeholderMessage;
        try {
            placeholderMessage = await telegramBot.telegram.sendMessage(
                userWhoChose.id,
                `در حال پردازش سؤال شما هستیم — زود جوابش رو می‌فرستیم.\n\n(سؤال: ${reservationEntry.userQuery})`
            );
            reservationEntry.privateMessageId = placeholderMessage.message_id;
        } catch (sendErr) {
            console.warn(
                "Could not send private placeholder (user may have blocked bot):",
                sendErr.message
            );
            // ادامه میدیم ولی ممکنه editMessageText بعدها fail کنه
        }

        // فراخوانی Perplexity برای گرفتن جواب
        try {
            const finalAnswer = await callPerplexityApi(
                reservationEntry.userQuery,
                { timeoutMilliseconds: 35000 }
            );
            markReservationAsReady(reservationEntry.reservationId, finalAnswer);

            // تلاش برای ویرایش پیام placeholder با جواب نهایی (اگر ممکن باشه)
            try {
                if (reservationEntry.privateMessageId) {
                    // ممکنه پاسخ طولانی باشه؛ ابتدا سعی در edit با chunk اول
                    const chunks = splitToChunks(finalAnswer);
                    await telegramBot.telegram.editMessageText(
                        userWhoChose.id,
                        reservationEntry.privateMessageId,
                        null,
                        `پاسخ شما آماده شد:\n\n${chunks[0]}\n\n(مشاهده در وب: ${SERVER_URL}/answer/${reservationEntry.reservationId})`
                    );
                    // بقیه چانک‌ها را ارسال کن
                    for (let i = 1; i < chunks.length; i++) {
                        await telegramBot.telegram.sendMessage(
                            userWhoChose.id,
                            chunks[i]
                        );
                    }
                } else {
                    // اگر placeholder نداشتیم، ارسال کامل به عنوان پیام جدید
                    await sendLongMessage(
                        userWhoChose.id,
                        `پاسخ شما:\n\n${finalAnswer}\n\n(مشاهده در وب: ${SERVER_URL}/answer/${reservationEntry.reservationId})`
                    );
                }
            } catch (editError) {
                console.warn(
                    "Could not edit private placeholder message, sending a new message:",
                    editError.message
                );
                await sendLongMessage(
                    userWhoChose.id,
                    `پاسخ شما:\n\n${finalAnswer}\n\n(مشاهده در وب: ${SERVER_URL}/answer/${reservationEntry.reservationId})`
                );
            }
        } catch (perplexityError) {
            console.error("Perplexity API call failed:", perplexityError);
            reservationEntry.status = "failed";
            reservationEntry.answerText = `خطا در گرفتن جواب از Perplexity: ${
                perplexityError.message || perplexityError
            }`;
            try {
                if (reservationEntry.privateMessageId) {
                    await telegramBot.telegram.editMessageText(
                        userWhoChose.id,
                        reservationEntry.privateMessageId,
                        null,
                        `در پردازش سوال شما خطایی رخ داد. لطفاً بعداً دوباره تلاش کنید.`
                    );
                } else {
                    await telegramBot.telegram.sendMessage(
                        userWhoChose.id,
                        `خطا در پردازش سوال شما. لطفاً بعداً تلاش کنید.`
                    );
                }
            } catch (_) {
                try {
                    await telegramBot.telegram.sendMessage(
                        userWhoChose.id,
                        `خطا در پردازش.`
                    );
                } catch (_) {}
            }
        }
    } catch (handlerError) {
        console.error(
            "chosen_inline_result handler encountered error:",
            handlerError
        );
    }
});

// --- Optional external AI callback endpoint ---
webApp.post("/api/ai-callback", async (request, response) => {
    const { reservationId, answerText } = request.body || {};
    if (!reservationId || typeof answerText !== "string")
        return response.status(400).send("bad");

    const updatedReservation = markReservationAsReady(
        reservationId,
        answerText
    );
    if (!updatedReservation) return response.status(404).send("not found");

    if (
        updatedReservation.creatorTelegramId &&
        updatedReservation.privateMessageId
    ) {
        try {
            await telegramBot.telegram.editMessageText(
                updatedReservation.creatorTelegramId,
                updatedReservation.privateMessageId,
                null,
                `پاسخ شما:\n\n${answerText}\n\n(لینک: ${SERVER_URL}/answer/${updatedReservation.reservationId})`
            );
        } catch (editError) {
            console.warn(
                "editMessageText failed in ai-callback:",
                editError.message
            );
            await telegramBot.telegram.sendMessage(
                updatedReservation.creatorTelegramId,
                `پاسخ شما:\n\n${answerText}\n\n(لینک: ${SERVER_URL}/answer/${updatedReservation.reservationId})`
            );
        }
    }

    return response.send({ ok: true });
});

// --- Start servers ---
webApp.listen(SERVER_PORT, () => {
    console.log("Web server listening on", SERVER_PORT);
});
telegramBot.launch().then(() => console.log("Telegram bot launched"));

process.once("SIGINT", () => telegramBot.stop("SIGINT"));
process.once("SIGTERM", () => telegramBot.stop("SIGTERM"));
