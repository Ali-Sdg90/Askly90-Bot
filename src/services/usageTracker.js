// 24h sliding window usage tracker (in-memory).
const usageMap = new Map();

function prune(arr) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return arr.filter((t) => t > cutoff);
}

function getCount(userId) {
    const key = String(userId);
    const arr = usageMap.get(key) || [];
    const pr = prune(arr);
    usageMap.set(key, pr);
    return pr.length;
}

function increment(userId) {
    const key = String(userId);
    const arr = usageMap.get(key) || [];
    const pr = prune(arr);
    pr.push(Date.now());
    usageMap.set(key, pr);
    return pr.length;
}

module.exports = { getCount, increment };
