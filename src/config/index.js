require("dotenv").config();

const getList = (v) =>
    (v || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
    PERPLEXITY_MODEL: process.env.PERPLEXITY_MODEL || "sonar",
    SERVER_URL: process.env.SERVER_URL,
    PORT: parseInt(process.env.PORT || "3000", 10),
    ALLOWED_TELEGRAM_IDS: getList(process.env.ALLOWED_TELEGRAM_IDS || ""),
    USAGE_LIMIT_PER_24H: parseInt(process.env.USAGE_LIMIT_PER_24H || "2", 10),
    NODE_ENV: process.env.NODE_ENV || "development",
};
