/**
 * Canonical JSON serialization.
 *
 * Two parties signing or hashing the same logical object MUST produce the same bytes,
 * regardless of language or library. JSON.stringify is non-deterministic for object
 * keys, so we sort keys recursively. Numbers, strings, booleans, null, and arrays are
 * passed through; arrays preserve order (semantic ordering belongs to the caller).
 */
export function canonicalize(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = sortKeys((value as Record<string, unknown>)[k]);
        }
        return out;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("canonicalize: non-finite numbers are not allowed");
    }
    return value;
}
