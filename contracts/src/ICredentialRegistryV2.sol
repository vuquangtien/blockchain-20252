// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICredentialRegistryV2 {
    struct CredentialAnchor {
        bytes32 credentialDigest;
        bytes32 merkleRoot;
        bytes32 holderCommitment;
        bytes32 organizationId;
        address issuerSigningAddress;
        uint64 issuedAt;
        uint64 expiresAt;
        uint64 revocationIndex;
        uint32 claimCount;
        bool exists;
    }

    enum Status {
        Unknown,
        Valid,
        Revoked,
        Expired,
        IssuerInactive
    }

    event CredentialAnchored(
        bytes32 indexed anchorKey,
        bytes32 indexed organizationId,
        address indexed issuerSigningAddress,
        bytes32 credentialId,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt,
        uint64 revocationIndex,
        uint32 claimCount
    );

    event CredentialRevoked(
        bytes32 indexed anchorKey,
        bytes32 indexed organizationId,
        address indexed revokedBy,
        bytes32 credentialId,
        uint64 revocationIndex,
        bytes32 reasonHash
    );

    function anchorCredential(
        bytes32 organizationId,
        bytes32 credentialId,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt,
        uint32 claimCount
    ) external;

    function revokeCredential(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId,
        bytes32 reasonHash
    ) external;

    function isRevoked(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        external
        view
        returns (bool);

    function revocationWord(bytes32 organizationId, uint256 wordIndex)
        external
        view
        returns (uint256);

    function getAnchor(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        external
        view
        returns (CredentialAnchor memory);

    function statusOf(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        external
        view
        returns (Status);

    function isCurrentlyValid(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId
    ) external view returns (bool);

    function computeAnchorKey(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId
    ) external pure returns (bytes32);

    function computeHolderCommitment(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId,
        address holderAddress
    ) external pure returns (bytes32);

    function nextRevocationIndex(bytes32 organizationId) external view returns (uint64);
}
