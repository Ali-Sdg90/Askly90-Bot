const config = require("./config");
const { createBot } = require("./telegram/bot");
const { createServer } = require("./web/server");

async function main() {
    // start express
    const app = createServer();
    app.listen(config.PORT, () => {
        console.log("Web server listening on", config.PORT);
    });

    // start telegram bot
    const bot = createBot();
    await bot.launch();
    console.log("Telegram bot launched");

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
    console.error("Fatal error on startup:", err);
    process.exit(1);
});
