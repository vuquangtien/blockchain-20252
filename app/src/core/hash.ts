/**
 * Hashing primitives.
 *
 * All hashing in this system uses keccak256 to stay byte-compatible with EVM tooling.
 * (Solidity's `keccak256(...)` and `ecrecover(...)` use the same function family.)
 *
 * Two domain separators distinguish leaf hashes from internal node hashes — the standard
 * defense against second-preimage attacks on Merkle trees, where an attacker would otherwise
 * be able to claim an internal node hash is a leaf.
 */
import {keccak_256} from "@noble/hashes/sha3";
import {bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes} from "@noble/hashes/utils";

export type Hex = `0x${string}`;

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

export function keccak256(data: Uint8Array): Uint8Array {
    return keccak_256(data);
}

export function hexToBytes(hex: string): Uint8Array {
    if (!hex.startsWith("0x")) throw new Error(`hex must be 0x-prefixed: ${hex}`);
    return nobleHexToBytes(hex.slice(2));
}

export function bytesToHex(bytes: Uint8Array): Hex {
    return `0x${nobleBytesToHex(bytes)}`;
}

export function utf8(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

/** Domain-separated leaf hash: keccak256(0x00 ‖ data). */
export function hashLeaf(data: Uint8Array): Uint8Array {
    return keccak256(concat(LEAF_PREFIX, data));
}

/** Domain-separated internal-node hash: keccak256(0x01 ‖ left ‖ right). */
export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
    return keccak256(concat(NODE_PREFIX, left, right));
}
