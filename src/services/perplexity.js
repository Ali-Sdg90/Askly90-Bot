const { fetch } = require("../utils/fetch");
const config = require("../config");

async function callPerplexityApi(userQuestion, opts = {}) {
    if (!config.PERPLEXITY_API_KEY) {
        throw new Error("PERPLEXITY_API_KEY is not set");
    }

    const payload = {
        model: config.PERPLEXITY_MODEL,
        messages: [
            {
                role: "system",
                content:
                    "You are a helpful assistant. Reply only in plain text. Do not use markdown or links.",
            },
            { role: "user", content: userQuestion },
        ],
        temperature: 0.3,
        max_tokens: 500,
        stream: false,
        return_citations: false,
    };

    const timeoutMs = opts.timeoutMilliseconds || 35000;
    const abortController =
        typeof AbortController !== "undefined" ? new AbortController() : null;
    if (abortController) setTimeout(() => abortController.abort(), timeoutMs);

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController ? abortController.signal : undefined,
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Perplexity error ${res.status}: ${txt}`);
    }

    const j = await res.json();
    const returned = j?.choices?.[0]?.message?.content;
    if (typeof returned === "string") return returned;
    if (typeof j?.answer === "string") return j.answer;
    return JSON.stringify(j);
}

module.exports = { callPerplexityApi };
