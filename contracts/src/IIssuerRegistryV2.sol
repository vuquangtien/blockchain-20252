// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIssuerRegistryV2 {
    struct Organization {
        address controller;
        address pendingController;
        string name;
        string metadataURI;
        uint64 registeredAt;
        uint64 suspendedAt;
        uint32 currentEpoch;
        bool active;
    }

    struct SigningKey {
        bytes32 organizationId;
        uint32 epoch;
        uint64 validFrom;
        uint64 validUntil;
        bool exists;
    }

    event OrganizationRegistered(
        bytes32 indexed organizationId,
        address indexed controller,
        address indexed initialSigningKey,
        uint32 epoch,
        string name,
        string metadataURI
    );
    event OrganizationUpdated(bytes32 indexed organizationId, string name, string metadataURI);
    event OrganizationControllerTransferProposed(
        bytes32 indexed organizationId,
        address indexed currentController,
        address indexed pendingController
    );
    event OrganizationControllerTransferred(
        bytes32 indexed organizationId,
        address indexed previousController,
        address indexed newController
    );
    event SigningKeyAdded(
        bytes32 indexed organizationId,
        address indexed signingKey,
        uint32 indexed epoch,
        uint64 validFrom
    );
    event SigningKeyRevoked(
        bytes32 indexed organizationId,
        address indexed signingKey,
        uint32 indexed epoch,
        uint64 validUntil
    );
    event OrganizationSuspended(
        bytes32 indexed organizationId, uint32 indexed epoch, uint64 suspendedAt
    );
    event OrganizationReinstated(
        bytes32 indexed organizationId,
        uint32 indexed epoch,
        address indexed initialSigningKey,
        uint64 validFrom
    );

    function registerOrganization(
        bytes32 organizationId,
        address controller,
        string calldata name,
        string calldata metadataURI,
        address initialSigningKey,
        uint64 initialValidFrom
    ) external;

    function updateOrganization(
        bytes32 organizationId,
        string calldata name,
        string calldata metadataURI
    ) external;

    function proposeControllerTransfer(bytes32 organizationId, address newController) external;

    function acceptControllerTransfer(bytes32 organizationId) external;

    function addSigningKey(bytes32 organizationId, address signingKey, uint64 validFrom) external;

    function revokeSigningKey(bytes32 organizationId, address signingKey) external;

    function suspendOrganization(bytes32 organizationId) external;

    function reinstateOrganization(
        bytes32 organizationId,
        address initialSigningKey,
        uint64 initialValidFrom
    ) external;

    function organizationExists(bytes32 organizationId) external view returns (bool);

    function isOrganizationActive(bytes32 organizationId) external view returns (bool);

    function isOrganizationController(bytes32 organizationId, address account)
        external
        view
        returns (bool);

    function getOrganization(bytes32 organizationId) external view returns (Organization memory);

    function getSigningKey(address signingKey) external view returns (SigningKey memory);

    function isCurrentlyAuthorizedKey(bytes32 organizationId, address signingKey)
        external
        view
        returns (bool);

    function wasAuthorizedKeyAt(bytes32 organizationId, address signingKey, uint64 timestamp)
        external
        view
        returns (bool);

    function organizationCount() external view returns (uint256);

    function organizationIdAt(uint256 index) external view returns (bytes32);

    function signingKeyCount(bytes32 organizationId) external view returns (uint256);

    function signingKeyAt(bytes32 organizationId, uint256 index) external view returns (address);

    function epochEndedAt(bytes32 organizationId, uint32 epoch) external view returns (uint64);
}
