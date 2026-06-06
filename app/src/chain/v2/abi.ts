export const issuerRegistryV2Abi = [
    "function registerOrganization(bytes32 organizationId, address controller, string name, string metadataURI, address initialSigningKey, uint64 initialValidFrom)",
    "function updateOrganization(bytes32 organizationId, string name, string metadataURI)",
    "function proposeControllerTransfer(bytes32 organizationId, address newController)",
    "function acceptControllerTransfer(bytes32 organizationId)",
    "function addSigningKey(bytes32 organizationId, address signingKey, uint64 validFrom)",
    "function revokeSigningKey(bytes32 organizationId, address signingKey)",
    "function suspendOrganization(bytes32 organizationId)",
    "function reinstateOrganization(bytes32 organizationId, address initialSigningKey, uint64 initialValidFrom)",
    "function organizationExists(bytes32 organizationId) view returns (bool)",
    "function isOrganizationActive(bytes32 organizationId) view returns (bool)",
    "function isOrganizationController(bytes32 organizationId, address account) view returns (bool)",
    "function getOrganization(bytes32 organizationId) view returns (tuple(address controller, address pendingController, string name, string metadataURI, uint64 registeredAt, uint64 suspendedAt, uint32 currentEpoch, bool active))",
    "function getSigningKey(address signingKey) view returns (tuple(bytes32 organizationId, uint32 epoch, uint64 validFrom, uint64 validUntil, bool exists))",
    "function isCurrentlyAuthorizedKey(bytes32 organizationId, address signingKey) view returns (bool)",
    "function wasAuthorizedKeyAt(bytes32 organizationId, address signingKey, uint64 timestamp) view returns (bool)",
    "function organizationCount() view returns (uint256)",
    "function organizationIdAt(uint256 index) view returns (bytes32)",
    "function signingKeyCount(bytes32 organizationId) view returns (uint256)",
    "function signingKeyAt(bytes32 organizationId, uint256 index) view returns (address)",
    "function epochEndedAt(bytes32 organizationId, uint32 epoch) view returns (uint64)",
    "function owner() view returns (address)"
] as const;

export const credentialRegistryV2Abi = [
    "function anchorCredential(bytes32 organizationId, bytes32 credentialId, bytes32 credentialDigest, bytes32 holderCommitment, bytes32 merkleRoot, uint64 issuedAt, uint64 expiresAt, uint32 claimCount)",
    "function revokeCredential(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId, bytes32 reasonHash)",
    "function isRevoked(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (bool)",
    "function revocationWord(bytes32 organizationId, uint256 wordIndex) view returns (uint256)",
    "function getAnchor(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (tuple(bytes32 credentialDigest, bytes32 merkleRoot, bytes32 holderCommitment, bytes32 organizationId, address issuerSigningAddress, uint64 issuedAt, uint64 expiresAt, uint64 revocationIndex, uint32 claimCount, bool exists))",
    "function statusOf(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (uint8)",
    "function isCurrentlyValid(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) view returns (bool)",
    "function computeAnchorKey(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId) pure returns (bytes32)",
    "function computeHolderCommitment(bytes32 organizationId, address issuerSigningAddress, bytes32 credentialId, address holderAddress) pure returns (bytes32)",
    "function nextRevocationIndex(bytes32 organizationId) view returns (uint64)",
    "function issuerRegistry() view returns (address)"
] as const;

export const StatusV2Enum = {
    Unknown: 0,
    Valid: 1,
    Revoked: 2,
    Expired: 3,
    IssuerInactive: 4
} as const;

export type StatusV2 = (typeof StatusV2Enum)[keyof typeof StatusV2Enum];
