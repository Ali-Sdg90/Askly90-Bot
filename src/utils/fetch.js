// safe fetch wrapper (node-fetch fallback)
let _fetch = global.fetch;
if (!_fetch) {
    _fetch = (...args) =>
        import("node-fetch").then(({ default: nf }) => nf(...args));
}

module.exports = {
    fetch: (...args) => _fetch(...args),
};
