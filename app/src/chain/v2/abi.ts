/**
 * Hand-curated ABIs for IssuerRegistryV2 and CredentialRegistryV2.
 * Keep these in sync with:
 *   contracts/src/IssuerRegistryV2.sol
 *   contracts/src/CredentialRegistryV2.sol
 *
 * V2 uses bytes32 organizationId instead of address-based issuers (V1).
 */

export const issuerRegistryV2Abi = [
    // Owner-only mutations
    "function registerOrganization(bytes32 orgId, address controller, address initialKey, uint64 keyValidFrom, string name, string metadataURI)",
    "function suspendOrganization(bytes32 orgId, string reason)",
    "function reinstateOrganization(bytes32 orgId, address initialKey, uint64 keyValidFrom)",
    // Controller-only mutations
    "function updateOrganization(bytes32 orgId, string name, string metadataURI)",
    "function proposeControllerTransfer(bytes32 orgId, address newController)",
    "function acceptControllerTransfer(bytes32 orgId)",
    "function addSigningKey(bytes32 orgId, address key, uint64 validFrom)",
    // Controller or owner
    "function revokeSigningKey(bytes32 orgId, address key)",
    // Views
    "function organizationExists(bytes32 orgId) view returns (bool)",
    "function isOrganizationActive(bytes32 orgId) view returns (bool)",
    "function wasAuthorizedAt(bytes32 orgId, address key, uint64 at) view returns (bool)",
    "function getOrganization(bytes32 orgId) view returns (tuple(address controller, address pendingController, string name, string metadataURI, uint64 registeredAt, uint64 suspendedAt, uint32 currentEpoch, bool active))",
    "function getSigningKey(address key) view returns (tuple(bytes32 organizationId, uint32 epoch, uint64 validFrom, uint64 validUntil, bool exists))",
    "function owner() view returns (address)",
    // Events
    "event OrganizationRegistered(bytes32 indexed orgId, address indexed controller, address indexed initialKey, string name)",
    "event OrganizationUpdated(bytes32 indexed orgId, string name, string metadataURI)",
    "event OrganizationSuspended(bytes32 indexed orgId, string reason)",
    "event OrganizationReinstated(bytes32 indexed orgId, uint32 newEpoch, address initialKey)",
    "event ControllerTransferProposed(bytes32 indexed orgId, address indexed proposedController)",
    "event ControllerTransferred(bytes32 indexed orgId, address indexed newController)",
    "event SigningKeyAdded(bytes32 indexed orgId, address indexed key, uint32 epoch, uint64 validFrom)",
    "event SigningKeyRevoked(bytes32 indexed orgId, address indexed key, uint64 validUntil)",
] as const;

export const credentialRegistryV2Abi = [
    // Signer mutations
    "function anchorCredentialV2(bytes32 credentialId, bytes32 orgId, bytes32 credentialDigest, bytes32 holderCommitment, uint64 issuedAt, uint64 expiresAt)",
    "function revokeCredentialV2(bytes32 credentialId)",
    // Views
    "function statusOfV2(bytes32 credentialId) view returns (uint8)",
    "function getAnchorV2(bytes32 credentialId) view returns (tuple(bytes32 orgId, address signer, bytes32 credentialDigest, bytes32 holderCommitment, uint64 issuedAt, uint64 expiresAt, uint64 anchoredAt, uint256 revocationIndex, bool exists))",
    "function isCurrentlyValidV2(bytes32 credentialId) view returns (bool)",
    "function isRevokedByIndex(uint256 revocationIndex) view returns (bool)",
    "function issuerRegistry() view returns (address)",
    // Events
    "event CredentialAnchoredV2(bytes32 indexed credentialId, bytes32 indexed orgId, address indexed signer, bytes32 credentialDigest, bytes32 holderCommitment, uint64 issuedAt, uint64 expiresAt, uint256 revocationIndex)",
    "event CredentialRevokedV2(bytes32 indexed credentialId, bytes32 indexed orgId, address indexed revoker, uint256 revocationIndex)",
] as const;

/** StatusV2 enum from CredentialRegistryV2.StatusV2 (must match Solidity ordering). */
export const StatusV2Enum = {
    Unknown: 0,
    Valid: 1,
    Revoked: 2,
    Expired: 3,
} as const;

export type StatusV2 = (typeof StatusV2Enum)[keyof typeof StatusV2Enum];
