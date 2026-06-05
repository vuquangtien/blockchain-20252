import { canonicalize } from "json-canonicalize";
import { hashLeaf, hashNode, hexToBytes, bytesToHex, utf8 } from "../hash.js";
import type { ClaimV2 } from "./types.js";

/** Encode a Claim into the bytes that will be domain-separated and hashed as a leaf. */
export function encodeClaimV2(credentialId: string, claim: { key: string; value: unknown; salt: string }): Uint8Array {
    return utf8(canonicalize({
        credentialId,
        key: claim.key,
        value: claim.value,
        salt: claim.salt
    }));
}

/** Compute the leaf hash for a Claim V2. */
export function claimLeafHashV2(credentialId: string, key: string, value: unknown, salt: string): Uint8Array {
    return hashLeaf(encodeClaimV2(credentialId, { key, value, salt }));
}

/** Compare two byte arrays lexicographically. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const d = a[i]! - b[i]!;
        if (d !== 0) return d;
    }
    return a.length - b.length;
}

/**
 * Merkle tree for selective disclosure of academic claims (Protocol V2).
 */
export class MerkleClaimTreeV2 {
    public readonly leaves: Uint8Array[];
    public readonly layers: Uint8Array[][];
    public readonly root: string;
    private readonly indexByClaimKey = new Map<string, number>();

    constructor(public readonly credentialId: string, claims: ClaimV2[]) {
        if (claims.length === 0) {
            throw new Error("Merkle tree requires at least one claim");
        }

        // Pair each claim with its V2 leaf hash
        const tagged = claims.map((c) => ({
            claim: c,
            hash: claimLeafHashV2(credentialId, c.key, c.value, c.salt)
        }));

        // Sort by hash bytes (deterministic ordering)
        tagged.sort((a, b) => compareBytes(a.hash, b.hash));

        // Detect duplicate leaf hashes — would break unique inclusion proofs
        for (let i = 1; i < tagged.length; i++) {
            if (compareBytes(tagged[i - 1]!.hash, tagged[i]!.hash) === 0) {
                throw new Error(
                    `Duplicate leaf detected for claim keys '${tagged[i - 1]!.claim.key}' and '${tagged[i]!.claim.key}'`
                );
            }
        }

        this.leaves = tagged.map((t) => t.hash);
        tagged.forEach((t, i) => this.indexByClaimKey.set(t.claim.key, i));

        this.layers = [this.leaves];
        let cur = this.leaves;
        while (cur.length > 1) {
            const next: Uint8Array[] = [];
            for (let i = 0; i < cur.length; i += 2) {
                const left = cur[i]!;
                const right = i + 1 < cur.length ? cur[i + 1]! : left; // duplicate odd
                next.push(hashNode(left, right));
            }
            this.layers.push(next);
            cur = next;
        }

        this.root = bytesToHex(this.layers[this.layers.length - 1]![0]!);
    }

    /** Returns the proof for a claim by its `key`. */
    proofFor(claimKey: string): { siblings: string[]; positions: boolean[] } {
        const idx = this.indexByClaimKey.get(claimKey);
        if (idx === undefined) throw new Error(`No claim with key '${claimKey}'`);

        const siblings: string[] = [];
        const positions: boolean[] = [];
        let idxTemp = idx;
        for (let lvl = 0; lvl < this.layers.length - 1; lvl++) {
            const layer = this.layers[lvl]!;
            const isRight = idxTemp % 2 === 1;
            const siblingIdx = isRight ? idxTemp - 1 : idxTemp + 1;
            const sibling = siblingIdx < layer.length ? layer[siblingIdx]! : layer[idxTemp]!; // odd-leaf duplication
            siblings.push(bytesToHex(sibling));
            positions.push(isRight);
            idxTemp = Math.floor(idxTemp / 2);
        }
        return { siblings, positions };
    }
}

/**
 * Verify a Merkle inclusion proof against an expected root (Protocol V2).
 */
export function verifyMerkleProofV2(
    credentialId: string,
    key: string,
    value: unknown,
    salt: string,
    proof: string[],
    positions: boolean[],
    expectedRoot: string
): boolean {
    if (proof.length !== positions.length) return false;
    let cur = claimLeafHashV2(credentialId, key, value, salt);
    for (let i = 0; i < proof.length; i++) {
        const sibling = hexToBytes(proof[i]!);
        const isRight = positions[i]!;
        cur = isRight ? hashNode(sibling, cur) : hashNode(cur, sibling);
    }
    return bytesToHex(cur).toLowerCase() === expectedRoot.toLowerCase();
}
