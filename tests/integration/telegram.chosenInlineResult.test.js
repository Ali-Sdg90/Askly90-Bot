jest.resetModules();

jest.mock("../../src/services/perplexity", () => ({
    callPerplexityApi: jest.fn(),
}));

const reservationStore = require("../../src/services/reservationStore");
const usage = require("../../src/services/usageTracker");
const { callPerplexityApi } = require("../../src/services/perplexity");

// پاک‌سازی قبل از هر تست
beforeEach(() => {
    reservationStore.map.clear();
    jest.clearAllMocks();
});

// fake usageTracker: ensure not hitting limit
jest.spyOn(usage, "getCount").mockImplementation(() => 0);
jest.spyOn(usage, "increment").mockImplementation(() => 1);

test("chosenInlineResult handler happy path sends messages", async () => {
    // 1) create reservation (as inline query would)
    const r = reservationStore.create({ userQuery: "Explain JS" });

    // 2) prepare ctx and fake bot
    const ctx = {
        update: {
            chosen_inline_result: {
                result_id: r.reservationId,
                from: { id: 9999 },
            },
        },
    };

    const fakeBot = {
        telegram: {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessageText: jest.fn().mockResolvedValue(true),
        },
    };

    // 3) mock Perplexity answer
    callPerplexityApi.mockResolvedValue("final answer from AI");

    // require handler and run it
    const handler = require("../../src/telegram/handlers/chosenInlineResult");
    await handler(ctx, fakeBot);

    // assertions: placeholder send + final edit/send
    expect(fakeBot.telegram.sendMessage).toHaveBeenCalled();
    expect(callPerplexityApi).toHaveBeenCalledWith(
        "Explain JS",
        expect.any(Object)
    );
    // reservation state updated
    const updated = reservationStore.get(r.reservationId);
    expect(updated.status).toBe("ready");
    expect(updated.answerText).toContain("final answer");
});
