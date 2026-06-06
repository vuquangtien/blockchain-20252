import {keyPairFromPrivateKey} from "../core/ecc.js";
import type {Hex} from "../core/hash.js";
import {
    asciiCompare,
    type ClaimV2,
    type CredentialV2,
    type PresentationV2,
    type VerificationRequestV1
} from "../core/v2/types.js";
import {
    createPresentationV2,
    createVerificationRequest,
    credentialDigestV2,
    issueCredentialV2,
    presentationAuthorizationDigest,
    verificationRequestDigest
} from "../core/v2/protocol.js";
import {
    computeAnchorKeyV2,
    computeHolderCommitmentV2
} from "../chain/v2/types.js";

export const DEMO_PRIVATE_KEYS = {
    admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
    issuer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
    holder: "0x5de4111afa73d9b5c2f207f1a826f837756d661c9c8d15d66d5b4eae3b6ff359" as Hex,
    verifier: "0x7c852118294dfa4452a93df3bd9c89f0b534ee2b9a8f0db5e6d38b8a8e8b3079" as Hex
} as const;

export const DEMO_IDENTITIES = {
    admin: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.admin),
    issuer: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.issuer),
    holder: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.holder),
    verifier: keyPairFromPrivateKey(DEMO_PRIVATE_KEYS.verifier)
} as const;

export const DEMO_ORGANIZATION = {
    id: "0x" + "4".repeat(64) as Hex,
    name: "Hanoi University of Science and Technology",
    metadataURI: "ipfs://hust/protocol-v2/demo-registry",
    controllerAddress: DEMO_IDENTITIES.verifier.address as `0x${string}`
} as const;

export const DEMO_AUDIENCE = "Capstone verification terminal";
export const DEMO_SCHEMA_URI =
    "https://hust.edu.vn/schemas/academic-credential-v2.json";
export const DEMO_REQUIRED_CLAIMS = [
    "degree:field",
    "gpa",
    "thesis"
] as const;

export const DEMO_ROLE_COPY = {
    registerOrganization: "Admin or registry owner registers organizations.",
    suspendOrganization: "Admin or registry owner suspends organizations.",
    anchorCredential: "Issuer signing key anchors credentials.",
    revokeCredential: "Issuer signing key revokes credentials.",
    organizationAdministration:
        "Organization controller handles organization-side administration where the contracts permit it."
} as const;

export interface DemoPolicyState {
    selectedClaimKeys: string[];
    requiredClaimKeys: string[];
    missingClaimKeys: string[];
    extraClaimKeys: string[];
    exactMatch: boolean;
    disclosedCount: number;
    hiddenCount: number;
    hiddenClaimKeys: string[];
}

export interface DemoScenario {
    credential: CredentialV2;
    request: VerificationRequestV1;
    presentation: PresentationV2 | null;
    presentationError?: string;
    policy: DemoPolicyState;
    credentialDigest: Hex;
    requestDigest: Hex;
    presentationAuthorizationDigest?: Hex;
    anchorKey: Hex;
    holderCommitment: Hex;
}

const DEMO_CLAIMS: readonly ClaimV2[] = [
    {
        key: "degree:field",
        value: {
            level: "Bachelor of Engineering",
            school: "School of Information and Communication Technology",
            discipline: "Computer Science"
        },
        salt: ("0x" + "11".repeat(32)) as Hex
    },
    {
        key: "degree:title",
        value: "Bachelor of Engineering in Computer Science",
        salt: ("0x" + "12".repeat(32)) as Hex
    },
    {
        key: "gpa",
        value: {value: 3.72, scale: 4, honors: "Very Good"},
        salt: ("0x" + "13".repeat(32)) as Hex
    },
    {
        key: "thesis",
        value: {
            title: "Selective Disclosure Proof Systems for Academic Credentials",
            grade: "A",
            supervisor: "Assoc. Prof. Nguyen T. Minh"
        },
        salt: ("0x" + "14".repeat(32)) as Hex
    },
    {
        key: "course:CS431",
        value: {
            name: "Applied Cryptography",
            semester: "20251",
            credits: 3,
            grade: "A"
        },
        salt: ("0x" + "15".repeat(32)) as Hex
    },
    {
        key: "course:CS451",
        value: {
            name: "Distributed Systems",
            semester: "20251",
            credits: 3,
            grade: "A-"
        },
        salt: ("0x" + "16".repeat(32)) as Hex
    },
    {
        key: "course:MATH302",
        value: {
            name: "Probability and Statistics",
            semester: "20242",
            credits: 3,
            grade: "B+"
        },
        salt: ("0x" + "17".repeat(32)) as Hex
    },
    {
        key: "research:lab",
        value: {
            lab: "Secure Systems Lab",
            topic: "Privacy-preserving credential infrastructure"
        },
        salt: ("0x" + "18".repeat(32)) as Hex
    }
] as const;

export function summarizeClaimValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
}

export function derivePolicyState(selectedClaimKeys: Iterable<string>): DemoPolicyState {
    const selected = [...new Set(selectedClaimKeys)].sort(asciiCompare);
    const required = [...DEMO_REQUIRED_CLAIMS].sort(asciiCompare);
    const selectedSet = new Set(selected);

    const missingClaimKeys = required.filter((key) => !selectedSet.has(key));
    const extraClaimKeys = selected.filter((key) => !required.includes(key as typeof required[number]));
    const hiddenClaimKeys = DEMO_CLAIMS
        .map((claim) => claim.key)
        .filter((claimKey) => !selectedSet.has(claimKey))
        .sort(asciiCompare);

    return {
        selectedClaimKeys: selected,
        requiredClaimKeys: required,
        missingClaimKeys,
        extraClaimKeys,
        exactMatch: missingClaimKeys.length === 0 && extraClaimKeys.length === 0,
        disclosedCount: selected.length,
        hiddenCount: hiddenClaimKeys.length,
        hiddenClaimKeys
    };
}

export function createDemoScenario(
    selectedClaimKeys: Iterable<string>,
    now = Math.floor(Date.now() / 1000)
): DemoScenario {
    const policy = derivePolicyState(selectedClaimKeys);
    const issuedAt = now - 120;
    const requestIssuedAt = now - 20;
    const requestExpiresAt = now + 8 * 60;
    const presentationCreatedAt = now;
    const presentationExpiresAt = Math.min(requestExpiresAt, now + 4 * 60);

    const credential = issueCredentialV2(DEMO_PRIVATE_KEYS.issuer, {
        id: ("0x" + "2".repeat(64)) as Hex,
        issuerOrganizationId: DEMO_ORGANIZATION.id,
        issuerSigningAddress: DEMO_IDENTITIES.issuer.address,
        holder: DEMO_IDENTITIES.holder.address,
        credentialType: "Bachelor of Engineering",
        schemaURI: DEMO_SCHEMA_URI,
        issuedAt,
        expiresAt: 0,
        claims: [...DEMO_CLAIMS]
    });

    const request = createVerificationRequest(DEMO_PRIVATE_KEYS.verifier, {
        id: ("0x" + "3".repeat(64)) as Hex,
        verifier: DEMO_IDENTITIES.verifier.address,
        audience: DEMO_AUDIENCE,
        nonce: ("0x" + "5".repeat(64)) as Hex,
        requiredClaimKeys: [...DEMO_REQUIRED_CLAIMS],
        acceptedIssuerIds: [DEMO_ORGANIZATION.id],
        acceptedSchemaURIs: [DEMO_SCHEMA_URI],
        issuedAt: requestIssuedAt,
        expiresAt: requestExpiresAt
    });

    const credentialDigest = credentialDigestV2({
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
        claimCount: credential.claimCount
    }) as Hex;
    const requestDigest = verificationRequestDigest(request) as Hex;
    const anchorKey = computeAnchorKeyV2(
        credential.issuerOrganizationId as Hex,
        credential.issuerSigningAddress as `0x${string}`,
        credential.id as Hex
    );
    const holderCommitment = computeHolderCommitmentV2(
        credential.issuerOrganizationId as Hex,
        credential.issuerSigningAddress as `0x${string}`,
        credential.id as Hex,
        credential.holder as `0x${string}`
    );

    if (!policy.exactMatch) {
        return {
            credential,
            request,
            presentation: null,
            presentationError: describePolicyMismatch(policy),
            policy,
            credentialDigest,
            requestDigest,
            anchorKey,
            holderCommitment
        };
    }

    const presentation = createPresentationV2(
        credential,
        request,
        policy.selectedClaimKeys,
        DEMO_PRIVATE_KEYS.holder,
        presentationCreatedAt,
        presentationExpiresAt
    );

    return {
        credential,
        request,
        presentation,
        policy,
        credentialDigest,
        requestDigest,
        presentationAuthorizationDigest: presentationAuthorizationDigest(
            presentation.presentationAuthorization
        ) as Hex,
        anchorKey,
        holderCommitment
    };
}

function describePolicyMismatch(policy: DemoPolicyState): string {
    const fragments: string[] = [];
    if (policy.missingClaimKeys.length > 0) {
        fragments.push(`missing ${policy.missingClaimKeys.join(", ")}`);
    }
    if (policy.extraClaimKeys.length > 0) {
        fragments.push(`extra ${policy.extraClaimKeys.join(", ")}`);
    }
    return `Selective disclosure must exactly match the verifier request: ${fragments.join("; ")}.`;
}
