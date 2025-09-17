const express = require("express");
const router = express.Router();
const reservationStore = require("../../services/reservationStore");

router.post("/api/ai-callback", async (req, res) => {
    const { reservationId, answerText } = req.body || {};
    if (!reservationId || typeof answerText !== "string")
        return res.status(400).send("bad");
    const updated = reservationStore.markReady(reservationId, answerText);
    if (!updated) return res.status(404).send("not found");

    // if possible, notify user via bot. We'll emit an event or use direct telegram instance.
    // To keep things decoupled, the main index.js can subscribe to reservation changes and notify.
    return res.json({ ok: true });
});

module.exports = router;
