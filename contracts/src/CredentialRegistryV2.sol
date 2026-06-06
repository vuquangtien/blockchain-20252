// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICredentialRegistryV2} from "./ICredentialRegistryV2.sol";
import {IIssuerRegistryV2} from "./IIssuerRegistryV2.sol";

contract CredentialRegistryV2 is ICredentialRegistryV2 {
    IIssuerRegistryV2 public immutable issuerRegistry;

    mapping(bytes32 anchorKey => CredentialAnchor) private _anchors;
    mapping(bytes32 organizationId => uint64) private _nextRevocationIndex;
    mapping(bytes32 organizationId => mapping(uint256 wordIndex => uint256 bitmap)) private
        _revocationBitmap;

    error ZeroOrganizationId();
    error ZeroCredentialId();
    error ZeroCredentialDigest();
    error ZeroHolderCommitment();
    error ZeroMerkleRoot();
    error ZeroIssuerSigningAddress();
    error ZeroRegistryAddress();
    error InvalidClaimCount(uint32 claimCount);
    error InvalidExpiry(uint64 issuedAt, uint64 expiresAt);
    error InvalidIssuedAt(uint64 issuedAt, uint64 blockTimestamp);
    error OrganizationInactive(bytes32 organizationId);
    error UnauthorizedSigningKey(bytes32 organizationId, address caller);
    error SigningKeyNotAuthorizedAtIssuedAt(
        bytes32 organizationId, address caller, uint64 issuedAt
    );
    error AnchorAlreadyExists(bytes32 anchorKey);
    error AnchorNotFound(bytes32 anchorKey);
    error UnauthorizedRevoker(bytes32 organizationId, address caller);
    error CredentialAlreadyRevoked(bytes32 anchorKey);

    constructor(IIssuerRegistryV2 registry) {
        if (address(registry) == address(0)) revert ZeroRegistryAddress();
        issuerRegistry = registry;
    }

    function anchorCredential(
        bytes32 organizationId,
        bytes32 credentialId,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt,
        uint32 claimCount
    ) external {
        if (organizationId == bytes32(0)) revert ZeroOrganizationId();
        if (credentialId == bytes32(0)) revert ZeroCredentialId();
        if (credentialDigest == bytes32(0)) revert ZeroCredentialDigest();
        if (holderCommitment == bytes32(0)) revert ZeroHolderCommitment();
        if (merkleRoot == bytes32(0)) revert ZeroMerkleRoot();
        if (claimCount == 0 || claimCount > 256) revert InvalidClaimCount(claimCount);
        if (issuedAt > uint64(block.timestamp) + 60) {
            revert InvalidIssuedAt(issuedAt, uint64(block.timestamp));
        }
        if (expiresAt != 0 && expiresAt <= issuedAt) revert InvalidExpiry(issuedAt, expiresAt);
        if (!issuerRegistry.isOrganizationActive(organizationId)) {
            revert OrganizationInactive(organizationId);
        }
        if (!issuerRegistry.isCurrentlyAuthorizedKey(organizationId, msg.sender)) {
            revert UnauthorizedSigningKey(organizationId, msg.sender);
        }
        if (!issuerRegistry.wasAuthorizedKeyAt(organizationId, msg.sender, issuedAt)) {
            revert SigningKeyNotAuthorizedAtIssuedAt(organizationId, msg.sender, issuedAt);
        }

        bytes32 anchorKey = computeAnchorKey(organizationId, msg.sender, credentialId);
        if (_anchors[anchorKey].exists) revert AnchorAlreadyExists(anchorKey);

        uint64 revocationIndex = _nextRevocationIndex[organizationId];
        _nextRevocationIndex[organizationId] = revocationIndex + 1;

        _anchors[anchorKey] = CredentialAnchor({
            credentialDigest: credentialDigest,
            merkleRoot: merkleRoot,
            holderCommitment: holderCommitment,
            organizationId: organizationId,
            issuerSigningAddress: msg.sender,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            revocationIndex: revocationIndex,
            claimCount: claimCount,
            exists: true
        });

        emit CredentialAnchored(
            anchorKey,
            organizationId,
            msg.sender,
            credentialId,
            credentialDigest,
            holderCommitment,
            merkleRoot,
            issuedAt,
            expiresAt,
            revocationIndex,
            claimCount
        );
    }

    function revokeCredential(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId,
        bytes32 reasonHash
    ) external {
        if (issuerSigningAddress == address(0)) {
            revert ZeroIssuerSigningAddress();
        }
        bytes32 anchorKey = computeAnchorKey(organizationId, issuerSigningAddress, credentialId);
        CredentialAnchor storage anchor = _anchors[anchorKey];
        if (!anchor.exists) revert AnchorNotFound(anchorKey);

        bool isController = issuerRegistry.isOrganizationController(organizationId, msg.sender);
        bool isCurrentKey = issuerRegistry.isCurrentlyAuthorizedKey(organizationId, msg.sender);
        if (!isController && !isCurrentKey) revert UnauthorizedRevoker(organizationId, msg.sender);

        (uint256 wordIndex, uint256 mask) = _bitmapPosition(anchor.revocationIndex);
        if ((_revocationBitmap[organizationId][wordIndex] & mask) != 0) {
            revert CredentialAlreadyRevoked(anchorKey);
        }

        _revocationBitmap[organizationId][wordIndex] |= mask;

        emit CredentialRevoked(
            anchorKey, organizationId, msg.sender, credentialId, anchor.revocationIndex, reasonHash
        );
    }

    function isRevoked(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        public
        view
        returns (bool)
    {
        if (issuerSigningAddress == address(0)) return false;
        bytes32 anchorKey = computeAnchorKey(organizationId, issuerSigningAddress, credentialId);
        CredentialAnchor storage anchor = _anchors[anchorKey];
        if (!anchor.exists) return false;
        (uint256 wordIndex, uint256 mask) = _bitmapPosition(anchor.revocationIndex);
        return (_revocationBitmap[organizationId][wordIndex] & mask) != 0;
    }

    function revocationWord(bytes32 organizationId, uint256 wordIndex)
        external
        view
        returns (uint256)
    {
        return _revocationBitmap[organizationId][wordIndex];
    }

    function getAnchor(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        external
        view
        returns (CredentialAnchor memory)
    {
        bytes32 anchorKey = computeAnchorKey(organizationId, issuerSigningAddress, credentialId);
        CredentialAnchor memory anchor = _anchors[anchorKey];
        if (!anchor.exists) revert AnchorNotFound(anchorKey);
        return anchor;
    }

    function statusOf(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId)
        public
        view
        returns (Status)
    {
        if (issuerSigningAddress == address(0)) return Status.Unknown;
        bytes32 anchorKey = computeAnchorKey(organizationId, issuerSigningAddress, credentialId);
        CredentialAnchor storage anchor = _anchors[anchorKey];
        if (!anchor.exists) return Status.Unknown;
        if (isRevoked(organizationId, issuerSigningAddress, credentialId)) return Status.Revoked;
        if (anchor.expiresAt != 0 && uint64(block.timestamp) >= anchor.expiresAt) {
            return Status.Expired;
        }
        if (!issuerRegistry.isOrganizationActive(organizationId)) return Status.IssuerInactive;
        return Status.Valid;
    }

    function isCurrentlyValid(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId
    ) external view returns (bool) {
        return statusOf(organizationId, issuerSigningAddress, credentialId) == Status.Valid;
    }

    function computeAnchorKey(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(organizationId, issuerSigningAddress, credentialId));
    }

    function computeHolderCommitment(
        bytes32 organizationId,
        address issuerSigningAddress,
        bytes32 credentialId,
        address holderAddress
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(organizationId, issuerSigningAddress, credentialId, holderAddress)
        );
    }

    function nextRevocationIndex(bytes32 organizationId) external view returns (uint64) {
        return _nextRevocationIndex[organizationId];
    }

    function _bitmapPosition(uint64 revocationIndex)
        internal
        pure
        returns (uint256 wordIndex, uint256 mask)
    {
        wordIndex = uint256(revocationIndex >> 8);
        uint256 bitIndex = uint256(revocationIndex & 255);
        mask = uint256(1) << bitIndex;
    }
}
