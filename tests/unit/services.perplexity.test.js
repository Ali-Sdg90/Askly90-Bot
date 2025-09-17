jest.resetModules();

// mock the fetch wrapper module used in service
jest.mock("../../src/utils/fetch", () => ({
    fetch: jest.fn(),
}));

const { fetch } = require("../../src/utils/fetch");
const { callPerplexityApi } = require("../../src/services/perplexity");

describe("services/perplexity", () => {
    beforeEach(() => {
        fetch.mockReset();
        // ensure PERPLEXITY_API_KEY set to avoid early throw
        process.env.PERPLEXITY_API_KEY = "testkey";
        process.env.PERPLEXITY_MODEL = "test-model";
    });

    test("callPerplexityApi returns content when API responds ok", async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: "hi!" } }] }),
        });

        const resp = await callPerplexityApi("hello");
        expect(resp).toBe("hi!");
        expect(fetch).toHaveBeenCalled();
    });

    test("callPerplexityApi throws when response not ok", async () => {
        fetch.mockResolvedValue({
            ok: false,
            text: async () => "server error",
        });

        await expect(callPerplexityApi("hello")).rejects.toThrow(/Perplexity/);
    });
});
