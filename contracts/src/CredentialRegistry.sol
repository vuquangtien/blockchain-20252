// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIssuerRegistry} from "./IIssuerRegistry.sol";

/// @title CredentialRegistry
/// @notice Anchors academic credentials and maintains a revocation list.
/// @dev    Storage model:
///           - A credential is identified by `credentialId = keccak256(canonical credential bytes)`
///             where the canonical bytes contain {issuer, holderHash, merkleRoot, issuedAt,
///             expiresAt, schemaURI}. This binds the on-chain anchor to a specific Merkle root
///             without leaking transcript contents.
///           - Anchoring is OPTIONAL: a credential is verifiable purely off-chain using the
///             issuer's ECC signature. Anchoring on-chain proves issuance time and lets the
///             issuer revoke later. This implementation requires anchoring before revocation,
///             matching the W3C Verifiable Credentials revocation-list pattern but with a
///             stronger "issued" record.
contract CredentialRegistry {
    struct CredentialAnchor {
        address issuer;
        bytes32 merkleRoot;
        bytes32 holderHash; // keccak256 of holder DID / identifier (hides PII on-chain)
        uint64 issuedAt;
        uint64 expiresAt; // 0 means never expires
        uint64 revokedAt; // 0 means not revoked
        bool exists;
    }

    enum Status {
        Unknown, // never anchored
        Valid, // anchored, not revoked, not expired
        Revoked,
        Expired
    }

    IIssuerRegistry public immutable issuerRegistry;

    mapping(bytes32 => CredentialAnchor) private _anchors;
    mapping(bytes32 => string) public revocationReason;

    event CredentialAnchored(
        bytes32 indexed credentialId,
        address indexed issuer,
        bytes32 indexed holderHash,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt
    );
    event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer, string reason);

    error NotAuthorizedIssuer(address caller);
    error CredentialAlreadyAnchored(bytes32 credentialId);
    error CredentialNotFound(bytes32 credentialId);
    error AlreadyRevoked(bytes32 credentialId);
    error CallerNotIssuer(address caller, address issuer);
    error InvalidExpiry(uint64 issuedAt, uint64 expiresAt);
    error ZeroCredentialId();
    error ZeroHolderHash();
    error ZeroMerkleRoot();

    constructor(IIssuerRegistry _issuerRegistry) {
        issuerRegistry = _issuerRegistry;
    }

    /// @notice Anchor a credential's Merkle root on-chain. Only authorized issuers may call.
    /// @param  credentialId keccak256 of canonical credential payload (computed off-chain).
    /// @param  holderHash   keccak256 of the holder's identifier — keeps the holder's
    ///                      identity confidential while still being verifiable.
    /// @param  merkleRoot   Root of the Merkle tree of credential claims.
    /// @param  issuedAt     Issuance timestamp (seconds since epoch).
    /// @param  expiresAt    Expiration timestamp; 0 for non-expiring credentials.
    function anchorCredential(
        bytes32 credentialId,
        bytes32 holderHash,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt
    ) external {
        if (!issuerRegistry.isAuthorized(msg.sender)) {
            revert NotAuthorizedIssuer(msg.sender);
        }
        if (credentialId == bytes32(0)) revert ZeroCredentialId();
        if (holderHash == bytes32(0)) revert ZeroHolderHash();
        if (merkleRoot == bytes32(0)) revert ZeroMerkleRoot();
        if (_anchors[credentialId].exists) revert CredentialAlreadyAnchored(credentialId);
        if (expiresAt != 0 && expiresAt <= issuedAt) revert InvalidExpiry(issuedAt, expiresAt);

        _anchors[credentialId] = CredentialAnchor({
            issuer: msg.sender,
            merkleRoot: merkleRoot,
            holderHash: holderHash,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            revokedAt: 0,
            exists: true
        });

        emit CredentialAnchored(
            credentialId, msg.sender, holderHash, merkleRoot, issuedAt, expiresAt
        );
    }

    /// @notice Revoke a previously anchored credential.
    /// @dev    Only the original issuer can revoke. The reason string is stored for auditability.
    function revokeCredential(bytes32 credentialId, string calldata reason) external {
        CredentialAnchor storage anchor = _anchors[credentialId];
        if (!anchor.exists) revert CredentialNotFound(credentialId);
        if (anchor.issuer != msg.sender) revert CallerNotIssuer(msg.sender, anchor.issuer);
        if (anchor.revokedAt != 0) revert AlreadyRevoked(credentialId);

        anchor.revokedAt = uint64(block.timestamp);
        revocationReason[credentialId] = reason;

        emit CredentialRevoked(credentialId, msg.sender, reason);
    }

    /// @notice Returns the on-chain status of a credential.
    /// @dev    `Unknown` means the credential was never anchored — it may still be valid
    ///         off-chain by signature alone, depending on verifier policy.
    function statusOf(bytes32 credentialId) external view returns (Status) {
        CredentialAnchor storage anchor = _anchors[credentialId];
        if (!anchor.exists) return Status.Unknown;
        if (anchor.revokedAt != 0) return Status.Revoked;
        if (anchor.expiresAt != 0 && uint64(block.timestamp) >= anchor.expiresAt) {
            return Status.Expired;
        }
        return Status.Valid;
    }

    /// @notice Returns the full anchor record. Reverts if the credential was never anchored.
    function getAnchor(bytes32 credentialId) external view returns (CredentialAnchor memory) {
        CredentialAnchor storage anchor = _anchors[credentialId];
        if (!anchor.exists) revert CredentialNotFound(credentialId);
        return anchor;
    }

    /// @notice Convenience: returns true iff status is Valid AND issuer is currently authorized.
    function isCurrentlyValid(bytes32 credentialId) external view returns (bool) {
        CredentialAnchor storage anchor = _anchors[credentialId];
        if (!anchor.exists) return false;
        if (anchor.revokedAt != 0) return false;
        if (anchor.expiresAt != 0 && uint64(block.timestamp) >= anchor.expiresAt) return false;
        return issuerRegistry.isAuthorized(anchor.issuer);
    }

    /// @notice Computes the leaf hash used by the off-chain Merkle tree.
    /// @dev    The encoded claim is canonical JSON bytes for {key, value, salt}.
    function domainSeparatedLeafHash(bytes calldata encodedClaim) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1(0x00), encodedClaim));
    }

    /// @notice Verifies a domain-separated Merkle proof for a pre-hashed claim leaf.
    /// @dev    This mirrors app/src/core/merkle.ts:
    ///           leaf = keccak256(0x00 || encodedClaim)
    ///           node = keccak256(0x01 || left || right)
    ///         positions[i] == true means the current node is the right child.
    function verifyClaimHash(
        bytes32 leafHash,
        bytes32[] calldata siblings,
        bool[] calldata positions,
        bytes32 expectedRoot
    ) external pure returns (bool) {
        if (siblings.length != positions.length) return false;

        bytes32 current = leafHash;
        for (uint256 i = 0; i < siblings.length; i++) {
            bytes32 sibling = siblings[i];
            current = positions[i]
                ? keccak256(abi.encodePacked(bytes1(0x01), sibling, current))
                : keccak256(abi.encodePacked(bytes1(0x01), current, sibling));
        }
        return current == expectedRoot;
    }
}
