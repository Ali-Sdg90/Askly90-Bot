const { escapeHtmlForWeb, splitToChunks } = require("../../src/utils/text");

describe("utils/text", () => {
    test("escapeHtmlForWeb should escape <, > and &", () => {
        const input = "<div>&Hello</div>";
        const out = escapeHtmlForWeb(input);
        expect(out).toBe("&lt;div&gt;&amp;Hello&lt;/div&gt;");
    });

    test("splitToChunks should split long text into chunkSize parts", () => {
        const text = "a".repeat(9000);
        const chunks = splitToChunks(text, 3800);
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks.join("")).toBe(text);
        // each chunk (except maybe last) should have length <= chunkSize
        for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].length).toBeLessThanOrEqual(3800);
        }
    });
});
