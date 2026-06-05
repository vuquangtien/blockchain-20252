import { z } from "zod";
import { TypedDataEncoder } from "ethers";
import { canonicalize } from "json-canonicalize";
import { keccak_256 } from "@noble/hashes/sha3";

import { hexToBytes, bytesToHex, utf8 } from "../hash.js";
import { signRawDigest, recoverFromDigest, keyPairFromPrivateKey } from "../ecc.js";
import {
    ClaimV2,
    CredentialV2,
    VerificationRequestV1,
    PresentationAuthorizationV1,
    DisclosedClaimV2,
    PresentationV2,
    VerificationResultV2,
    VerificationCheck,
    credentialV2BaseSchema,
    credentialV2Schema,
    verificationRequestV1Schema,
    presentationAuthorizationV1Schema,
    presentationV2Schema,
    claimKeyRegex,
    parseCredentialV2,
    parseVerificationRequestV1,
    parsePresentationV2,
    hashPolicyArray,
    hashDisclosedClaims,
    asciiCompare,
    nonzeroBytes32Schema,
    addressSchema,
    claimSchema
} from "./types.js";
import { validateClaimValue, validateTimestamp, validateExpirationTimestamp } from "./validation.js";
import { MerkleClaimTreeV2, verifyMerkleProofV2 } from "./merkle.js";

// EIP-712 Domain Configurations (omitting chainId and verifyingContract)
export const CREDENTIAL_DOMAIN = {
    name: "AcademicCredentialProtocol",
    version: "2"
};

export const REQUEST_DOMAIN = {
    name: "AcademicCredentialRequest",
    version: "1"
};

export const PRESENTATION_DOMAIN = {
    name: "AcademicCredentialPresentation",
    version: "1"
};

// EIP-712 Struct Type Definitions
export const CREDENTIAL_TYPES = {
    AcademicCredential: [
        { name: "id", type: "bytes32" },
        { name: "issuerOrganizationId", type: "bytes32" },
        { name: "issuerSigningAddress", type: "address" },
        { name: "holder", type: "address" },
        { name: "credentialType", type: "string" },
        { name: "schemaURI", type: "string" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
        { name: "merkleRoot", type: "bytes32" },
        { name: "claimCount", type: "uint32" }
    ]
};

export const REQUEST_TYPES = {
    AcademicCredentialRequest: [
        { name: "id", type: "bytes32" },
        { name: "verifier", type: "address" },
        { name: "audience", type: "string" },
        { name: "nonce", type: "bytes32" },
        { name: "requiredClaimsHash", type: "bytes32" },
        { name: "acceptedIssuerIdsHash", type: "bytes32" },
        { name: "acceptedSchemaURIsHash", type: "bytes32" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" }
    ]
};

export const PRESENTATION_TYPES = {
    AcademicCredentialPresentation: [
        { name: "credentialDigest", type: "bytes32" },
        { name: "requestDigest", type: "bytes32" },
        { name: "disclosureDigest", type: "bytes32" },
        { name: "holder", type: "address" },
        { name: "createdAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" }
    ]
};

// Digest Builders
export function credentialDigestV2(cred: Omit<CredentialV2, "signature" | "claims">): string {
    return TypedDataEncoder.hash(CREDENTIAL_DOMAIN, CREDENTIAL_TYPES, cred);
}

export function verificationRequestDigest(req: Omit<VerificationRequestV1, "signature">): string {
    const { requiredClaimKeys, acceptedIssuerIds, acceptedSchemaURIs, ...rest } = req as any;
    return TypedDataEncoder.hash(REQUEST_DOMAIN, REQUEST_TYPES, rest);
}

export function presentationAuthorizationDigest(presAuth: Omit<PresentationAuthorizationV1, "signature">): string {
    return TypedDataEncoder.hash(PRESENTATION_DOMAIN, PRESENTATION_TYPES, presAuth);
}


// Replay Guard Interface
export interface ReplayGuard {
    isConsumed(requestId: string): Promise<boolean>;
    consume(requestId: string): Promise<void>;
}

// Core API Implementations

const issueParamsSchema = z.object({
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
    claims: z.array(claimSchema).min(1, "between 1 and 256").max(256, "between 1 and 256")
}).strict();

export function issueCredentialV2(
    privateKey: string,
    params: {
        id: string;
        issuerOrganizationId: string;
        issuerSigningAddress: string;
        holder: string;
        credentialType: string;
        schemaURI: string;
        issuedAt: number;
        expiresAt: number;
        claims: ClaimV2[];
    }
): CredentialV2 {
    issueParamsSchema.parse(params);

    const derivedIssuer = keyPairFromPrivateKey(privateKey as `0x${string}`).address;
    if (derivedIssuer.toLowerCase() !== params.issuerSigningAddress.toLowerCase()) {
        throw new Error("Private key does not match issuer signing address");
    }

    const now = Math.floor(Date.now() / 1000);
    if (params.issuedAt > now + 60) {
        throw new Error("issuedAt cannot be more than 60 seconds in the future");
    }

    if (params.expiresAt !== 0) {
        if (params.expiresAt <= params.issuedAt) {
            throw new Error("Expiration time must be after issuance time");
        }
    }

    if (params.claims.length < 1 || params.claims.length > 256) {
        throw new Error("Credential claims count must be between 1 and 256");
    }

    const keys = new Set<string>();
    for (const c of params.claims) {
        if (!claimKeyRegex.test(c.key)) {
            throw new Error(`Invalid claim key format: ${c.key}`);
        }
        if (keys.has(c.key)) {
            throw new Error(`Duplicate claim key: ${c.key}`);
        }
        keys.add(c.key);
        validateClaimValue(c.value);
    }

    const tree = new MerkleClaimTreeV2(params.id, params.claims);

    const credMeta = {
        version: "2.0" as const,
        id: params.id,
        issuerOrganizationId: params.issuerOrganizationId,
        issuerSigningAddress: params.issuerSigningAddress,
        holder: params.holder,
        credentialType: params.credentialType,
        schemaURI: params.schemaURI,
        issuedAt: params.issuedAt,
        expiresAt: params.expiresAt,
        merkleRoot: tree.root as `0x${string}`,
        claimCount: params.claims.length,
        claims: params.claims
    };

    // Strict validation check of inputs through zod schema
    credentialV2BaseSchema.omit({ signature: true }).parse(credMeta);

    // Prepare metadata for EIP-712 hashing (excluding claims)
    const { claims: _omitClaims, ...credMetaForSign } = credMeta;
    void _omitClaims;
    const digest = credentialDigestV2(credMetaForSign);
    const signature = signRawDigest(privateKey as `0x${string}`, hexToBytes(digest));

    return {
        ...credMetaForSign,
        claims: params.claims,
        signature
    };
}

export function verifyCredentialSignatureV2(
    cred: Omit<CredentialV2, "signature" | "claims">,
    signature: string
): boolean {
    try {
        const digest = credentialDigestV2(cred);
        const recovered = recoverFromDigest(hexToBytes(digest), signature as `0x${string}`);
        return recovered.toLowerCase() === cred.issuerSigningAddress.toLowerCase();
    } catch {
        return false;
    }
}

const requestParamsSchema = z.object({
    id: nonzeroBytes32Schema,
    verifier: addressSchema,
    audience: z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 256,
        { message: "Audience must be <= 256 UTF-8 bytes" }
    ),
    nonce: nonzeroBytes32Schema,
    requiredClaimKeys: z.array(z.string().regex(claimKeyRegex, "Invalid claim key format")).min(1).max(256),
    acceptedIssuerIds: z.array(nonzeroBytes32Schema).min(1).max(256),
    acceptedSchemaURIs: z.array(z.string().refine(
        (val) => new TextEncoder().encode(val).length <= 512,
        { message: "Schema URI must be <= 512 UTF-8 bytes" }
    ).refine(
        (val) => val.startsWith("https:") || val.startsWith("ipfs:"),
        { message: "Schema URI must use https: or ipfs:" }
    )).min(1).max(256),
    issuedAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "issuedAt must be a safe integer" }),
    expiresAt: z.number().int().nonnegative().refine(Number.isSafeInteger, { message: "expiresAt must be a safe integer" }),
}).strict();

export function createVerificationRequest(
    privateKey: string,
    params: {
        id: string;
        verifier: string;
        audience: string;
        nonce: string;
        requiredClaimKeys: string[];
        acceptedIssuerIds: string[];
        acceptedSchemaURIs: string[];
        issuedAt: number;
        expiresAt: number;
    }
): VerificationRequestV1 {
    requestParamsSchema.parse(params);

    const derivedVerifier = keyPairFromPrivateKey(privateKey as `0x${string}`).address;
    if (derivedVerifier.toLowerCase() !== params.verifier.toLowerCase()) {
        throw new Error("Private key does not match verifier address");
    }

    const now = Math.floor(Date.now() / 1000);
    if (params.issuedAt > now + 60) {
        throw new Error("issuedAt cannot be more than 60 seconds in the future");
    }

    if (params.expiresAt <= params.issuedAt) {
        throw new Error("Expiration must be after issuance");
    }
    if (params.expiresAt - params.issuedAt > 15 * 60) {
        throw new Error("Request lifetime cannot exceed 15 minutes");
    }
    if (params.requiredClaimKeys.length < 1) {
        throw new Error("Must require at least one claim");
    }
    if (params.acceptedIssuerIds.length < 1) {
        throw new Error("Must accept at least one issuer organization ID");
    }
    if (params.acceptedSchemaURIs.length < 1) {
        throw new Error("Must accept at least one schema URI");
    }

    function checkDuplicates<T>(arr: T[], name: string): void {
        const seen = new Set<T>();
        for (const val of arr) {
            if (seen.has(val)) {
                throw new Error(`Duplicate entry in ${name}: ${val}`);
            }
            seen.add(val);
        }
    }
    checkDuplicates(params.requiredClaimKeys, "requiredClaimKeys");
    checkDuplicates(params.acceptedIssuerIds, "acceptedIssuerIds");
    checkDuplicates(params.acceptedSchemaURIs, "acceptedSchemaURIs");

    const sortedRequiredClaimKeys = [...params.requiredClaimKeys].sort(asciiCompare);
    const sortedAcceptedIssuerIds = [...params.acceptedIssuerIds].sort(asciiCompare);
    const sortedAcceptedSchemaURIs = [...params.acceptedSchemaURIs].sort(asciiCompare);

    const requiredClaimsHash = hashPolicyArray(sortedRequiredClaimKeys);
    const acceptedIssuerIdsHash = hashPolicyArray(sortedAcceptedIssuerIds);
    const acceptedSchemaURIsHash = hashPolicyArray(sortedAcceptedSchemaURIs);

    const requestMeta = {
        id: params.id,
        verifier: params.verifier,
        audience: params.audience,
        nonce: params.nonce,
        requiredClaimsHash,
        acceptedIssuerIdsHash,
        acceptedSchemaURIsHash,
        issuedAt: params.issuedAt,
        expiresAt: params.expiresAt,
        requiredClaimKeys: sortedRequiredClaimKeys,
        acceptedIssuerIds: sortedAcceptedIssuerIds,
        acceptedSchemaURIs: sortedAcceptedSchemaURIs
    };

    verificationRequestV1Schema.omit({ signature: true }).parse(requestMeta);

    const digest = verificationRequestDigest(requestMeta);
    const signature = signRawDigest(privateKey as `0x${string}`, hexToBytes(digest));

    return {
        ...requestMeta,
        signature
    };
}

export function verifyVerificationRequest(req: unknown): boolean {
    try {
        const parsed = parseVerificationRequestV1(req);
        if (!parsed.success) {
            return false;
        }
        const data = parsed.data;

        // Verify clock skew and expiration
        const now = Math.floor(Date.now() / 1000);
        if (data.issuedAt > now + 60) {
            return false;
        }
        if (now > data.expiresAt) {
            return false;
        }

        const digest = verificationRequestDigest(data);
        const recovered = recoverFromDigest(hexToBytes(digest), data.signature as `0x${string}`);
        return recovered.toLowerCase() === data.verifier.toLowerCase();
    } catch {
        return false;
    }
}

export function createPresentationV2(
    credential: CredentialV2,
    request: VerificationRequestV1,
    discloseKeys: string[],
    holderPrivateKey: string,
    createdAt: number,
    expiresAt: number
): PresentationV2 {
    // 1. Semantic validation of credential and request
    const parsedCred = parseCredentialV2(credential);
    if (!parsedCred.success) {
        throw new Error(`Invalid credential: ${parsedCred.error}`);
    }
    const parsedReq = parseVerificationRequestV1(request);
    if (!parsedReq.success) {
        throw new Error(`Invalid request: ${parsedReq.error}`);
    }

    // 2. Signature checking
    if (!verifyCredentialSignatureV2(parsedCred.data, parsedCred.data.signature)) {
        throw new Error("Invalid credential signature");
    }
    const reqDigest = verificationRequestDigest(parsedReq.data);
    const recoveredVerifier = recoverFromDigest(hexToBytes(reqDigest), parsedReq.data.signature as `0x${string}`);
    if (recoveredVerifier.toLowerCase() !== parsedReq.data.verifier.toLowerCase()) {
        throw new Error("Invalid request signature");
    }

    const derivedHolder = keyPairFromPrivateKey(holderPrivateKey as `0x${string}`).address;
    if (derivedHolder.toLowerCase() !== credential.holder.toLowerCase()) {
        throw new Error("Private key does not match holder address");
    }

    // 3. Timestamp skew and ordering safety checks
    const now = Math.floor(Date.now() / 1000);
    if (createdAt > now + 60) {
        throw new Error("createdAt cannot be more than 60 seconds in the future");
    }
    if (createdAt < request.issuedAt) {
        throw new Error("createdAt cannot be before request issuedAt");
    }
    if (expiresAt <= createdAt) {
        throw new Error("Presentation expiration must be after creation time");
    }
    if (expiresAt - createdAt > 5 * 60) {
        throw new Error("Presentation lifetime cannot exceed 5 minutes");
    }
    if (expiresAt > request.expiresAt) {
        throw new Error("Presentation expiration cannot outlive the verification request");
    }

    // Reject duplicate disclosure input
    const discloseSet = new Set(discloseKeys);
    if (discloseSet.size !== discloseKeys.length) {
        throw new Error("Duplicate claim keys in disclosure request");
    }

    // Require exact equality with request.requiredClaimKeys
    if (discloseSet.size !== request.requiredClaimKeys.length) {
        throw new Error("Disclosed keys must match requiredClaimKeys exactly");
    }
    for (const key of request.requiredClaimKeys) {
        if (!discloseSet.has(key)) {
            throw new Error(`Required claim key '${key}' not disclosed`);
        }
    }

    const tree = new MerkleClaimTreeV2(credential.id, credential.claims);

    const disclosed: DisclosedClaimV2[] = [];
    for (const key of discloseSet) {
        const claim = credential.claims.find((c) => c.key === key);
        if (!claim) {
            throw new Error(`Disclosed claim key '${key}' not found in credential`);
        }
        const proofObj = tree.proofFor(key);
        disclosed.push({
            key: claim.key,
            value: claim.value,
            salt: claim.salt,
            proof: proofObj.siblings,
            positions: proofObj.positions
        });
    }

    // Sort disclosed claims by key alphabetically for deterministic ASCII/code unit ordering
    disclosed.sort((a, b) => asciiCompare(a.key, b.key));

    const credentialDigest = credentialDigestV2(credential);
    const requestDigest = verificationRequestDigest(request);
    const disclosureDigest = hashDisclosedClaims(disclosed);

    const presAuth = {
        credentialDigest,
        requestDigest,
        disclosureDigest,
        holder: credential.holder,
        createdAt,
        expiresAt
    };

    presentationAuthorizationV1Schema.omit({ signature: true }).parse(presAuth);

    const digest = presentationAuthorizationDigest(presAuth);
    const signature = signRawDigest(holderPrivateKey as `0x${string}`, hexToBytes(digest));

    return {
        version: "2.0",
        credential: {
            version: credential.version,
            id: credential.id,
            issuerOrganizationId: credential.issuerOrganizationId,
            issuerSigningAddress: credential.issuerSigningAddress,
            holder: credential.holder,
            credentialType: credential.credentialType,
            schemaURI: credential.schemaURI,
            issuedAt: credential.issuedAt,
            expiresAt: credential.expiresAt,
            merkleRoot: credential.merkleRoot,
            claimCount: credential.claimCount,
            signature: credential.signature
        },
        disclosed,
        presentationAuthorization: {
            ...presAuth,
            signature
        }
    };
}

export async function verifyPresentationV2(
    presentation: any,
    request: any,
    options: {
        expectedAudience: string;
        expectedRequestDigest?: string;
        replayGuard?: ReplayGuard;
    }
): Promise<VerificationResultV2> {
    const checks: VerificationCheck[] = [];
    let disclosedClaims: ClaimV2[] = [];

    // Helper to log check results
    function addCheck(name: string, passed: boolean, code: string, detail?: string): boolean {
        checks.push({ name, passed, code, detail });
        return passed;
    }

    try {
        // 1. Structure check for presentation using Zod
        const parsedPresResult = parsePresentationV2(presentation);
        if (!parsedPresResult.success) {
            addCheck("structure_presentation", false, "MALFORMED_INPUT", parsedPresResult.error);
            return { valid: false, checks };
        }
        const pres = parsedPresResult.data;
        addCheck("structure_presentation", true, "OK");

        // 2. Structure check for request using Zod
        const parsedReqResult = parseVerificationRequestV1(request);
        if (!parsedReqResult.success) {
            addCheck("structure_request", false, "MALFORMED_INPUT", parsedReqResult.error);
            return { valid: false, checks };
        }
        const req = parsedReqResult.data;

        // Ensure request policy arrays are sorted and unique
        function isSortedAndUnique(arr: string[]): boolean {
            for (let i = 0; i < arr.length; i++) {
                if (i > 0) {
                    if (asciiCompare(arr[i]!, arr[i - 1]!) < 0) return false;
                    if (asciiCompare(arr[i]!, arr[i - 1]!) === 0) return false;
                }
            }
            return true;
        }
        if (!isSortedAndUnique(req.requiredClaimKeys) ||
            !isSortedAndUnique(req.acceptedIssuerIds) ||
            !isSortedAndUnique(req.acceptedSchemaURIs)) {
            addCheck("structure_request", false, "MALFORMED_INPUT", "Request policy arrays must be sorted and unique");
            return { valid: false, checks };
        }
        if (hashPolicyArray(req.requiredClaimKeys) !== req.requiredClaimsHash ||
            hashPolicyArray(req.acceptedIssuerIds) !== req.acceptedIssuerIdsHash ||
            hashPolicyArray(req.acceptedSchemaURIs) !== req.acceptedSchemaURIsHash) {
            addCheck("structure_request", false, "MALFORMED_INPUT", "Request policy hashes mismatch recomputed hashes");
            return { valid: false, checks };
        }
        addCheck("structure_request", true, "OK");

        // 3. Replay Protection
        if (options.replayGuard) {
            try {
                const isConsumed = await options.replayGuard.isConsumed(req.id);
                if (isConsumed) {
                    addCheck("replay_protection", false, "REPLAY_DETECTED", "Request ID has already been consumed");
                    return { valid: false, checks };
                }
            } catch (err: any) {
                addCheck("replay_protection", false, "REPLAY_GUARD_ERROR", err?.message || String(err));
                return { valid: false, checks };
            }
        }
        addCheck("replay_protection", true, "OK");

        // 4. Validate claim values format, depth, size, prototype pollution in disclosed claims
        let valueValidationPassed = true;
        const keysSeen = new Set<string>();
        for (const disc of pres.disclosed) {
            if (keysSeen.has(disc.key)) {
                addCheck("claim_values_format", false, "MALFORMED_INPUT", `Duplicate disclosed claim key '${disc.key}'`);
                valueValidationPassed = false;
                break;
            }
            keysSeen.add(disc.key);

            try {
                validateClaimValue(disc.value);
            } catch (err: any) {
                addCheck("claim_values_format", false, "MALFORMED_INPUT", `Disclosed key '${disc.key}' invalid value: ${err.message}`);
                valueValidationPassed = false;
                break;
            }
        }
        if (!valueValidationPassed) return { valid: false, checks };
        addCheck("claim_values_format", true, "OK");

        const now = Math.floor(Date.now() / 1000);

        // 5. Credential Expiration & Clock Skew Checks
        try {
            validateTimestamp(pres.credential.issuedAt);
            if (pres.credential.expiresAt !== 0) {
                validateExpirationTimestamp(pres.credential.expiresAt);
            }
        } catch (err: any) {
            addCheck("credential_not_expired", false, "FUTURE_TIMESTAMP", err.message);
            return { valid: false, checks };
        }
        if (pres.credential.expiresAt !== 0 && pres.credential.expiresAt <= pres.credential.issuedAt) {
            addCheck("credential_not_expired", false, "MALFORMED_INPUT", "Credential expiresAt is <= issuedAt");
            return { valid: false, checks };
        }
        if (pres.credential.expiresAt !== 0 && now > pres.credential.expiresAt) {
            addCheck("credential_not_expired", false, "INVALID_CREDENTIAL_EXPIRED", `Credential expired at ${pres.credential.expiresAt} (current: ${now})`);
            return { valid: false, checks };
        }
        addCheck("credential_not_expired", true, "OK");

        // 6. Verification Request Expiration & Clock Skew Checks
        try {
            validateTimestamp(req.issuedAt);
            validateExpirationTimestamp(req.expiresAt);
        } catch (err: any) {
            addCheck("request_not_expired", false, "FUTURE_TIMESTAMP", err.message);
            return { valid: false, checks };
        }
        if (req.expiresAt <= req.issuedAt) {
            addCheck("request_not_expired", false, "MALFORMED_INPUT", "Request expiresAt is <= issuedAt");
            return { valid: false, checks };
        }
        if (req.expiresAt - req.issuedAt > 15 * 60) {
            addCheck("request_not_expired", false, "INVALID_REQUEST_EXPIRED", "Request lifetime exceeds 15 minutes");
            return { valid: false, checks };
        }
        if (now > req.expiresAt) {
            addCheck("request_not_expired", false, "INVALID_REQUEST_EXPIRED", `Request expired at ${req.expiresAt} (current: ${now})`);
            return { valid: false, checks };
        }
        addCheck("request_not_expired", true, "OK");

        // 7. Presentation Authorization Expiration & Clock Skew Checks
        const presAuth = pres.presentationAuthorization;
        try {
            validateTimestamp(presAuth.createdAt);
            validateExpirationTimestamp(presAuth.expiresAt);
        } catch (err: any) {
            addCheck("presentation_not_expired", false, "FUTURE_TIMESTAMP", err.message);
            return { valid: false, checks };
        }
        if (presAuth.expiresAt <= presAuth.createdAt) {
            addCheck("presentation_not_expired", false, "MALFORMED_INPUT", "Presentation expiresAt is <= createdAt");
            return { valid: false, checks };
        }
        if (presAuth.expiresAt - presAuth.createdAt > 5 * 60) {
            addCheck("presentation_not_expired", false, "INVALID_PRESENTATION_EXPIRED", "Presentation lifetime exceeds 5 minutes");
            return { valid: false, checks };
        }
        if (now > presAuth.expiresAt) {
            addCheck("presentation_not_expired", false, "INVALID_PRESENTATION_EXPIRED", `Presentation expired at ${presAuth.expiresAt} (current: ${now})`);
            return { valid: false, checks };
        }
        addCheck("presentation_not_expired", true, "OK");

        // 8. Presentation Created Before Request Issued Check
        if (presAuth.createdAt < req.issuedAt) {
            addCheck("presentation_created_after_request", false, "INVALID_PRESENTATION_TIME", `Presentation created at ${presAuth.createdAt} before request issued at ${req.issuedAt}`);
            return { valid: false, checks };
        }
        addCheck("presentation_created_after_request", true, "OK");

        // 9. Presentation Outlives Request Check
        if (presAuth.expiresAt > req.expiresAt) {
            addCheck("presentation_not_outlive_request", false, "INVALID_PRESENTATION_OUTLIVES_REQUEST", "Presentation expires after Request");
            return { valid: false, checks };
        }
        addCheck("presentation_not_outlive_request", true, "OK");

        // 10. Audience Verification
        if (req.audience !== options.expectedAudience) {
            addCheck("audience_match", false, "INVALID_AUDIENCE", `Audience mismatch: expected '${options.expectedAudience}', got '${req.audience}'`);
            return { valid: false, checks };
        }
        addCheck("audience_match", true, "OK");

        // 11. Optional Request Digest Matching
        if (options.expectedRequestDigest) {
            const calculatedRequestDigest = verificationRequestDigest(req);
            if (calculatedRequestDigest !== options.expectedRequestDigest) {
                addCheck("request_digest_match", false, "INVALID_BINDING", "Request digest does not match expectedRequestDigest");
                return { valid: false, checks };
            }
        }
        addCheck("request_digest_match", true, "OK");

        // 12. Policy validation against request arrays directly
        if (!req.acceptedIssuerIds.includes(pres.credential.issuerOrganizationId)) {
            addCheck("policy_content_match", false, "POLICY_UNAUTHORIZED_ISSUER", "Issuer organization ID not accepted by policy");
            return { valid: false, checks };
        }
        if (!req.acceptedSchemaURIs.includes(pres.credential.schemaURI)) {
            addCheck("policy_content_match", false, "POLICY_UNAUTHORIZED_SCHEMA", "Credential schema URI not accepted by policy");
            return { valid: false, checks };
        }

        // Exact disclosure-set equality check
        const disclosedKeys = pres.disclosed.map((d) => d.key);
        if (disclosedKeys.length !== req.requiredClaimKeys.length ||
            !disclosedKeys.every((val, index) => val === req.requiredClaimKeys[index])) {
            addCheck("policy_content_match", false, "POLICY_DISCLOSURE_MISMATCH", "Disclosed keys must match requiredClaimKeys exactly");
            return { valid: false, checks };
        }
        addCheck("policy_content_match", true, "OK");

        // 13. Signature Validations: Verifier, Issuer, and Holder
        const isVerifierSigValid = verifyVerificationRequest(req);
        if (!isVerifierSigValid) {
            addCheck("verifier_signature", false, "INVALID_VERIFIER_SIGNATURE", "Verifier signature is invalid");
            return { valid: false, checks };
        }
        addCheck("verifier_signature", true, "OK");

        const isIssuerSigValid = verifyCredentialSignatureV2(pres.credential, pres.credential.signature);
        if (!isIssuerSigValid) {
            addCheck("issuer_signature", false, "INVALID_ISSUER_SIGNATURE", "Issuer signature is invalid");
            return { valid: false, checks };
        }
        addCheck("issuer_signature", true, "OK");

        const presAuthDigest = presentationAuthorizationDigest(presAuth);
        let holderRecovered: string;
        try {
            holderRecovered = recoverFromDigest(hexToBytes(presAuthDigest), presAuth.signature as `0x${string}`);
        } catch {
            addCheck("holder_signature", false, "INVALID_HOLDER_SIGNATURE", "Failed to recover holder address from signature");
            return { valid: false, checks };
        }

        if (holderRecovered.toLowerCase() !== pres.credential.holder.toLowerCase() ||
            holderRecovered.toLowerCase() !== presAuth.holder.toLowerCase()) {
            addCheck("holder_signature", false, "INVALID_HOLDER_SIGNATURE", "Recovered holder signature does not match credential holder");
            return { valid: false, checks };
        }
        addCheck("holder_signature", true, "OK");

        // 14. Merkle Proof verification for every disclosed claim
        let merkleProofsValid = true;
        for (const disc of pres.disclosed) {
            const isValidProof = verifyMerkleProofV2(
                pres.credential.id,
                disc.key,
                disc.value,
                disc.salt,
                disc.proof,
                disc.positions,
                pres.credential.merkleRoot
            );
            if (!isValidProof) {
                addCheck("merkle_proofs", false, "INVALID_MERKLE_PROOF", `Merkle proof failed for claim key '${disc.key}'`);
                merkleProofsValid = false;
                break;
            }
            disclosedClaims.push({ key: disc.key, value: disc.value, salt: disc.salt });
        }
        if (!merkleProofsValid) return { valid: false, checks };
        addCheck("merkle_proofs", true, "OK");

        // 15. Digest bindings validation
        const targetCredDigest = credentialDigestV2(pres.credential);
        const targetReqDigest = verificationRequestDigest(req);
        const targetDisclosureDigest = hashDisclosedClaims(pres.disclosed);

        if (presAuth.credentialDigest !== targetCredDigest) {
            addCheck("digest_bindings", false, "INVALID_BINDING", "presentationAuthorization.credentialDigest mismatch");
            return { valid: false, checks };
        }
        if (presAuth.requestDigest !== targetReqDigest) {
            addCheck("digest_bindings", false, "INVALID_BINDING", "presentationAuthorization.requestDigest mismatch");
            return { valid: false, checks };
        }
        if (presAuth.disclosureDigest !== targetDisclosureDigest) {
            addCheck("digest_bindings", false, "INVALID_BINDING", "presentationAuthorization.disclosureDigest mismatch");
            return { valid: false, checks };
        }
        addCheck("digest_bindings", true, "OK");

        // 16. Consume Request ID under the Replay Guard
        if (options.replayGuard) {
            try {
                await options.replayGuard.consume(req.id);
            } catch (err: any) {
                addCheck("replay_protection", false, "REPLAY_GUARD_ERROR", err?.message || String(err));
                return { valid: false, checks };
            }
        }

        return {
            valid: true,
            checks,
            disclosedClaims
        };

    } catch (err: any) {
        addCheck("generic_exception", false, "MALFORMED_INPUT", err?.message || String(err));
        return { valid: false, checks };
    }
}
