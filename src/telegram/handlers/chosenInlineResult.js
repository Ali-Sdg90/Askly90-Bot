const reservationStore = require("../../services/reservationStore");
const usage = require("../../services/usageTracker");
const { callPerplexityApi } = require("../../services/perplexity");
const config = require("../../config");
const { splitToChunks } = require("../../utils/text");

module.exports = async (ctx, telegramBot) => {
    try {
        const chosenResultId = ctx.update.chosen_inline_result.result_id;
        const userWhoChose = ctx.update.chosen_inline_result.from;
        const userId = String(userWhoChose.id);
        const reservationEntry = reservationStore.get(chosenResultId);

        if (!reservationEntry) {
            await telegramBot.telegram.sendMessage(
                userId,
                "رزروی مربوطه پیدا نشد. لطفاً مجدداً تلاش کنید."
            );
            return;
        }

        // access & rate checks
        const allowed =
            config.ALLOWED_TELEGRAM_IDS.length === 0 ||
            config.ALLOWED_TELEGRAM_IDS.map(String).includes(userId);
        if (!allowed) {
            await telegramBot.telegram.sendMessage(
                userId,
                "متأسفیم، شما اجازهٔ استفاده از این سرویس را ندارید."
            );
            return;
        }
        if (usage.getCount(userId) >= config.USAGE_LIMIT_PER_24H) {
            await telegramBot.telegram.sendMessage(
                userId,
                `شما در ۲۴ ساعت گذشته به حداکثر ${config.USAGE_LIMIT_PER_24H} درخواست رسیده‌اید.`
            );
            return;
        }

        // record who chose & increment usage
        reservationEntry.creatorTelegramId = userWhoChose.id;
        usage.increment(userId);

        // send placeholder
        let placeholder;
        try {
            placeholder = await telegramBot.telegram.sendMessage(
                userWhoChose.id,
                `در حال پردازش سؤال شما هستیم — زود جوابش رو می‌فرستیم.\n\n(سؤال: ${reservationEntry.userQuery})`
            );
            reservationEntry.privateMessageId = placeholder.message_id;
        } catch (e) {
            console.error("Failed to send placeholder message:", e);
        }

        // call Perplexity
        try {
            const finalAnswer = await callPerplexityApi(
                reservationEntry.userQuery,
                { timeoutMilliseconds: 35000 }
            );
            reservationStore.markReady(
                reservationEntry.reservationId,
                finalAnswer
            );

            const chunks = splitToChunks(finalAnswer);
            if (reservationEntry.privateMessageId) {
                await telegramBot.telegram.editMessageText(
                    userWhoChose.id,
                    reservationEntry.privateMessageId,
                    null,
                    `پاسخ شما آماده شد:\n\n${chunks[0]}\n\n(مشاهده در وب: ${config.SERVER_URL}/answer/${reservationEntry.reservationId})`
                );
                for (let i = 1; i < chunks.length; i++) {
                    await telegramBot.telegram.sendMessage(
                        userWhoChose.id,
                        chunks[i]
                    );
                }
            } else {
                // no placeholder => send full
                for (const c of chunks)
                    await telegramBot.telegram.sendMessage(userWhoChose.id, c);
            }
        } catch (err) {
            reservationStore.markFailed(
                reservationEntry.reservationId,
                `خطا در گرفتن جواب: ${err.message}`
            );
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
            } catch (e) {
                console.error("Failed to send error message:", e);
            }
        }
    } catch (err) {
        console.error("chosenInlineResult handler error:", err);
    }
};
