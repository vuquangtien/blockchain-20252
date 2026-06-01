/**
 * Type definitions for the academic credential system.
 *
 * Naming conventions:
 *   - "Claim" = an atomic, verifiable statement about the holder (e.g. one course's grade).
 *   - "Credential" = the full document binding many claims to a holder, signed by the issuer.
 *   - "Presentation" = a redacted view of a credential the holder shows to a verifier;
 *     contains only selected claims plus their Merkle proofs.
 */

/** A single atomic claim on a transcript. Each becomes a leaf in the Merkle tree. */
export interface Claim {
    /** Stable claim identifier within the credential, e.g. "course:CS101". */
    key: string;
    /** Free-form value. Numbers/objects are JSON-encoded canonically before hashing. */
    value: unknown;
    /** Random salt to prevent dictionary attacks on hidden leaves. */
    salt: string; // hex, 0x-prefixed, 32 bytes
}

/** The full credential as signed and stored by the issuer/holder. */
export interface Credential {
    version: "1.0";
    /** Globally unique credential identifier (UUID or similar). */
    id: string;
    /** Address of the issuing university (must match registered issuer on-chain). */
    issuer: `0x${string}`;
    /**
     * Holder identifier. Can be an Ethereum address, a DID, or an opaque string.
     * Only its keccak256 hash is anchored on-chain to protect the holder's privacy.
     */
    holder: string;
    /** Human-readable credential type, e.g. "Bachelor of Science in Computer Science". */
    credentialType: string;
    /** URI to a JSON Schema describing the claim shape (optional but recommended). */
    schemaURI: string;
    /** Unix timestamp (seconds). */
    issuedAt: number;
    /** Unix timestamp; 0 means never expires. */
    expiresAt: number;
    /** All atomic claims. Order does NOT matter — leaves are sorted before tree build. */
    claims: Claim[];
    /** Root of the Merkle tree built over claims. Hex, 0x-prefixed, 32 bytes. */
    merkleRoot: `0x${string}`;
    /**
     * Issuer's secp256k1 ECDSA signature over the canonical hash of this document
     * (with `signature` field omitted). Hex 65-byte, 0x-prefixed: r ‖ s ‖ v.
     */
    signature: `0x${string}`;
}

/** A single claim plus the inclusion proof that it belongs to the credential's Merkle root. */
export interface DisclosedClaim {
    claim: Claim;
    /** Sibling hashes from leaf up to root. Hex, 0x-prefixed. */
    proof: `0x${string}`[];
    /**
     * Per-level direction flags: true = current node is right, sibling is left.
     * Required because the underlying tree is NOT sort-pair (sort-pair would leak claim ordering
     * and break uniqueness when a course key repeats across a class).
     */
    positions: boolean[];
}

/** What the holder presents to a verifier — a redacted credential. */
export interface Presentation {
    version: "1.0";
    /** The credential's metadata (everything except `claims`, which are selectively disclosed). */
    credential: Omit<Credential, "claims">;
    /** Subset of claims the holder is willing to disclose, with Merkle proofs. */
    disclosed: DisclosedClaim[];
    /** Optional holder-bound proof: signature by holder over (credentialId ‖ verifierNonce). */
    holderProof?: {
        scheme: "secp256k1-keccak";
        nonce: string; // hex, 0x-prefixed, given by verifier as challenge
        signature: `0x${string}`;
        /** Public key the holder claims, recoverable from signature; verifier may pin it. */
        holderAddress: `0x${string}`;
    };
}

/** Result of running the verification pipeline on a Presentation. */
export interface VerificationResult {
    valid: boolean;
    /** Each individual check, in order — useful for diagnostics. */
    checks: {
        name: string;
        passed: boolean;
        detail?: string;
    }[];
    /** Disclosed claims after passing all checks; undefined if any check failed. */
    disclosedClaims?: Claim[];
}

/** Describes the on-chain deployment used by CLI tools and the demo. */
export interface ChainConfig {
    rpcUrl: string;
    chainId: number;
    issuerRegistry: `0x${string}`;
    credentialRegistry: `0x${string}`;
}
