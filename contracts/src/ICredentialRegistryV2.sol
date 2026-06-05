// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICredentialRegistryV2
/// @notice Interface for the on-chain V2 credential anchor registry.
///         Anchors bind a Protocol V2 credential digest to a specific organization and signer.
///         Revocation is implemented using a bitmap for gas-efficient bulk queries.
interface ICredentialRegistryV2 {
    // ─────────────────────────── Data Structures ────────────────────────────

    /// @notice On-chain anchor for a Protocol V2 credential.
    /// @dev    `credentialDigest` is the EIP-712 hash of the AcademicCredential struct
    ///         (computed by `credentialDigestV2` off-chain). Storing the digest instead of
    ///         the raw fields preserves privacy while enabling on-chain verification.
    ///
    ///         `holderCommitment` = keccak256(abi.encodePacked(holderAddress)), identical to
    ///         V1's `holderHash`. It hides the holder's identity while remaining checkable.
    ///
    ///         `revocationIndex` is a sequential index into the global bitmap; each credential
    ///         gets a unique index at anchor time for O(1) revocation storage and lookup.
    struct AnchorV2 {
        bytes32 orgId;
        address signer; // signing key address that called anchorCredentialV2
        bytes32 credentialDigest; // EIP-712 digest of the off-chain CredentialV2 struct
        bytes32 holderCommitment; // keccak256(holderAddress) — no PII on-chain
        uint64 issuedAt;
        uint64 expiresAt; // 0 = no expiry
        uint64 anchoredAt;
        uint256 revocationIndex; // position in the global revocation bitmap
        bool exists;
    }

    /// @notice On-chain status of a credential.
    enum StatusV2 {
        Unknown, // never anchored
        Valid, // anchored, not revoked, not expired
        Revoked,
        Expired
    }

    // ──────────────────────────────── Events ────────────────────────────────

    event CredentialAnchoredV2(
        bytes32 indexed credentialId,
        bytes32 indexed orgId,
        address indexed signer,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        uint64 issuedAt,
        uint64 expiresAt,
        uint256 revocationIndex
    );

    event CredentialRevokedV2(
        bytes32 indexed credentialId,
        bytes32 indexed orgId,
        address indexed revoker,
        uint256 revocationIndex
    );

    // ────────────────────────── Signer Mutations ────────────────────────────

    /// @notice Anchor a Protocol V2 credential on-chain.
    /// @dev    `msg.sender` must be an active, authorized signing key for `orgId`
    ///         at the current block timestamp. The anchor records the exact signer address.
    ///
    /// @param  credentialId      The Protocol V2 `id` field (nonzero bytes32).
    /// @param  orgId             The organization that issued the credential.
    /// @param  credentialDigest  EIP-712 digest of the off-chain CredentialV2 (nonzero).
    /// @param  holderCommitment  keccak256(holderAddress) — must match the off-chain value.
    /// @param  issuedAt          Credential issuance timestamp (seconds since epoch).
    /// @param  expiresAt         Expiration timestamp; 0 for non-expiring credentials.
    function anchorCredentialV2(
        bytes32 credentialId,
        bytes32 orgId,
        bytes32 credentialDigest,
        bytes32 holderCommitment,
        uint64 issuedAt,
        uint64 expiresAt
    ) external;

    /// @notice Revoke a previously anchored credential by setting its revocation bit.
    /// @dev    Only the original signer or the organization's current controller may revoke.
    function revokeCredentialV2(bytes32 credentialId) external;

    // ────────────────────────────── Views ───────────────────────────────────

    /// @notice Returns the on-chain status of a credential.
    function statusOfV2(bytes32 credentialId) external view returns (StatusV2);

    /// @notice Returns the full AnchorV2 record. Reverts if the credential was never anchored.
    function getAnchorV2(bytes32 credentialId) external view returns (AnchorV2 memory);

    /// @notice Returns true iff the credential is Valid AND the organization is still active.
    function isCurrentlyValidV2(bytes32 credentialId) external view returns (bool);

    /// @notice Returns true iff the bit at `revocationIndex` is set in the revocation bitmap.
    /// @dev    Allows off-chain revocation-list consumers to check a batch of indices without
    ///         knowing the credential ID, following the W3C VC revocation list pattern.
    function isRevokedByIndex(uint256 revocationIndex) external view returns (bool);
}
