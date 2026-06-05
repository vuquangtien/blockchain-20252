import { z } from "zod";
import { isAddress } from "ethers";
import { validateClaimValue } from "./validation.js";
import { MerkleClaimTreeV2 } from "./merkle.js";
import { canonicalize } from "json-canonicalize";
import { keccak_256 } from "@noble/hashes/sha3";
import { utf8, bytesToHex } from "../hash.js";

// Base validation patterns
export const bytes32Regex = /^0x[0-9a-fA-F]{64}$/;
export const addressRegex = /^0x[0-9a-fA-F]{40}$/;
export const signatureRegex = /^0x[0-9a-fA-F]{130}$/;
export const claimKeyRegex = /^[a-zA-Z0-9:._\/-]{1,128}$/;

// Zod schemas for validation
export const bytes32Schema = z.string().regex(bytes32Regex);

export const nonzeroBytes32Schema = z.string().regex(bytes32Regex).refine(
    (val) => val !== "0x" + "0".repeat(64),
    { message: "Zero bytes32 is invalid" }
);

export const addressSchema = z.string().refine(
    (val) => isAddress(val),
    { message: "Invalid Ethereum address format or checksum" }
).refine(
    (val) => val !== "0x" + "0".repeat(40),
    { message: "Zero address is invalid" }
);

export const signatureSchema = z.string().regex(signatureRegex);

export const claimSchema = z.object({
    key: z.string().regex(claimKeyRegex, "Invalid claim key format"),
    value: z.unknown(),
    salt: nonzeroBytes32Schema
}).strict();

export const credentialV2BaseSchema = z.object({
    version: z.literal("2.0"),
    id: nonzeroBytes32Schema,
    issuerOrganizationId: nonzeroBytes32Schema,
    issuerSigningAddress: addressSchema,
    holder: addressSchema,
    credentialType: z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 128,
        { message: "Credential type must be <= 128 UTF-8 bytes" }
    ),
    schemaURI: z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 512,
        { message: "Schema URI must be <= 512 UTF-8 bytes" }
    ).refine(
        (val) => val.startsWith("https:") || val.startsWith("ipfs:"),
        { message: "Schema URI must use https: or ipfs:" }
    ),
    issuedAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "issuedAt must be a safe integer" }),
    expiresAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "expiresAt must be a safe integer" }),
    merkleRoot: nonzeroBytes32Schema,
    claimCount: z.number().int().min(1, "between 1 and 256").max(256, "between 1 and 256"),
    claims: z.array(claimSchema).min(1, "between 1 and 256").max(256, "between 1 and 256"),
    signature: signatureSchema
}).strict();

export const credentialV2Schema = credentialV2BaseSchema.refine(
    (data) => data.claims.length === data.claimCount,
    { message: "claims array length must equal claimCount", path: ["claimCount"] }
);

export const verificationRequestV1Schema = z.object({
    id: nonzeroBytes32Schema,
    verifier: addressSchema,
    audience: z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 256,
        { message: "Audience must be <= 256 UTF-8 bytes" }
    ),
    nonce: nonzeroBytes32Schema,
    requiredClaimsHash: nonzeroBytes32Schema,
    acceptedIssuerIdsHash: nonzeroBytes32Schema,
    acceptedSchemaURIsHash: nonzeroBytes32Schema,
    issuedAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "issuedAt must be a safe integer" }),
    expiresAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "expiresAt must be a safe integer" }),
    requiredClaimKeys: z.array(z.string().regex(claimKeyRegex, "Invalid claim key format")).min(1).max(256),
    acceptedIssuerIds: z.array(nonzeroBytes32Schema).min(1).max(256),
    acceptedSchemaURIs: z.array(z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 512,
        { message: "Schema URI must be <= 512 UTF-8 bytes" }
    ).refine(
        (val) => val.startsWith("https:") || val.startsWith("ipfs:"),
        { message: "Schema URI must use https: or ipfs:" }
    )).min(1).max(256),
    signature: signatureSchema
}).strict();

export const presentationAuthorizationV1Schema = z.object({
    credentialDigest: nonzeroBytes32Schema,
    requestDigest: nonzeroBytes32Schema,
    disclosureDigest: nonzeroBytes32Schema,
    holder: addressSchema,
    createdAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "createdAt must be a safe integer" }),
    expiresAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "expiresAt must be a safe integer" }),
    signature: signatureSchema
}).strict();

export const disclosedClaimV2Schema = z.object({
    key: z.string().regex(claimKeyRegex),
    value: z.unknown(),
    salt: nonzeroBytes32Schema,
    proof: z.array(bytes32Schema).max(8),
    positions: z.array(z.boolean()).max(8)
}).strict().refine(
    (data) => data.proof.length === data.positions.length,
    { message: "proof and positions array lengths must be equal", path: ["positions"] }
);

export const presentationV2Schema = z.object({
    version: z.literal("2.0"),
    credential: credentialV2BaseSchema.omit({ claims: true }).strict(),
    disclosed: z.array(disclosedClaimV2Schema).min(1).max(256),
    presentationAuthorization: presentationAuthorizationV1Schema
}).strict();

// TypeScript interfaces
export type ClaimV2 = z.infer<typeof claimSchema>;
export type CredentialV2 = z.infer<typeof credentialV2Schema>;
export type VerificationRequestV1 = z.infer<typeof verificationRequestV1Schema>;
export type PresentationAuthorizationV1 = z.infer<typeof presentationAuthorizationV1Schema>;
export type DisclosedClaimV2 = z.infer<typeof disclosedClaimV2Schema>;
export type PresentationV2 = z.infer<typeof presentationV2Schema>;

export interface VerificationCheck {
    name: string;
    passed: boolean;
    code: string;
    detail?: string;
}

export interface VerificationResultV2 {
    valid: boolean;
    checks: VerificationCheck[];
    disclosedClaims?: ClaimV2[];
}

// Deterministic ASCII sort comparator
export function asciiCompare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Normalized Policy Array Hashing Helper (using deterministic ASCII sort)
export function hashPolicyArray(arr: string[]): string {
    const seen = new Set<string>();
    for (const val of arr) {
        if (seen.has(val)) {
            throw new Error(`Duplicate entry found in policy array: ${val}`);
        }
        seen.add(val);
    }
    const sorted = [...arr].sort(asciiCompare);
    const serialized = canonicalize(sorted);
    const hashBytes = keccak_256(utf8(serialized));
    return bytesToHex(hashBytes);
}

// Normalized Disclosed Claims Hashing Helper (using deterministic ASCII sort)
export function hashDisclosedClaims(disclosed: DisclosedClaimV2[]): string {
    const sorted = disclosed.slice().sort((a, b) => asciiCompare(a.key, b.key));
    const serialized = canonicalize(sorted);
    const hashBytes = keccak_256(utf8(serialized));
    return bytesToHex(hashBytes);
}

// Non-throwing explicit runtime parsers
export function parseCredentialV2(obj: unknown): { success: true; data: CredentialV2 } | { success: false; error: string } {
    try {
        const res = credentialV2Schema.safeParse(obj);
        if (!res.success) {
            return { success: false, error: res.error.message };
        }
        const data = res.data;

        // Semantic checks:
        // 1. Duplicate claim keys
        const seenKeys = new Set<string>();
        for (const c of data.claims) {
            if (seenKeys.has(c.key)) {
                return { success: false, error: `Duplicate claim key: ${c.key}` };
            }
            seenKeys.add(c.key);
        }

        // 2. Invalid claim values, including undefined and pollution hazards
        for (const c of data.claims) {
            try {
                validateClaimValue(c.value);
            } catch (err: any) {
                return { success: false, error: `Invalid claim value for key ${c.key}: ${err?.message || err}` };
            }
        }

        // 3. Claims inconsistent with claimCount
        if (data.claims.length !== data.claimCount) {
            return { success: false, error: "Claims array length must equal claimCount" };
        }

        // 4. Merkle root inconsistent with credential ID and full claims
        try {
            const tree = new MerkleClaimTreeV2(data.id, data.claims);
            if (tree.root !== data.merkleRoot) {
                return { success: false, error: "Merkle root mismatch with claims" };
            }
        } catch (err: any) {
            return { success: false, error: `Failed to construct Merkle tree: ${err?.message || err}` };
        }

        // 5. Invalid Ethereum addresses
        if (!isAddress(data.issuerSigningAddress)) {
            return { success: false, error: "Invalid issuerSigningAddress" };
        }
        if (!isAddress(data.holder)) {
            return { success: false, error: "Invalid holder address" };
        }

        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
    }
}

export function parseVerificationRequestV1(obj: unknown): { success: true; data: VerificationRequestV1 } | { success: false; error: string } {
    try {
        const res = verificationRequestV1Schema.safeParse(obj);
        if (!res.success) {
            return { success: false, error: res.error.message };
        }
        const data = res.data;

        // Semantic checks:
        // 1. Policy array bounds (1..256)
        if (data.requiredClaimKeys.length < 1 || data.requiredClaimKeys.length > 256) {
            return { success: false, error: "requiredClaimKeys array length must be between 1 and 256" };
        }
        if (data.acceptedIssuerIds.length < 1 || data.acceptedIssuerIds.length > 256) {
            return { success: false, error: "acceptedIssuerIds array length must be between 1 and 256" };
        }
        if (data.acceptedSchemaURIs.length < 1 || data.acceptedSchemaURIs.length > 256) {
            return { success: false, error: "acceptedSchemaURIs array length must be between 1 and 256" };
        }

        // Helper to check sorted and unique
        function checkSortedAndUnique(arr: string[]): boolean {
            for (let i = 1; i < arr.length; i++) {
                if (asciiCompare(arr[i]!, arr[i - 1]!) <= 0) {
                    return false;
                }
            }
            return true;
        }

        // 3. Duplicate or unsorted arrays
        if (!checkSortedAndUnique(data.requiredClaimKeys)) {
            return { success: false, error: "requiredClaimKeys must be sorted and unique" };
        }
        if (!checkSortedAndUnique(data.acceptedIssuerIds)) {
            return { success: false, error: "acceptedIssuerIds must be sorted and unique" };
        }
        if (!checkSortedAndUnique(data.acceptedSchemaURIs)) {
            return { success: false, error: "acceptedSchemaURIs must be sorted and unique" };
        }

        // 4. Policy hashes inconsistent with their arrays
        if (hashPolicyArray(data.requiredClaimKeys) !== data.requiredClaimsHash) {
            return { success: false, error: "requiredClaimsHash mismatch" };
        }
        if (hashPolicyArray(data.acceptedIssuerIds) !== data.acceptedIssuerIdsHash) {
            return { success: false, error: "acceptedIssuerIdsHash mismatch" };
        }
        if (hashPolicyArray(data.acceptedSchemaURIs) !== data.acceptedSchemaURIsHash) {
            return { success: false, error: "acceptedSchemaURIsHash mismatch" };
        }

        // 5. expiresAt <= issuedAt or lifetime over 15 minutes
        if (data.expiresAt <= data.issuedAt) {
            return { success: false, error: "expiresAt must be after issuedAt" };
        }
        if (data.expiresAt - data.issuedAt > 15 * 60) {
            return { success: false, error: "Verification request lifetime cannot exceed 15 minutes" };
        }

        // 6. Invalid Ethereum address
        if (!isAddress(data.verifier)) {
            return { success: false, error: "Invalid verifier address" };
        }

        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
    }
}

export function parsePresentationV2(obj: unknown): { success: true; data: PresentationV2 } | { success: false; error: string } {
    try {
        const res = presentationV2Schema.safeParse(obj);
        if (!res.success) {
            return { success: false, error: res.error.message };
        }
        const data = res.data;

        // Semantic checks:
        // 1. Duplicate or unsorted disclosure keys
        for (let i = 1; i < data.disclosed.length; i++) {
            if (asciiCompare(data.disclosed[i]!.key, data.disclosed[i - 1]!.key) <= 0) {
                return { success: false, error: "disclosed claims must be sorted and unique by key" };
            }
        }

        // 2. Invalid disclosed values
        for (const disc of data.disclosed) {
            try {
                validateClaimValue(disc.value);
            } catch (err: any) {
                return { success: false, error: `Invalid disclosed claim value for key ${disc.key}: ${err?.message || err}` };
            }
        }

        // 3. Invalid static authorization time ordering/lifetime
        const presAuth = data.presentationAuthorization;
        if (presAuth.expiresAt <= presAuth.createdAt) {
            return { success: false, error: "Presentation authorization expiresAt must be after createdAt" };
        }
        if (presAuth.expiresAt - presAuth.createdAt > 5 * 60) {
            return { success: false, error: "Presentation authorization lifetime cannot exceed 5 minutes" };
        }

        // 4. Authorization holder differing from credential holder
        if (presAuth.holder.toLowerCase() !== data.credential.holder.toLowerCase()) {
            return { success: false, error: "Presentation authorization holder must match credential holder" };
        }

        // Also check address structures of the credential
        if (!isAddress(data.credential.issuerSigningAddress) || !isAddress(data.credential.holder)) {
            return { success: false, error: "Invalid Ethereum addresses in credential" };
        }

        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
    }
}
