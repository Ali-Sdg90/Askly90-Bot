// In-memory store with simple API. Swap to Redis by replacing implementations.
const { v4: uuidv4 } = require("uuid");

class ReservationStore {
    constructor() {
        this.map = new Map();
    }

    create({ userQuery, creatorTelegramId = null }) {
        const reservationId = uuidv4();
        const entry = {
            reservationId,
            userQuery,
            creatorTelegramId,
            privateMessageId: null,
            status: "pending",
            answerText: null,
            createdAtTimestamp: Date.now(),
        };
        this.map.set(reservationId, entry);
        return entry;
    }

    get(reservationId) {
        return this.map.get(reservationId) || null;
    }

    markReady(reservationId, answerText) {
        const e = this.map.get(reservationId);
        if (!e) return null;
        e.status = "ready";
        e.answerText = answerText;
        return e;
    }

    markFailed(reservationId, errMsg) {
        const e = this.map.get(reservationId);
        if (!e) return null;
        e.status = "failed";
        e.answerText = errMsg;
        return e;
    }
}

module.exports = new ReservationStore();
