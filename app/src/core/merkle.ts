/**
 * Merkle tree for selective disclosure of academic claims.
 *
 * Design choices and rationale
 * ----------------------------
 * 1. **Custom implementation, not a library.** We need full control over leaf encoding,
 *    domain separation, and proof shape so the same proof verifies in TS *and* in
 *    Solidity if we ever choose to do on-chain verification. Off-the-shelf libraries
 *    typically don't expose direction flags or canonical leaf hashing the way we need.
 *
 * 2. **No sort-pair ordering.** Many libraries sort the two children at each level so
 *    proofs don't need direction flags. We deliberately do NOT do that:
 *      - Sort-pair leaks information (an attacker reorders leaves arbitrarily).
 *      - Sort-pair makes second-preimage harder to reason about with structured data.
 *    Instead, each proof step carries an explicit boolean: was the *current* node the
 *    left child or the right child? The verifier reconstructs the path deterministically.
 *
 * 3. **Domain-separated hashing.** Leaves are hashed with prefix 0x00, internal nodes
 *    with prefix 0x01. This prevents an attacker from passing an internal node hash off
 *    as a leaf hash (the classic Merkle second-preimage attack).
 *
 * 4. **Odd-leaf handling.** When a level has an odd number of nodes, the lone right
 *    node is duplicated (paired with itself) before hashing. This is the same approach
 *    used by Bitcoin and OpenZeppelin's MerkleProof and is safe under domain separation.
 *
 * 5. **Leaves sorted by canonical hash.** The tree is order-independent: two issuers
 *    producing the same set of claims (any order) produce the same root. The leaf order
 *    is the byte-lexicographic order of leaf hashes.
 */

import type {Claim} from "./types.js";
import {canonicalize} from "./canonical.js";
import {bytesToHex, hashLeaf, hashNode, hexToBytes, utf8, type Hex} from "./hash.js";

/** Encode a Claim into the bytes that will be domain-separated and hashed as a leaf. */
export function encodeClaim(claim: Claim): Uint8Array {
    return utf8(canonicalize({key: claim.key, value: claim.value, salt: claim.salt}));
}

/** Compute the leaf hash for a Claim. */
export function claimLeafHash(claim: Claim): Uint8Array {
    return hashLeaf(encodeClaim(claim));
}

interface BuiltTree {
    /** Sorted leaf hashes (level 0). */
    leaves: Uint8Array[];
    /** Stored layers, leaves at index 0 and root at the last index. */
    layers: Uint8Array[][];
    root: Uint8Array;
    /** Sorted index of each claim's hash within `leaves`, keyed by `claim.key`. */
    indexByClaimKey: Map<string, number>;
}

function buildTree(claims: Claim[]): BuiltTree {
    if (claims.length === 0) throw new Error("Merkle tree requires at least one claim");

    // Pair each claim with its leaf hash, sort by hash bytes (deterministic ordering).
    const tagged = claims.map((c) => ({claim: c, hash: claimLeafHash(c)}));
    tagged.sort((a, b) => compareBytes(a.hash, b.hash));

    // Detect duplicate leaf hashes — would break unique inclusion proofs.
    for (let i = 1; i < tagged.length; i++) {
        if (compareBytes(tagged[i - 1]!.hash, tagged[i]!.hash) === 0) {
            throw new Error(
                `Duplicate leaf detected for claim keys '${tagged[i - 1]!.claim.key}' and '${tagged[i]!.claim.key}'`,
            );
        }
    }

    const leaves = tagged.map((t) => t.hash);
    const indexByClaimKey = new Map<string, number>();
    tagged.forEach((t, i) => indexByClaimKey.set(t.claim.key, i));

    const layers: Uint8Array[][] = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
        const next: Uint8Array[] = [];
        for (let i = 0; i < cur.length; i += 2) {
            const left = cur[i]!;
            const right = i + 1 < cur.length ? cur[i + 1]! : left; // duplicate odd
            next.push(hashNode(left, right));
        }
        layers.push(next);
        cur = next;
    }

    return {leaves, layers, root: layers[layers.length - 1]![0]!, indexByClaimKey};
}

export interface MerkleProof {
    /** Sibling hashes from leaf-level upward. */
    siblings: Hex[];
    /** Per-step direction flags: true = current node was the right child. */
    positions: boolean[];
}

/**
 * Build the Merkle tree, expose helpers for root / proofs, and remember claim positions.
 */
export class MerkleClaimTree {
    private readonly tree: BuiltTree;

    constructor(public readonly claims: Claim[]) {
        this.tree = buildTree(claims);
    }

    get root(): Hex {
        return bytesToHex(this.tree.root);
    }

    /** Returns the proof for a claim by its `key`. */
    proofFor(claimKey: string): MerkleProof {
        const idx = this.tree.indexByClaimKey.get(claimKey);
        if (idx === undefined) throw new Error(`No claim with key '${claimKey}'`);
        return this.proofAtIndex(idx);
    }

    private proofAtIndex(leafIndex: number): MerkleProof {
        const siblings: Hex[] = [];
        const positions: boolean[] = [];
        let idx = leafIndex;
        for (let lvl = 0; lvl < this.tree.layers.length - 1; lvl++) {
            const layer = this.tree.layers[lvl]!;
            const isRight = idx % 2 === 1;
            const siblingIdx = isRight ? idx - 1 : idx + 1;
            const sibling = siblingIdx < layer.length ? layer[siblingIdx]! : layer[idx]!; // odd-leaf duplication
            siblings.push(bytesToHex(sibling));
            positions.push(isRight);
            idx = Math.floor(idx / 2);
        }
        return {siblings, positions};
    }
}

/**
 * Verify a Merkle inclusion proof against an expected root.
 *
 * Returns true iff hashing the leaf and walking up using `proof` and `positions`
 * reproduces `expectedRoot`.
 */
export function verifyMerkleProof(
    claim: Claim,
    proof: Hex[],
    positions: boolean[],
    expectedRoot: Hex,
): boolean {
    if (proof.length !== positions.length) return false;
    let cur = claimLeafHash(claim);
    for (let i = 0; i < proof.length; i++) {
        const sibling = hexToBytes(proof[i]!);
        const isRight = positions[i]!;
        cur = isRight ? hashNode(sibling, cur) : hashNode(cur, sibling);
    }
    return compareBytes(cur, hexToBytes(expectedRoot)) === 0;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const d = a[i]! - b[i]!;
        if (d !== 0) return d;
    }
    return a.length - b.length;
}
