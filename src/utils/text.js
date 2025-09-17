function escapeHtmlForWeb(unsafe = "") {
    return String(unsafe)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function splitToChunks(text = "", chunkSize = 3800) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

module.exports = { escapeHtmlForWeb, splitToChunks };
