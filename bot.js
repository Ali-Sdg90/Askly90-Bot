// index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { Telegraf } = require("telegraf");
const { v4: uuidv4 } = require("uuid");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());

/* === In-memory store (use Redis/DB in prod) === */
const RES = new Map();
/* RES entry:
  {
    id,
    query,         // متن پرسش
    creatorId,     // id کسی که inline query فرستاد (ctx.from.id)
    pmMessageId,   // id پیام placeholder در PM (بات آن را ارسال کرده)
    status,        // "pending" | "ready" | "failed"
    answer,        // string
    createdAt
  }
*/

/* create reservation */
function createReservation(query, creatorId) {
    const id = uuidv4();
    const item = {
        id,
        query,
        creatorId: creatorId || null,
        pmMessageId: null,
        status: "pending",
        answer: null,
        createdAt: Date.now(),
    };
    RES.set(id, item);
    return item;
}
function setReservationAnswer(id, answer) {
    const r = RES.get(id);
    if (!r) return null;
    r.status = "ready";
    r.answer = answer;
    return r;
}

/* === Express endpoint for link page === */
function escapeHtml(s = "") {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

app.get("/answer/:id", (req, res) => {
    const id = req.params.id;
    const r = RES.get(id);
    if (!r) return res.status(404).send("<h3>Not found</h3>");
    if (r.status === "pending") {
        return res.send(`<html><body>
      <h3>جواب در حال آماده شدن است…</h3>
      <p>سوال: ${escapeHtml(r.query)}</p>
      <p>صفحه به‌طور خودکار به‌روزرسانی نمی‌شود — صبر کنید یا صفحه را رفرش کنید.</p>
    </body></html>`);
    }
    // ready
    return res.send(`<html><body>
    <h3>جواب شما</h3>
    <pre style="white-space:pre-wrap; font-family:monospace;">${escapeHtml(
        r.answer
    )}</pre>
  </body></html>`);
});

/* === Inline query handler ===
   وقتی کاربر @YourBot ... تایپ می‌کنه، اینجا صدا زده می‌شه.
   ما اینجا یک reservation می‌سازیم و یک InlineQueryResultArticle برمی‌گردونیم
   که متنِ آن شامل لینک https://.../answer/<id> است.
*/
bot.on("inline_query", async (ctx) => {
    try {
        const q = ctx.inlineQuery.query || "(no query)";
        // ایجاد رزرو زودهنگام تا id داشته باشیم
        const r = createReservation(q, ctx.inlineQuery.from.id);

        const article = {
            type: "article",
            id: r.id, // مهم: این id بعدها در chosen_inline_result می‌آید
            title: `ارسال به‌صورت رزرو (AI)`,
            input_message_content: {
                message_text: `درخواست ارسال شد. برای دیدن جواب به لینک زیر مراجعه کنید:\n\n${SERVER_URL}/answer/${r.id}`,
            },
            description: `ارسال سوال: ${q}`,
        };

        // switch_pm_text و switch_pm_parameter: باعث می‌شه کاربر یک دکمه ببیند که مستقیم PM باز می‌کنه
        await ctx.answerInlineQuery([article], {
            cache_time: 0,
            is_personal: true,
            switch_pm_text: "مشاهده جواب کامل در پیام خصوصی با بات",
            switch_pm_parameter: r.id,
        });

        // (اختیاری) می‌تونی بلافاصله یک PM هم ارسال کنی یا صبر کنی تا chosen_inline_result بیاد.
        // ما صبر می‌کنیم تا chosen_inline_result — چون کاربر ممکنه نتیجه را انتخاب نکند.
    } catch (err) {
        console.error("inline_query err:", err);
    }
});

/* === chosen_inline_result handler ===
   وقتی کاربر یک نتیجهٔ inline را انتخاب کنه، این آپدیت میاد.
   result_id همان id‌ای است که در result گذاشتیم (پس reservation id داریم).
   حالا بات یک پیام خصوصی placeholder به کاربر می‌فرستد و pmMessageId را ذخیره می‌کند.
   سپس می‌توانیم پردازش AI را شروع کنیم؛ وقتی آماده شد، پیام را edit می‌کنیم.
*/
bot.on("chosen_inline_result", async (ctx) => {
    try {
        const resultId = ctx.update.chosen_inline_result.result_id;
        const from = ctx.update.chosen_inline_result.from; // user who chose
        const r = RES.get(resultId);
        if (!r) {
            console.warn(
                "chosen_inline_result: reservation not found for",
                resultId
            );
            return;
        }

        // ثبت id کاربر (باز هم) برای اطمینان
        r.creatorId = from.id;

        // ارسال پیام placeholder در PM به کاربر (بات مالک آن پیام خواهد بود)
        const sent = await bot.telegram.sendMessage(
            from.id,
            `در حال پردازش سوال شما...\n\n(سوال: ${r.query})`
        );
        r.pmMessageId = sent.message_id;

        // حالا پردازش AI را شروع می‌کنیم (مثال: mock)
        mockCallAI(r.query)
            .then(async (answer) => {
                setReservationAnswer(r.id, answer);

                // ادیت پیام placeholder در PM
                try {
                    await bot.telegram.editMessageText(
                        from.id,
                        r.pmMessageId,
                        null,
                        `جواب شما:\n\n${answer}\n\n(لینک: ${SERVER_URL}/answer/${r.id})`
                    );
                } catch (err) {
                    console.warn(
                        "Could not edit PM placeholder, sending new message:",
                        err.message
                    );
                    await bot.telegram.sendMessage(
                        from.id,
                        `جواب شما:\n\n${answer}\n\n(لینک: ${SERVER_URL}/answer/${r.id})`
                    );
                }
            })
            .catch(async (err) => {
                console.error("AI error:", err);
                r.status = "failed";
                r.answer = "خطا در گرفتن جواب از AI";
                try {
                    await bot.telegram.editMessageText(
                        from.id,
                        r.pmMessageId,
                        null,
                        `خطا در پردازش پاسخ. لطفاً دوباره تلاش کنید.`
                    );
                } catch (_) {
                    await bot.telegram.sendMessage(from.id, `خطا در پردازش.`);
                }
            });
    } catch (err) {
        console.error("chosen_inline_result handler err:", err);
    }
});

/* === Mock AI call ===
   در عمل اینجا به سرویس AI خودت صدا می‌زنی و بعد پاسخ را ثبت می‌کنی.
   اگر سرویس AI webhook داره، می‌تونی از /api/ai-callback استفاده کنی و
   آنچه در بالا انجام می‌دهیم را از webhook انجام بدی.
*/
function mockCallAI(q) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`(پاسخ شبیه‌سازی‌شده برای) ${q}`);
        }, 2500);
    });
}

/* === Optional: external AI callback endpoint ===
   اگر سرویس AI تو یک webhook برای جواب زدن داره، از این endpoint استفاده کن:
   POST /api/ai-callback { id: "<reservation-id>", answer: "..." }
   این endpoint reservation را آپدیت می‌کند و پیام PM را ویرایش می‌کند.
*/
app.post("/api/ai-callback", async (req, res) => {
    const { id, answer } = req.body || {};
    if (!id || typeof answer !== "string") return res.status(400).send("bad");
    const r = setReservationAnswer(id, answer);
    if (!r) return res.status(404).send("not found");
    if (r.creatorId && r.pmMessageId) {
        try {
            await bot.telegram.editMessageText(
                r.creatorId,
                r.pmMessageId,
                null,
                `جواب شما:\n\n${answer}\n\n(لینک: ${SERVER_URL}/answer/${r.id})`
            );
        } catch (err) {
            console.warn("editMessageText failed in ai-callback:", err.message);
            await bot.telegram.sendMessage(
                r.creatorId,
                `جواب شما:\n\n${answer}\n\n(لینک: ${SERVER_URL}/answer/${r.id})`
            );
        }
    }
    res.send({ ok: true });
});

/* === start servers === */
app.listen(PORT, () => {
    console.log("Web listening on", PORT);
});
bot.launch().then(() => console.log("Bot launched"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
