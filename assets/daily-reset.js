export const DAILY_RESET_MARKER_PREFIX = 'faith_focus_reset_marker_v1_';

export function createDailyResetMarker(resetAt = Date.now(), cryptoApi = globalThis.crypto) {
    if (!Number.isSafeInteger(resetAt) || resetAt <= 0
        || !cryptoApi?.getRandomValues) {
        throw new TypeError('A secure reset timestamp and random source are required.');
    }
    const random = cryptoApi.getRandomValues(new Uint8Array(16));
    const resetId = Array.from(random, value => value.toString(16).padStart(2, '0')).join('');
    random.fill(0);
    return { version: 1, resetAt, resetId };
}

export function parseDailyResetMarker(value) {
    if (value === null || value === undefined) return null;
    let marker = value;
    if (typeof value === 'string') {
        try { marker = JSON.parse(value); }
        catch { return null; }
    }
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || marker.version !== 1
        || !Number.isSafeInteger(marker.resetAt) || marker.resetAt <= 0
        || typeof marker.resetId !== 'string' || !/^[a-f0-9]{32}$/.test(marker.resetId)) {
        return null;
    }
    return { version: 1, resetAt: marker.resetAt, resetId: marker.resetId };
}

// A missing marker represents pre-marker history. A later explicit reset
// always wins over it; equal timestamps use the random ID as a stable tie-break.
export function compareDailyResetMarkers(leftValue, rightValue) {
    const left = parseDailyResetMarker(leftValue);
    const right = parseDailyResetMarker(rightValue);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    if (left.resetAt !== right.resetAt) return left.resetAt < right.resetAt ? -1 : 1;
    return left.resetId < right.resetId ? -1 : left.resetId > right.resetId ? 1 : 0;
}
