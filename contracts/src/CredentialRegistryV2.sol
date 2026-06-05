// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICredentialRegistryV2} from "./ICredentialRegistryV2.sol";
import {IIssuerRegistryV2} from "./IIssuerRegistryV2.sol";

/// @title CredentialRegistryV2
/// @notice Anchors Protocol V2 academic credentials on-chain and provides bitmap-based revocation.
/// @dev    Key design decisions:
///
///         SIGNER-SCOPED ANCHORING
///           `msg.sender` is recorded as the signer at anchor time. Only that exact address
///           (or the organization's current controller) may later revoke the credential.
///           A different authorized key of the same organization cannot replace or modify
///           an existing anchor — preventing one authorized signer from poisoning another's work.
///
///         BITMAP REVOCATION
///           A global sequential counter (`_nextRevocationIndex`) assigns each anchored
///           credential a unique index. Revocation sets a single bit in a packed
///           `mapping(uint256 slot => uint256 bitmask)`. This enables:
///             - O(1) revoke and lookup.
///             - Off-chain revocation lists (consumers iterate indices, not credential IDs).
///             - Same gas cost whether it is the first or last credential in a slot.
///
///         NO PII ON-CHAIN
///           Only `credentialDigest` (EIP-712 hash) and `holderCommitment`
///           (keccak256 of holder address) are stored. No claim keys, values, or
///           holder addresses appear in storage or events.
///
///         SECURITY INVARIANTS
///           - No `tx.origin`.
///           - No assembly, delegatecall, selfdestruct, or unchecked arithmetic.
///           - Checks-effects-interactions ordering: all state writes precede any external reads
///             that could trigger re-entrance (view-only calls on `issuerRegistry` are safe).
contract CredentialRegistryV2 is ICredentialRegistryV2 {
    // ─────────────────────────── State ──────────────────────────────────────

    IIssuerRegistryV2 public immutable issuerRegistry;

    mapping(bytes32 => AnchorV2) private _anchors;

    /// @dev Global sequential revocation index. Starts at 0; incremented per anchor.
    uint256 private _nextRevocationIndex;

    /// @dev Bitmap revocation storage.
    ///      slot   = revocationIndex / 256
    ///      bitPos = revocationIndex % 256
    ///      A bit set to 1 means that credential is revoked.
    mapping(uint256 => uint256) private _revocationBitmap;

    // ─────────────────────────── Errors ─────────────────────────────────────

    error NotAuthorizedSigner(address caller, bytes32 orgId);
    error OrgNotFound(bytes32 orgId);
    error CredentialAlreadyAnchored(bytes32 credentialId);
    error CredentialNotFound(bytes32 credentialId);
    error AlreadyRevoked(bytes32 credentialId);
    error CallerNotAuthorized(address caller);
    error InvalidExpiry(uint64 issuedAt, uint64 expiresAt);
    error ZeroCredentialId();
    error ZeroCredentialDigest();
    error ZeroHolderCommitment();
    error ZeroOrgId();

    // ─────────────────────────────────────────────────────────────────────────

    constructor(IIssuerRegistryV2 _issuerRegistry) {
        issuerRegistry = _issuerRegistry;
    }

    // ──────────────────────── Signer Mutations ──────────────────────────────

    /// @inheritdoc ICredentialRegistryV2
    function anchorCredentialV2(
        bytes32 credentialId,
        bytes32 orgId,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        uint64 issuedAt,
        uint64 expiresAt
    ) external override {
        // ── Checks ──────────────────────────────────────────────────────────
        if (credentialId == bytes32(0)) revert ZeroCredentialId();
        if (orgId == bytes32(0)) revert ZeroOrgId();
        if (credentialDigest == bytes32(0)) revert ZeroCredentialDigest();
        if (holderCommitment == bytes32(0)) revert ZeroHolderCommitment();
        if (_anchors[credentialId].exists) revert CredentialAlreadyAnchored(credentialId);
        if (expiresAt != 0 && expiresAt <= issuedAt) revert InvalidExpiry(issuedAt, expiresAt);

        // Verify that msg.sender is an authorized signing key for orgId right now.
        // wasAuthorizedAt uses block.timestamp which is safe (view-only external call).
        if (!issuerRegistry.wasAuthorizedAt(orgId, msg.sender, uint64(block.timestamp))) {
            revert NotAuthorizedSigner(msg.sender, orgId);
        }

        // ── Effects ─────────────────────────────────────────────────────────
        uint256 revIdx = _nextRevocationIndex;
        _nextRevocationIndex = revIdx + 1;

        _anchors[credentialId] = AnchorV2({
            orgId: orgId,
            signer: msg.sender,
            credentialDigest: credentialDigest,
            holderCommitment: holderCommitment,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            anchoredAt: uint64(block.timestamp),
            revocationIndex: revIdx,
            exists: true
        });

        emit CredentialAnchoredV2(
            credentialId,
            orgId,
            msg.sender,
            credentialDigest,
            holderCommitment,
            issuedAt,
            expiresAt,
            revIdx
        );
    }

    /// @inheritdoc ICredentialRegistryV2
    function revokeCredentialV2(bytes32 credentialId) external override {
        // ── Checks ──────────────────────────────────────────────────────────
        AnchorV2 storage anchor = _anchors[credentialId];
        if (!anchor.exists) revert CredentialNotFound(credentialId);

        // Only the original signer or the organization's current controller may revoke.
        // We read controller via an external view call before writing state (safe: no side effects).
        IIssuerRegistryV2.Organization memory org = issuerRegistry.getOrganization(anchor.orgId);
        bool isOriginalSigner = msg.sender == anchor.signer;
        bool isController = msg.sender == org.controller;
        if (!isOriginalSigner && !isController) revert CallerNotAuthorized(msg.sender);

        uint256 revIdx = anchor.revocationIndex;
        if (_isBitSet(revIdx)) revert AlreadyRevoked(credentialId);

        // ── Effects ─────────────────────────────────────────────────────────
        _setBit(revIdx);

        emit CredentialRevokedV2(credentialId, anchor.orgId, msg.sender, revIdx);
    }

    // ──────────────────────────── Views ─────────────────────────────────────

    /// @inheritdoc ICredentialRegistryV2
    function statusOfV2(bytes32 credentialId) external view override returns (StatusV2) {
        AnchorV2 storage anchor = _anchors[credentialId];
        if (!anchor.exists) return StatusV2.Unknown;
        if (_isBitSet(anchor.revocationIndex)) return StatusV2.Revoked;
        if (anchor.expiresAt != 0 && uint64(block.timestamp) >= anchor.expiresAt) {
            return StatusV2.Expired;
        }
        return StatusV2.Valid;
    }

    /// @inheritdoc ICredentialRegistryV2
    function getAnchorV2(bytes32 credentialId) external view override returns (AnchorV2 memory) {
        AnchorV2 storage anchor = _anchors[credentialId];
        if (!anchor.exists) revert CredentialNotFound(credentialId);
        return anchor;
    }

    /// @inheritdoc ICredentialRegistryV2
    function isCurrentlyValidV2(bytes32 credentialId) external view override returns (bool) {
        AnchorV2 storage anchor = _anchors[credentialId];
        if (!anchor.exists) return false;
        if (_isBitSet(anchor.revocationIndex)) return false;
        if (anchor.expiresAt != 0 && uint64(block.timestamp) >= anchor.expiresAt) return false;
        return issuerRegistry.isOrganizationActive(anchor.orgId);
    }

    /// @inheritdoc ICredentialRegistryV2
    function isRevokedByIndex(uint256 revocationIndex) external view override returns (bool) {
        return _isBitSet(revocationIndex);
    }

    // ──────────────────────── Bitmap Helpers ────────────────────────────────

    /// @dev Returns true if the bit at `index` is set in the revocation bitmap.
    function _isBitSet(uint256 index) internal view returns (bool) {
        uint256 slot = index / 256;
        uint256 bitPos = index % 256;
        return (_revocationBitmap[slot] >> bitPos) & uint256(1) == 1;
    }

    /// @dev Sets the bit at `index` in the revocation bitmap.
    function _setBit(uint256 index) internal {
        uint256 slot = index / 256;
        uint256 bitPos = index % 256;
        _revocationBitmap[slot] |= (uint256(1) << bitPos);
    }
}
