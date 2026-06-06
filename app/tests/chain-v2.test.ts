import {describe, expect, it} from "vitest";
import {
    AnchorMismatchCode,
    StatusV2Enum,
    compareAnchorToCredentialV2,
    computeAnchorKeyV2,
    computeHolderCommitmentV2,
    credentialRegistryV2Abi,
    issuerRegistryV2Abi
} from "../src/chain/v2/index.js";
import {v2} from "../src/core/index.js";
import {keyPairFromPrivateKey} from "../src/core/ecc.js";

const ISSUER_PRIV =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HOLDER_PRIV =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const organizationId = "0x" + "1".repeat(64);
const credentialId = "0x" + "2".repeat(64);
const issuerSigningAddress = keyPairFromPrivateKey(ISSUER_PRIV).address;
const holderAddress = keyPairFromPrivateKey(HOLDER_PRIV).address;

const anchorKeyGolden =
    "0x2a87348946bdf46ebb63d1846fdcfdb745dbe901e569eef9e877e158ee88a30f";
const holderCommitmentGolden =
    "0x9a46ee632316ea4ccefa7fb88c335e2b09d47f9e2d07f1e2eb0a59f9a4cc3db3";

const credential = v2.issueCredentialV2(ISSUER_PRIV, {
    id: credentialId,
    issuerOrganizationId: organizationId,
    issuerSigningAddress,
    holder: holderAddress,
    credentialType: "Bachelor of Science",
    schemaURI: "https://schema.hust.edu.vn",
    issuedAt: 1717600000,
    expiresAt: 1717700000,
    claims: [
        {key: "gpa", value: 3.8, salt: "0x" + "5".repeat(64)},
        {
            key: "course:CS202",
            value: {name: "Data Structures", grade: "A"},
            salt: "0x" + "6".repeat(64)
        }
    ]
});

const baseAnchor = {
    credentialDigest: v2.credentialDigestV2({
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
    }),
    merkleRoot: credential.merkleRoot,
    holderCommitment: computeHolderCommitmentV2(
        credential.issuerOrganizationId,
        credential.issuerSigningAddress,
        credential.id,
        credential.holder
    ),
    organizationId: credential.issuerOrganizationId,
    issuerSigningAddress: credential.issuerSigningAddress,
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
    revocationIndex: 7n,
    claimCount: credential.claimCount,
    exists: true
} as const;

describe("Chain V2 Helpers", () => {
    it("computes the signer-scoped anchor key with a fixed golden vector", () => {
        expect(
            computeAnchorKeyV2(organizationId, issuerSigningAddress, credentialId)
        ).toBe(anchorKeyGolden);
    });

    it("computes the holder commitment with a fixed golden vector", () => {
        expect(
            computeHolderCommitmentV2(
                organizationId,
                issuerSigningAddress,
                credentialId,
                holderAddress
            )
        ).toBe(holderCommitmentGolden);
    });

    it("keeps the V2 status enum ordering stable", () => {
        expect(StatusV2Enum).toEqual({
            Unknown: 0,
            Valid: 1,
            Revoked: 2,
            Expired: 3,
            IssuerInactive: 4
        });
    });

    it("keeps the ABI signatures and tuple layouts stable", () => {
        expect(issuerRegistryV2Abi).toContain(
            "function wasAuthorizedKeyAt(bytes32 organizationId, address signingKey, uint64 timestamp) view returns (bool)"
        );
        expect(credentialRegistryV2Abi).toContain(
            "function statusOf(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (uint8)"
        );
        expect(credentialRegistryV2Abi).toContain(
            "function getAnchor(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (tuple(bytes32 credentialDigest, bytes32 merkleRoot, bytes32 holderCommitment, bytes32 organizationId, address issuerSigningAddress, uint64 issuedAt, uint64 expiresAt, uint64 revocationIndex, uint32 claimCount, bool exists))"
        );
    });

    it("matches a fully consistent anchor against a credential", () => {
        const result = compareAnchorToCredentialV2(baseAnchor, credential);
        expect(result.matches).toBe(true);
        expect(result.mismatches).toEqual([]);
    });

    it("returns a stable organization mismatch code", () => {
        const result = compareAnchorToCredentialV2(
            {...baseAnchor, organizationId: "0x" + "9".repeat(64)},
            credential
        );
        expect(result.matches).toBe(false);
        expect(result.mismatches[0]?.code).toBe(AnchorMismatchCode.OrganizationIdMismatch);
    });

    it("returns a stable signer mismatch code", () => {
        const result = compareAnchorToCredentialV2(
            {...baseAnchor, issuerSigningAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"},
            credential
        );
        expect(result.mismatches[0]?.code).toBe(
            AnchorMismatchCode.IssuerSigningAddressMismatch
        );
    });

    it("returns a stable digest mismatch code", () => {
        const result = compareAnchorToCredentialV2(
            {...baseAnchor, credentialDigest: "0x" + "a".repeat(64)},
            credential
        );
        expect(result.mismatches[0]?.code).toBe(AnchorMismatchCode.CredentialDigestMismatch);
    });

    it("returns a stable merkle root mismatch code", () => {
        const result = compareAnchorToCredentialV2(
            {...baseAnchor, merkleRoot: "0x" + "b".repeat(64)},
            credential
        );
        expect(result.mismatches[0]?.code).toBe(AnchorMismatchCode.MerkleRootMismatch);
    });

    it("returns a stable holder commitment mismatch code", () => {
        const result = compareAnchorToCredentialV2(
            {...baseAnchor, holderCommitment: "0x" + "c".repeat(64)},
            credential
        );
        expect(result.mismatches[0]?.code).toBe(
            AnchorMismatchCode.HolderCommitmentMismatch
        );
    });

    it("returns stable issuedAt, expiresAt, and claimCount mismatch codes", () => {
        const result = compareAnchorToCredentialV2(
            {
                ...baseAnchor,
                issuedAt: credential.issuedAt + 1,
                expiresAt: credential.expiresAt + 1,
                claimCount: credential.claimCount + 1
            },
            credential
        );
        expect(result.mismatches.map((mismatch) => mismatch.code)).toEqual([
            AnchorMismatchCode.IssuedAtMismatch,
            AnchorMismatchCode.ExpiresAtMismatch,
            AnchorMismatchCode.ClaimCountMismatch
        ]);
    });
});
