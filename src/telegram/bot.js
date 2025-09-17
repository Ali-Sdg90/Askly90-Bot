const { Telegraf } = require("telegraf");
const config = require("../config");
const inlineQueryHandler = require("./handlers/inlineQuery");
const chosenInlineHandler = require("./handlers/chosenInlineResult");

function createBot() {
    console.log("Creating bot with token:", config);

    if (!config.BOT_TOKEN) {
        throw new Error("BOT_TOKEN not set");
    }
    const bot = new Telegraf(config.BOT_TOKEN);

    bot.on("inline_query", (ctx) => inlineQueryHandler(ctx));
    bot.on("chosen_inline_result", (ctx) => chosenInlineHandler(ctx, bot));

    return bot;
}

module.exports = { createBot };
