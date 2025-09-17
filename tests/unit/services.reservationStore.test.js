jest.resetModules(); // ensure clean module state between test runs
const reservationStore = require("../../src/services/reservationStore");

describe("reservationStore (in-memory)", () => {
    beforeEach(() => {
        // clear the internal Map to have fresh state
        reservationStore.map.clear();
    });

    test("create and get reservation", () => {
        const entry = reservationStore.create({
            userQuery: "hello",
            creatorTelegramId: 1,
        });
        expect(entry).toMatchObject({
            userQuery: "hello",
            creatorTelegramId: 1,
            status: "pending",
        });

        const loaded = reservationStore.get(entry.reservationId);
        expect(loaded).toBeDefined();
        expect(loaded.reservationId).toBe(entry.reservationId);
    });

    test("markReady sets status and answerText", () => {
        const e = reservationStore.create({ userQuery: "q" });
        const updated = reservationStore.markReady(
            e.reservationId,
            "final answer"
        );
        expect(updated).not.toBeNull();
        expect(updated.status).toBe("ready");
        expect(updated.answerText).toBe("final answer");
    });

    test("markFailed sets status and answerText", () => {
        const e = reservationStore.create({ userQuery: "q2" });
        const updated = reservationStore.markFailed(
            e.reservationId,
            "err happened"
        );
        expect(updated.status).toBe("failed");
        expect(updated.answerText).toContain("err");
    });
});
