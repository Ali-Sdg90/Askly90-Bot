const reservationStore = require("../../services/reservationStore");
const config = require("../../config");
const { v4: uuidv4 } = require("uuid");

module.exports = async (ctx) => {
    const userQueryText = ctx.inlineQuery.query || "(no query)";
    const userId = String(ctx.inlineQuery.from.id);

    // access check
    const allowedSet = new Set(config.ALLOWED_TELEGRAM_IDS.map(String));
    if (allowedSet.size > 0 && !allowedSet.has(userId)) {
        const deniedResult = {
            type: "article",
            id: `denied-${uuidv4()}`,
            title: "شما دسترسی استفاده از بات را ندارید.",
            input_message_content: {
                message_text:
                    "متأسفیم، شما اجازهٔ استفاده از این سرویس را ندارید.",
            },
            description: "کاربر مجاز نیست.",
        };
        await ctx.answerInlineQuery([deniedResult], {
            cache_time: 0,
            is_personal: true,
        });
        return;
    }

    // usage pre-check (informational)
    // NOTE: final check is on chosen_inline_result
    const newReservation = reservationStore.create({
        userQuery: userQueryText,
        creatorTelegramId: ctx.inlineQuery.from.id,
    });

    const inlineArticleResult = {
        type: "article",
        id: newReservation.reservationId,
        title: "ثبت سؤال برای پردازش توسط هوش مصنوعی",
        input_message_content: {
            message_text: `✅ سؤال شما ثبت شد.\n\nسؤال: ${userQueryText}\n\nپاسخ را به‌صورت خصوصی از طرف بات دریافت خواهید کرد.\n\nلینک: ${config.SERVER_URL}/answer/${newReservation.reservationId}`,
        },
        description: `ثبت سوال برای پردازش توسط هوش مصنوعی.`,
    };

    await ctx.answerInlineQuery([inlineArticleResult], {
        cache_time: 0,
        is_personal: true,
    });
};
