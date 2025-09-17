beforeEach(() => {
    jest.resetModules(); // reload module to reset internal maps
});

test("usageTracker increments and prunes older than 24h", () => {
    jest.useFakeTimers("modern");
    const base = Date.now();
    jest.setSystemTime(base);

    const usage = require("../../src/services/usageTracker");

    // first increment
    expect(usage.increment("u1")).toBe(1);
    expect(usage.getCount("u1")).toBe(1);

    // move time forward by 25 hours -> old record pruned
    jest.setSystemTime(base + 25 * 60 * 60 * 1000);
    expect(usage.getCount("u1")).toBe(0);

    jest.useRealTimers();
});
