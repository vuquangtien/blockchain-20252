/**
 * Credential issuance, signing, and presentation generation.
 *
 * This module ties together the Merkle tree (selective disclosure) and ECC signing
 * (issuer authenticity) into the Credential / Presentation lifecycle.
 *
 * Lifecycle
 *   1. Issuer calls `issueCredential(...)`:
 *        - Adds a 32-byte salt to each claim (so hidden leaves can't be brute-forced).
 *        - Builds a Merkle tree, takes the root.
 *        - Computes credentialId = keccak256(canonical credential without signature).
 *        - Signs the canonical bytes with EIP-191 personal_sign.
 *        - Returns the full Credential (claims + root + signature).
 *      The issuer separately calls the smart contract to anchor `credentialId`.
 *   2. Holder calls `createPresentation(credential, ["course:CS101", ...])`:
 *        - Strips claims to only those requested.
 *        - Generates Merkle proofs for each.
 *        - Optionally adds a holder signature binding the presentation to a verifier
 *          challenge nonce.
 *   3. Verifier calls `verifyPresentation(...)` (with optional chain client) to check:
 *        - Issuer signature recovers the registered issuer address.
 *        - Every disclosed claim's Merkle proof reproduces the credential's root.
 *        - On-chain: credential is anchored, not revoked, not expired, issuer is active.
 *        - Holder challenge response, if requested.
 */

import {canonicalize} from "./canonical.js";
import {personalSign, signRawDigest, recoverAddress, recoverFromDigest, type KeyPair} from "./ecc.js";
import {bytesToHex, hexToBytes, keccak256, type Hex, utf8} from "./hash.js";
import {MerkleClaimTree, verifyMerkleProof} from "./merkle.js";
import type {Claim, Credential, DisclosedClaim, Presentation, VerificationResult} from "./types.js";

/** Generate a 32-byte random salt as 0x-prefixed hex. */
export function newSalt(): Hex {
    return randomHex(32);
}

/** Generate a UUIDv4-ish credential id from random bytes (16 bytes hex). */
export function newCredentialId(): string {
    return `urn:cred:${randomHex(16).slice(2)}`;
}

function randomHex(bytes: number): Hex {
    const out = new Uint8Array(bytes);
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
        throw new Error("Secure random source unavailable");
    }
    cryptoApi.getRandomValues(out);
    return bytesToHex(out);
}

export interface IssueParams {
    issuerKey: KeyPair;
    holder: string;
    credentialType: string;
    schemaURI?: string;
    /** Claims without salt — salts will be auto-generated. */
    claims: Array<Omit<Claim, "salt"> & {salt?: Hex}>;
    /** Override issuance time for deterministic tests; defaults to now. */
    issuedAt?: number;
    /** Unix seconds; 0 = never expires. */
    expiresAt?: number;
}

/** Build, sign, and return a complete Credential. */
export function issueCredential(p: IssueParams): Credential {
    const claims: Claim[] = p.claims.map((c) => ({
        key: c.key,
        value: c.value,
        salt: c.salt ?? newSalt(),
    }));
    const tree = new MerkleClaimTree(claims);

    const issuedAt = p.issuedAt ?? Math.floor(Date.now() / 1000);
    const expiresAt = p.expiresAt ?? 0;

    // The metadata is what the issuer signs. Because `merkleRoot` is a binding
    // commitment to the full claim set, signing only the metadata is sufficient
    // to authenticate every claim without requiring the verifier to see them all.
    // This is what makes selective disclosure work: the verifier never has to
    // reconstruct the full claim list to check the signature.
    const metadata = {
        version: "1.0" as const,
        id: newCredentialId(),
        issuer: p.issuerKey.address,
        holder: p.holder,
        credentialType: p.credentialType,
        schemaURI: p.schemaURI ?? "",
        issuedAt,
        expiresAt,
        merkleRoot: tree.root,
    };

    const message = canonicalize(metadata);
    const signature = personalSign(p.issuerKey.privateKey, message);

    return {...metadata, claims, signature};
}

/**
 * Recompute the canonical message used for issuer signature.
 * The signed payload is the credential metadata only — `claims` and `signature`
 * are excluded; `merkleRoot` (inside metadata) commits to the claims.
 */
export function credentialSigningMessage(c: Credential): string {
    const {signature: _sig, claims: _claims, ...metadata} = c;
    void _sig;
    void _claims;
    return canonicalize(metadata);
}

/** Compute credentialId = keccak256(canonical bytes of the credential metadata). */
export function credentialId(c: Credential): Hex {
    return bytesToHex(keccak256(utf8(credentialSigningMessage(c))));
}

/** keccak256(holder string) — the holderHash anchored on-chain. */
export function holderHash(holder: string): Hex {
    return bytesToHex(keccak256(utf8(holder)));
}

export interface PresentationParams {
    credential: Credential;
    /** Keys of claims to disclose (must exist in the credential). */
    disclose: string[];
    /** If provided, the holder additionally signs (credentialId ‖ nonce). */
    holderKey?: KeyPair;
    /** Verifier-supplied 32-byte challenge as hex. Required if `holderKey` is set. */
    nonce?: Hex;
}

/** Construct a redacted Presentation with Merkle proofs for the disclosed claims. */
export function createPresentation(p: PresentationParams): Presentation {
    const {credential, disclose} = p;
    const tree = new MerkleClaimTree(credential.claims);

    const claimByKey = new Map(credential.claims.map((c) => [c.key, c]));
    const disclosed: DisclosedClaim[] = [];
    for (const key of disclose) {
        const claim = claimByKey.get(key);
        if (!claim) throw new Error(`Cannot disclose unknown claim '${key}'`);
        const {siblings, positions} = tree.proofFor(key);
        disclosed.push({claim, proof: siblings, positions});
    }

    const {claims: _omitClaims, ...credentialMeta} = credential;
    void _omitClaims;

    const presentation: Presentation = {
        version: "1.0",
        credential: credentialMeta,
        disclosed,
    };

    if (p.holderKey) {
        if (!p.nonce) throw new Error("nonce required when holderKey is provided");
        const cid = credentialId(credential);
        const challenge = keccak256(
            new Uint8Array([...hexToBytes(cid), ...hexToBytes(p.nonce)]),
        );
        presentation.holderProof = {
            scheme: "secp256k1-keccak",
            nonce: p.nonce,
            signature: signRawDigest(p.holderKey.privateKey, challenge),
            holderAddress: p.holderKey.address,
        };
    }

    return presentation;
}

/** Optional chain interface so verification can call into IssuerRegistry / CredentialRegistry. */
export interface ChainView {
    isAuthorizedIssuer(address: `0x${string}`): Promise<boolean>;
    credentialAnchorStatus(credentialIdHex: Hex): Promise<
        | {status: "Unknown"}
        | {status: "Valid"; merkleRoot: Hex; issuedAt: number; expiresAt: number}
        | {status: "Revoked"; reason: string}
        | {status: "Expired"}
    >;
}

export interface VerifyOptions {
    /** If provided, on-chain checks are performed in addition to off-chain checks. */
    chain?: ChainView;
    /** Whether anchoring is required. Defaults to true (recommended). */
    requireAnchor?: boolean;
    /** Expected challenge nonce we asked the holder to sign, hex. */
    expectedNonce?: Hex;
    /** If verifier wants to require the holder proof, pass true. */
    requireHolderProof?: boolean;
    /** Optional clock override for testing. */
    nowSeconds?: number;
}

/**
 * Run the full verification pipeline. Returns a structured VerificationResult so
 * callers can show the user exactly which check passed or failed.
 */
export async function verifyPresentation(
    presentation: Presentation,
    options: VerifyOptions = {},
): Promise<VerificationResult> {
    const checks: VerificationResult["checks"] = [];
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

    // The issuer signs the credential metadata (which contains merkleRoot but not
    // raw claims). The verifier reconstructs that exact payload from the presentation
    // and recovers the signer's address.
    const sigMessage = presentationSigningMessage(presentation);

    // 2. Verify issuer signature.
    const cred = presentation.credential;
    let signatureValid = false;
    try {
        const recovered = recoverAddress(sigMessage, cred.signature);
        signatureValid = recovered.toLowerCase() === cred.issuer.toLowerCase();
        checks.push({
            name: "issuer_signature",
            passed: signatureValid,
            detail: signatureValid ? `recovered ${recovered}` : `recovered ${recovered}, expected ${cred.issuer}`,
        });
    } catch (err) {
        checks.push({name: "issuer_signature", passed: false, detail: (err as Error).message});
    }

    // 3. Expiry check.
    if (cred.expiresAt !== 0 && now >= cred.expiresAt) {
        checks.push({name: "not_expired", passed: false, detail: `expired at ${cred.expiresAt}, now ${now}`});
    } else {
        checks.push({name: "not_expired", passed: true});
    }

    // 4. Merkle proofs for each disclosed claim.
    let allProofsOK = true;
    for (const d of presentation.disclosed) {
        const ok = verifyMerkleProof(d.claim, d.proof, d.positions, cred.merkleRoot);
        if (!ok) {
            allProofsOK = false;
            checks.push({name: `merkle_proof:${d.claim.key}`, passed: false});
        } else {
            checks.push({name: `merkle_proof:${d.claim.key}`, passed: true});
        }
    }

    // 5. Holder proof, if present or required.
    if (options.requireHolderProof && !presentation.holderProof) {
        checks.push({name: "holder_proof", passed: false, detail: "holder proof required but missing"});
    } else if (presentation.holderProof) {
        const cid = credentialIdFromMeta(cred);
        const expectedNonce = options.expectedNonce;
        if (expectedNonce && expectedNonce.toLowerCase() !== presentation.holderProof.nonce.toLowerCase()) {
            checks.push({
                name: "holder_proof",
                passed: false,
                detail: `nonce mismatch: got ${presentation.holderProof.nonce}, expected ${expectedNonce}`,
            });
        } else {
            const challenge = keccak256(
                new Uint8Array([
                    ...hexToBytes(cid),
                    ...hexToBytes(presentation.holderProof.nonce),
                ]),
            );
            try {
                const recovered = recoverFromDigest(challenge, presentation.holderProof.signature);
                const ok = recovered.toLowerCase() === presentation.holderProof.holderAddress.toLowerCase();
                checks.push({name: "holder_proof", passed: ok, detail: `recovered ${recovered}`});
            } catch (err) {
                checks.push({name: "holder_proof", passed: false, detail: (err as Error).message});
            }
        }
    }

    // 6. On-chain checks (optional but recommended).
    if (options.chain) {
        const cid = credentialIdFromMeta(cred);
        try {
            const status = await options.chain.credentialAnchorStatus(cid);
            if (status.status === "Unknown") {
                if (options.requireAnchor !== false) {
                    checks.push({
                        name: "anchor_present",
                        passed: false,
                        detail: "credential is not anchored on-chain",
                    });
                } else {
                    checks.push({name: "anchor_present", passed: true, detail: "anchor not required"});
                }
            } else if (status.status === "Revoked") {
                checks.push({name: "anchor_present", passed: false, detail: `revoked: ${status.reason}`});
            } else if (status.status === "Expired") {
                checks.push({name: "anchor_present", passed: false, detail: "expired on-chain"});
            } else {
                // status.status === "Valid"
                const rootMatches = status.merkleRoot.toLowerCase() === cred.merkleRoot.toLowerCase();
                checks.push({
                    name: "anchor_present",
                    passed: rootMatches,
                    detail: rootMatches
                        ? "anchored and live"
                        : `merkle root mismatch: chain ${status.merkleRoot}, doc ${cred.merkleRoot}`,
                });
            }
        } catch (err) {
            checks.push({name: "anchor_present", passed: false, detail: `chain query failed: ${(err as Error).message}`});
        }

        try {
            const authorized = await options.chain.isAuthorizedIssuer(cred.issuer);
            checks.push({
                name: "issuer_authorized",
                passed: authorized,
                detail: authorized ? "issuer is registered and active" : "issuer not authorized",
            });
        } catch (err) {
            checks.push({name: "issuer_authorized", passed: false, detail: (err as Error).message});
        }
    }

    const valid = checks.every((c) => c.passed);
    return {
        valid,
        checks,
        disclosedClaims: valid ? presentation.disclosed.map((d) => d.claim) : undefined,
    };
}

/**
 * The exact bytes the issuer signed. The signed payload is the credential metadata
 * MINUS the signature itself (and minus raw `claims`, which are committed to via
 * `merkleRoot`). Verifiers can reconstruct it from the presentation alone.
 */
export function presentationSigningMessage(p: Presentation): string {
    const {signature: _sig, ...metadata} = p.credential;
    void _sig;
    return canonicalize(metadata);
}

/** credentialId derived from presentation metadata (matches issuer-side derivation). */
export function credentialIdFromMeta(meta: Presentation["credential"]): Hex {
    const {signature: _sig, ...rest} = meta;
    void _sig;
    return bytesToHex(keccak256(utf8(canonicalize(rest))));
}
