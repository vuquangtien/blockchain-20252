/**
 * Hand-curated ABIs. Kept here (rather than imported from the Foundry build) so the
 * TypeScript app is decoupled from the contracts directory and can be packaged on its own.
 * Keep these in sync with src/IssuerRegistry.sol and src/CredentialRegistry.sol.
 */

export const issuerRegistryAbi = [
    "function registerIssuer(address issuer, string name, string metadataURI)",
    "function updateIssuer(address issuer, string name, string metadataURI)",
    "function revokeIssuer(address issuer, string reason)",
    "function reinstateIssuer(address issuer)",
    "function isAuthorized(address issuer) view returns (bool)",
    "function getIssuer(address issuer) view returns (tuple(string name, string metadataURI, uint64 registeredAt, uint64 revokedAt, bool active))",
    "function issuerCount() view returns (uint256)",
    "function issuerAt(uint256) view returns (address)",
    "function owner() view returns (address)",
    "event IssuerRegistered(address indexed issuer, string name, string metadataURI)",
    "event IssuerRevoked(address indexed issuer, string reason)",
] as const;

export const credentialRegistryAbi = [
    "function anchorCredential(bytes32 credentialId, bytes32 holderHash, bytes32 merkleRoot, uint64 issuedAt, uint64 expiresAt)",
    "function revokeCredential(bytes32 credentialId, string reason)",
    "function statusOf(bytes32 credentialId) view returns (uint8)",
    "function getAnchor(bytes32 credentialId) view returns (tuple(address issuer, bytes32 merkleRoot, bytes32 holderHash, uint64 issuedAt, uint64 expiresAt, uint64 revokedAt, bool exists))",
    "function isCurrentlyValid(bytes32 credentialId) view returns (bool)",
    "function domainSeparatedLeafHash(bytes encodedClaim) pure returns (bytes32)",
    "function verifyClaimHash(bytes32 leafHash, bytes32[] siblings, bool[] positions, bytes32 expectedRoot) pure returns (bool)",
    "function revocationReason(bytes32) view returns (string)",
    "function issuerRegistry() view returns (address)",
    "event CredentialAnchored(bytes32 indexed credentialId, address indexed issuer, bytes32 indexed holderHash, bytes32 merkleRoot, uint64 issuedAt, uint64 expiresAt)",
    "event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer, string reason)",
] as const;

/** Status enum from CredentialRegistry.Status (must match Solidity ordering). */
export const StatusEnum = {
    Unknown: 0,
    Valid: 1,
    Revoked: 2,
    Expired: 3,
} as const;
