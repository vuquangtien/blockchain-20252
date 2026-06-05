import { canonicalize } from "json-canonicalize";

/**
 * Validate that a claim value:
 *  - is JSON-compatible.
 *  - nesting depth <= 8.
 *  - canonical JSON serialization size <= 4096 bytes.
 *  - does not contain unsafe integers or non-finite numbers.
 *  - does not contain undefined, functions, symbols, BigInt, or sparse arrays.
 *  - does not contain prototype-polluting keys (__proto__, constructor, prototype).
 */
export function validateClaimValue(value: unknown): void {
    if (value === undefined) {
        throw new Error("undefined is not a valid JSON-compatible claim value");
    }
    if (typeof value === "function") {
        throw new Error("functions are not allowed in claim values");
    }
    if (typeof value === "symbol") {
        throw new Error("symbols are not allowed in claim values");
    }
    if (typeof value === "bigint") {
        throw new Error("bigint is not allowed in claim values");
    }

    function checkDepthAndType(val: unknown, currentDepth: number): void {
        if (currentDepth > 8) {
            throw new Error("Claim value nesting depth exceeds limit of 8");
        }

        if (val === null) return;

        if (typeof val === "number") {
            if (!Number.isFinite(val)) {
                throw new Error("non-finite numbers are not allowed in claim values");
            }
            if (Number.isInteger(val) && !Number.isSafeInteger(val)) {
                throw new Error("unsafe integers are not allowed in claim values");
            }
            return;
        }

        if (typeof val === "string") return;
        if (typeof val === "boolean") return;

        if (Array.isArray(val)) {
            // Check for sparse arrays (indices must be contiguous keys starting from 0)
            const keys = Object.keys(val);
            if (keys.length !== val.length) {
                throw new Error("sparse array detected (length mismatch): sparse arrays are not allowed in claim values");
            }
            for (let i = 0; i < val.length; i++) {
                if (!(i in val)) {
                    throw new Error("sparse array detected (missing index)");
                }
                checkDepthAndType(val[i], currentDepth + 1);
            }
            return;
        }

        if (typeof val === "object") {
            // Assert plain objects only
            const proto = Object.getPrototypeOf(val);
            if (proto !== null && proto !== Object.prototype) {
                throw new Error("non-plain objects are not allowed in claim values");
            }

            for (const key of Object.keys(val)) {
                if (key === "__proto__" || key === "constructor" || key === "prototype") {
                    throw new Error(`prototype-polluting key '${key}' is not allowed`);
                }
                checkDepthAndType((val as Record<string, unknown>)[key], currentDepth + 1);
            }
            return;
        }

        throw new Error(`unsupported type: ${typeof val}`);
    }

    checkDepthAndType(value, 1);

    // Size check on canonical JSON representation
    let canonicalStr: string;
    try {
        canonicalStr = canonicalize(value);
    } catch (err: any) {
        throw new Error(`failed to canonicalize claim value: ${err?.message || err}`);
    }

    const byteLength = new TextEncoder().encode(canonicalStr).length;
    if (byteLength > 4096) {
        throw new Error(`Canonical JSON size of claim value (${byteLength} bytes) exceeds limit of 4096 bytes`);
    }
}

/**
 * Validate a timestamp:
 *  - must be a JavaScript safe integer.
 *  - must not be too far in the future (allowing up to 60 seconds clock skew).
 */
export function validateTimestamp(t: number): void {
    if (!Number.isSafeInteger(t)) {
        throw new Error("Timestamp is not a safe integer");
    }
    const now = Math.floor(Date.now() / 1000);
    if (t > now + 60) {
        throw new Error(`Timestamp (${t}) is in the future beyond 60s clock skew tolerance (current: ${now})`);
    }
}

/**
 * Validate an expiration timestamp:
 *  - must be a JavaScript safe integer.
 */
export function validateExpirationTimestamp(t: number): void {
    if (!Number.isSafeInteger(t)) {
        throw new Error("Timestamp is not a safe integer");
    }
}
