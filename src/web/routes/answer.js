const express = require("express");
const router = express.Router();
const reservationStore = require("../../services/reservationStore");
const { escapeHtmlForWeb } = require("../../utils/text");

router.get("/answer/:reservationId", (req, res) => {
    const reservationId = req.params.reservationId;
    const reservationEntry = reservationStore.get(reservationId);
    if (!reservationEntry) {
        return res
            .status(404)
            .send("<h3>Not found</h3><p>رزروی با این شناسه پیدا نشد.</p>");
    }

    if (reservationEntry.status === "pending") {
        return res.send(`<!doctype html><html lang="fa"><head>...</head><body>
      <h1>جواب در حال آماده‌سازی است…</h1>
      <div>${escapeHtmlForWeb(reservationEntry.userQuery)}</div>
      <div>وضعیت: ${escapeHtmlForWeb(reservationEntry.status)}</div>
    </body></html>`);
    }

    return res.send(`<!doctype html><html lang="fa"><head>...</head><body>
    <h1>پاسخ شما</h1>
    <div>سؤال: ${escapeHtmlForWeb(reservationEntry.userQuery)}</div>
    <pre>${escapeHtmlForWeb(reservationEntry.answerText || "بدون جواب")}</pre>
  </body></html>`);
});

module.exports = router;
