// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIssuerRegistry
/// @notice Interface for the on-chain registry of universities authorized to issue credentials.
interface IIssuerRegistry {
    struct Issuer {
        string name; // human-readable issuer name (e.g. "Hanoi University of Science and Technology")
        string metadataURI; // optional URI for off-chain metadata (logo, contact, signing pubkey doc)
        uint64 registeredAt;
        uint64 revokedAt; // 0 if active
        bool active;
    }

    event IssuerRegistered(address indexed issuer, string name, string metadataURI);
    event IssuerUpdated(address indexed issuer, string name, string metadataURI);
    event IssuerRevoked(address indexed issuer, string reason);
    event IssuerReinstated(address indexed issuer);

    function registerIssuer(address issuer, string calldata name, string calldata metadataURI)
        external;
    function updateIssuer(address issuer, string calldata name, string calldata metadataURI)
        external;
    function revokeIssuer(address issuer, string calldata reason) external;
    function reinstateIssuer(address issuer) external;

    function isAuthorized(address issuer) external view returns (bool);
    function getIssuer(address issuer) external view returns (Issuer memory);
}
