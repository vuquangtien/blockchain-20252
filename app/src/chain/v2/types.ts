import {AbiCoder, getAddress, keccak256} from "ethers";
import type {Hex} from "../../core/hash.js";
import type {CredentialV2} from "../../core/v2/types.js";
import {credentialDigestV2} from "../../core/v2/protocol.js";

const abiCoder = AbiCoder.defaultAbiCoder();

export interface ChainConfigV2 {
    rpcUrl: string;
    issuerRegistryV2: string;
    credentialRegistryV2: string;
}

export interface OrganizationV2 {
    controller: string;
    pendingController: string;
    name: string;
    metadataURI: string;
    registeredAt: number;
    suspendedAt: number;
    currentEpoch: number;
    active: boolean;
}

export interface SigningKeyRecord {
    organizationId: string;
    epoch: number;
    validFrom: number;
    validUntil: number;
    exists: boolean;
}

export interface AnchorV2Record {
    credentialDigest: Hex;
    merkleRoot: Hex;
    holderCommitment: Hex;
    organizationId: Hex;
    issuerSigningAddress: string;
    issuedAt: number;
    expiresAt: number;
    revocationIndex: bigint;
    claimCount: number;
    exists: boolean;
}

export const AnchorMismatchCode = {
    OrganizationIdMismatch: "ORGANIZATION_ID_MISMATCH",
    IssuerSigningAddressMismatch: "ISSUER_SIGNING_ADDRESS_MISMATCH",
    CredentialDigestMismatch: "CREDENTIAL_DIGEST_MISMATCH",
    MerkleRootMismatch: "MERKLE_ROOT_MISMATCH",
    HolderCommitmentMismatch: "HOLDER_COMMITMENT_MISMATCH",
    IssuedAtMismatch: "ISSUED_AT_MISMATCH",
    ExpiresAtMismatch: "EXPIRES_AT_MISMATCH",
    ClaimCountMismatch: "CLAIM_COUNT_MISMATCH"
} as const;

export type AnchorMismatchCode =
    (typeof AnchorMismatchCode)[keyof typeof AnchorMismatchCode];

export interface AnchorMismatch {
    code: AnchorMismatchCode;
    expected: string | number;
    actual: string | number;
}

export interface AnchorComparisonResult {
    matches: boolean;
    mismatches: AnchorMismatch[];
}

export type AnchorStatusNameV2 =
    | "Unknown"
    | "Valid"
    | "Revoked"
    | "Expired"
    | "IssuerInactive";

export function computeAnchorKeyV2(
    organizationId: Hex,
    issuerSigningAddress: `0x${string}`,
    credentialId: Hex
): Hex {
    return keccak256(
        abiCoder.encode(
            ["bytes32", "address", "bytes32"],
            [organizationId, getAddress(issuerSigningAddress), credentialId]
        )
    ) as Hex;
}

export function computeHolderCommitmentV2(
    organizationId: Hex,
    issuerSigningAddress: `0x${string}`,
    credentialId: Hex,
    holderAddress: `0x${string}`
): Hex {
    return keccak256(
        abiCoder.encode(
            ["bytes32", "address", "bytes32", "address"],
            [
                organizationId,
                getAddress(issuerSigningAddress),
                credentialId,
                getAddress(holderAddress)
            ]
        )
    ) as Hex;
}

export function compareAnchorToCredentialV2(
    anchor: AnchorV2Record,
    credential: CredentialV2
): AnchorComparisonResult {
    const expectedDigest = credentialDigestV2({
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
    });
    const expectedHolderCommitment = computeHolderCommitmentV2(
        credential.issuerOrganizationId as Hex,
        credential.issuerSigningAddress as `0x${string}`,
        credential.id as Hex,
        credential.holder as `0x${string}`
    );

    const mismatches: AnchorMismatch[] = [];

    if (anchor.organizationId !== credential.issuerOrganizationId) {
        mismatches.push({
            code: AnchorMismatchCode.OrganizationIdMismatch,
            expected: credential.issuerOrganizationId,
            actual: anchor.organizationId
        });
    }
    if (
        getAddress(anchor.issuerSigningAddress)
        !== getAddress(credential.issuerSigningAddress)
    ) {
        mismatches.push({
            code: AnchorMismatchCode.IssuerSigningAddressMismatch,
            expected: getAddress(credential.issuerSigningAddress),
            actual: getAddress(anchor.issuerSigningAddress)
        });
    }
    if (anchor.credentialDigest !== expectedDigest) {
        mismatches.push({
            code: AnchorMismatchCode.CredentialDigestMismatch,
            expected: expectedDigest,
            actual: anchor.credentialDigest
        });
    }
    if (anchor.merkleRoot !== credential.merkleRoot) {
        mismatches.push({
            code: AnchorMismatchCode.MerkleRootMismatch,
            expected: credential.merkleRoot,
            actual: anchor.merkleRoot
        });
    }
    if (anchor.holderCommitment !== expectedHolderCommitment) {
        mismatches.push({
            code: AnchorMismatchCode.HolderCommitmentMismatch,
            expected: expectedHolderCommitment,
            actual: anchor.holderCommitment
        });
    }
    if (anchor.issuedAt !== credential.issuedAt) {
        mismatches.push({
            code: AnchorMismatchCode.IssuedAtMismatch,
            expected: credential.issuedAt,
            actual: anchor.issuedAt
        });
    }
    if (anchor.expiresAt !== credential.expiresAt) {
        mismatches.push({
            code: AnchorMismatchCode.ExpiresAtMismatch,
            expected: credential.expiresAt,
            actual: anchor.expiresAt
        });
    }
    if (anchor.claimCount !== credential.claimCount) {
        mismatches.push({
            code: AnchorMismatchCode.ClaimCountMismatch,
            expected: credential.claimCount,
            actual: anchor.claimCount
        });
    }

    return {
        matches: mismatches.length === 0,
        mismatches
    };
}
