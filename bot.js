require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const { v4: uuidv4 } = require("uuid");

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
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "sonar";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const SERVER_PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
    console.error(
        "Missing BOT_TOKEN in environment. Set BOT_TOKEN in your .env file."
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

// --- Perplexity API caller ---
async function callPerplexityApi(userQuestion, options = {}) {
    console.log("Calling Perplexity API with question:", userQuestion);

    if (!PERPLEXITY_API_KEY) {
        throw new Error("PERPLEXITY_API_KEY is not set in environment");
    }

    const requestPayload = {
        model: PERPLEXITY_MODEL,
        messages: [
            { role: "system", content: "Be precise and concise." },
            { role: "user", content: userQuestion },
        ],
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

// --- Express route: show reservation status / answer page ---
webApp.get("/answer/:reservationId", (request, response) => {
    const reservationId = request.params.reservationId;
    const reservationEntry = reservationStore.get(reservationId);
    if (!reservationEntry) {
        return response.status(404).send("<h3>Not found</h3>");
    }

    if (reservationEntry.status === "pending") {
        return response.send(`<html><body>
      <h3>جواب در حال آماده شدن است…</h3>
      <p>سوال: ${escapeHtmlForWeb(reservationEntry.userQuery)}</p>
      <p>صفحه به‌طور خودکار به‌روزرسانی نمی‌شود — لطفاً صفحه را رفرش کنید.</p>
    </body></html>`);
    }

    // ready
    return response.send(`<html><body>
    <h3>جواب شما</h3>
    <pre style="white-space:pre-wrap; font-family:monospace;">${escapeHtmlForWeb(
        reservationEntry.answerText
    )}</pre>
  </body></html>`);
});

// --- Telegram inline_query handler ---
// وقتی کاربر @YourBot ... تایپ می‌کند، برای او یک reservation ایجاد می‌کنیم و
// نتیجه‌ای برمی‌گردانیم که لینک /answer/<reservationId> را شامل است.
// همچنین switch_pm_parameter تنظیم می‌کنیم تا کاربر راحت به PM برود.
telegramBot.on("inline_query", async (context) => {
    try {
        const userQueryText = context.inlineQuery.query || "(no query)";
        const newReservation = createReservationEntry(
            userQueryText,
            context.inlineQuery.from.id
        );

        const inlineArticleResult = {
            type: "article",
            id: newReservation.reservationId,
            title: "ارسال به‌صورت رزرو (AI)",
            input_message_content: {
                message_text: `سوال: ${userQueryText}\n\nدرخواست ارسال شد. برای دیدن جواب به لینک زیر مراجعه کنید:\n\n${SERVER_URL}/answer/${newReservation.reservationId}`,
            },
            description: `ارسال سوال: ${userQueryText}`,
        };

        await context.answerInlineQuery([inlineArticleResult], {
            cache_time: 0,
            is_personal: true,
            switch_pm_text: "مشاهده جواب کامل در پیام خصوصی با بات",
            switch_pm_parameter: newReservation.reservationId,
        });
    } catch (error) {
        console.error("inline_query handler error:", error);
    }
});

// TEST!
// telegramBot.use(async (context, next) => {
//     try {
//         console.log(">>> incoming update type:", context.updateType);
//         console.log(
//             ">>> full update payload:",
//             JSON.stringify(context.update, null, 2)
//         );
//     } catch (err) {
//         console.warn("Logging error:", err);
//     }
//     return next();
// });

// --- Telegram chosen_inline_result handler ---
// وقتی کاربر نتیجهٔ inline را انتخاب کرد، اینجا اجرا می‌شود.
// بات یک پیام placeholder در PM کاربر می‌فرستد، سپس Perplexity را صدا می‌زند و
// بعد پیام placeholder را edit می‌کند با جواب نهایی.
telegramBot.on("chosen_inline_result", async (context) => {
    console.log("in");

    try {
        const chosenResultId = context.update.chosen_inline_result.result_id;
        const userWhoChose = context.update.chosen_inline_result.from;
        const reservationEntry = reservationStore.get(chosenResultId);

        console.log("Here");

        if (!reservationEntry) {
            console.warn(
                "chosen_inline_result: reservation not found for id:",
                chosenResultId
            );
            return;
        }

        // ثبت id کاربر که انتخاب را انجام داده
        reservationEntry.creatorTelegramId = userWhoChose.id;

        // ارسال پیام placeholder در پیام خصوصی کاربر
        const placeholderMessage = await telegramBot.telegram.sendMessage(
            userWhoChose.id,
            `در حال پردازش سوال شما...\n\n(سوال: ${reservationEntry.userQuery})`
        );
        reservationEntry.privateMessageId = placeholderMessage.message_id;

        // فراخوانی Perplexity برای گرفتن جواب
        try {
            const finalAnswer = await callPerplexityApi(
                reservationEntry.userQuery,
                { timeoutMilliseconds: 35000 }
            );
            markReservationAsReady(reservationEntry.reservationId, finalAnswer);

            // تلاش برای ویرایش پیام placeholder با جواب نهایی
            try {
                await telegramBot.telegram.editMessageText(
                    userWhoChose.id,
                    reservationEntry.privateMessageId,
                    null,
                    `جواب شما:\n\n${finalAnswer}\n\n(لینک: ${SERVER_URL}/answer/${reservationEntry.reservationId})`
                );
            } catch (editError) {
                console.warn(
                    "Could not edit private placeholder message, sending a new message:",
                    editError.message
                );
                await telegramBot.telegram.sendMessage(
                    userWhoChose.id,
                    `جواب شما:\n\n${finalAnswer}\n\n(لینک: ${SERVER_URL}/answer/${reservationEntry.reservationId})`
                );
            }
        } catch (perplexityError) {
            console.error("Perplexity API call failed:", perplexityError);
            reservationEntry.status = "failed";
            reservationEntry.answerText = `خطا در گرفتن جواب از Perplexity: ${
                perplexityError.message || perplexityError
            }`;
            try {
                await telegramBot.telegram.editMessageText(
                    userWhoChose.id,
                    reservationEntry.privateMessageId,
                    null,
                    `خطا در پردازش پاسخ. لطفاً دوباره تلاش کنید.`
                );
            } catch (_) {
                await telegramBot.telegram.sendMessage(
                    userWhoChose.id,
                    `خطا در پردازش.`
                );
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
// برای حالتی که سرویس AI به‌صورت webhook جواب را می‌فرستد
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
                `جواب شما:\n\n${answerText}\n\n(لینک: ${SERVER_URL}/answer/${updatedReservation.reservationId})`
            );
        } catch (editError) {
            console.warn(
                "editMessageText failed in ai-callback:",
                editError.message
            );
            await telegramBot.telegram.sendMessage(
                updatedReservation.creatorTelegramId,
                `جواب شما:\n\n${answerText}\n\n(لینک: ${SERVER_URL}/answer/${updatedReservation.reservationId})`
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
