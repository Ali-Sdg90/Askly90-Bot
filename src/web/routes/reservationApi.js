const express = require("express");
const router = express.Router();
const reservationStore = require("../../services/reservationStore");

router.get("/api/reservation/:reservationId", (req, res) => {
    const reservationEntry = reservationStore.get(req.params.reservationId);
    if (!reservationEntry) return res.status(404).json({ error: "not_found" });
    return res.json({
        reservationId: reservationEntry.reservationId,
        userQuery: reservationEntry.userQuery,
        status: reservationEntry.status,
        answerText: reservationEntry.answerText,
        createdAtTimestamp: reservationEntry.createdAtTimestamp,
    });
});

module.exports = router;
