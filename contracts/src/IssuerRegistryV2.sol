// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IIssuerRegistryV2} from "./IIssuerRegistryV2.sol";

contract IssuerRegistryV2 is IIssuerRegistryV2, Ownable2Step {
    mapping(bytes32 => Organization) private _organizations;
    mapping(bytes32 => bool) private _organizationExists;
    bytes32[] private _organizationIds;

    mapping(address => SigningKey) private _signingKeys;
    mapping(address => bool) private _keyUsed;
    mapping(bytes32 => address[]) private _organizationSigningKeys;
    mapping(bytes32 => mapping(uint32 epoch => uint64 endedAt)) private _epochEndedAt;

    error ZeroOrganizationId();
    error ZeroAddress();
    error EmptyName();
    error OrganizationAlreadyExists(bytes32 organizationId);
    error OrganizationNotFound(bytes32 organizationId);
    error OrganizationInactive(bytes32 organizationId);
    error OrganizationAlreadyActive(bytes32 organizationId);
    error OrganizationAlreadySuspended(bytes32 organizationId);
    error InvalidController(bytes32 organizationId, address caller);
    error InvalidControllerOrOwner(bytes32 organizationId, address caller);
    error InvalidPendingController(bytes32 organizationId, address caller);
    error NoPendingController(bytes32 organizationId);
    error SigningKeyAlreadyUsed(address signingKey);
    error SigningKeyNotFound(address signingKey);
    error SigningKeyWrongOrganization(bytes32 organizationId, address signingKey);
    error SigningKeyAlreadyRevoked(address signingKey);
    error InvalidLifecycleTransition();
    error InvalidIndex();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerOrganization(
        bytes32 organizationId,
        address controller,
        string calldata name,
        string calldata metadataURI,
        address initialSigningKey,
        uint64 initialValidFrom
    ) external onlyOwner {
        if (organizationId == bytes32(0)) revert ZeroOrganizationId();
        if (controller == address(0) || initialSigningKey == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        if (_organizationExists[organizationId]) revert OrganizationAlreadyExists(organizationId);
        if (_keyUsed[initialSigningKey]) revert SigningKeyAlreadyUsed(initialSigningKey);

        _organizationExists[organizationId] = true;
        _organizationIds.push(organizationId);
        _organizations[organizationId] = Organization({
            controller: controller,
            pendingController: address(0),
            name: name,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            suspendedAt: 0,
            currentEpoch: 1,
            active: true
        });

        _addSigningKey(organizationId, initialSigningKey, 1, initialValidFrom);

        emit OrganizationRegistered(
            organizationId, controller, initialSigningKey, 1, name, metadataURI
        );
    }

    function updateOrganization(
        bytes32 organizationId,
        string calldata name,
        string calldata metadataURI
    ) external {
        if (bytes(name).length == 0) revert EmptyName();
        Organization storage organization = _requireController(organizationId, msg.sender);
        organization.name = name;
        organization.metadataURI = metadataURI;

        emit OrganizationUpdated(organizationId, name, metadataURI);
    }

    function proposeControllerTransfer(bytes32 organizationId, address newController) external {
        if (newController == address(0)) revert ZeroAddress();
        Organization storage organization = _requireController(organizationId, msg.sender);
        organization.pendingController = newController;

        emit OrganizationControllerTransferProposed(
            organizationId, organization.controller, newController
        );
    }

    function acceptControllerTransfer(bytes32 organizationId) external {
        Organization storage organization = _getOrganizationStorage(organizationId);
        address pendingController = organization.pendingController;
        if (pendingController == address(0)) revert NoPendingController(organizationId);
        if (msg.sender != pendingController) {
            revert InvalidPendingController(organizationId, msg.sender);
        }

        address previousController = organization.controller;
        organization.controller = pendingController;
        organization.pendingController = address(0);

        emit OrganizationControllerTransferred(
            organizationId, previousController, pendingController
        );
    }

    function addSigningKey(bytes32 organizationId, address signingKey, uint64 validFrom) external {
        if (signingKey == address(0)) revert ZeroAddress();
        Organization storage organization = _requireController(organizationId, msg.sender);
        if (!organization.active) revert OrganizationInactive(organizationId);
        if (_keyUsed[signingKey]) revert SigningKeyAlreadyUsed(signingKey);

        _addSigningKey(organizationId, signingKey, organization.currentEpoch, validFrom);
    }

    function revokeSigningKey(bytes32 organizationId, address signingKey) external {
        _requireControllerOrOwner(organizationId, msg.sender);
        SigningKey storage keyRecord = _signingKeys[signingKey];
        if (!keyRecord.exists) revert SigningKeyNotFound(signingKey);
        if (keyRecord.organizationId != organizationId) {
            revert SigningKeyWrongOrganization(organizationId, signingKey);
        }
        if (keyRecord.validUntil != 0) revert SigningKeyAlreadyRevoked(signingKey);

        uint64 revokedAt = uint64(block.timestamp);
        keyRecord.validUntil = revokedAt;

        emit SigningKeyRevoked(organizationId, signingKey, keyRecord.epoch, revokedAt);
    }

    function suspendOrganization(bytes32 organizationId) external onlyOwner {
        Organization storage organization = _getOrganizationStorage(organizationId);
        if (!organization.active) revert OrganizationAlreadySuspended(organizationId);

        uint64 suspendedAt = uint64(block.timestamp);
        uint32 endingEpoch = organization.currentEpoch;
        _epochEndedAt[organizationId][endingEpoch] = suspendedAt;
        organization.active = false;
        organization.suspendedAt = suspendedAt;

        emit OrganizationSuspended(organizationId, endingEpoch, suspendedAt);
    }

    function reinstateOrganization(
        bytes32 organizationId,
        address initialSigningKey,
        uint64 initialValidFrom
    ) external onlyOwner {
        if (initialSigningKey == address(0)) revert ZeroAddress();
        Organization storage organization = _getOrganizationStorage(organizationId);
        if (organization.active) revert OrganizationAlreadyActive(organizationId);
        if (_keyUsed[initialSigningKey]) revert SigningKeyAlreadyUsed(initialSigningKey);

        uint32 newEpoch = organization.currentEpoch + 1;
        organization.currentEpoch = newEpoch;
        organization.active = true;
        organization.suspendedAt = 0;

        _addSigningKey(organizationId, initialSigningKey, newEpoch, initialValidFrom);

        emit OrganizationReinstated(organizationId, newEpoch, initialSigningKey, initialValidFrom);
    }

    function organizationExists(bytes32 organizationId) external view returns (bool) {
        return _organizationExists[organizationId];
    }

    function isOrganizationActive(bytes32 organizationId) external view returns (bool) {
        return _organizationExists[organizationId] && _organizations[organizationId].active;
    }

    function isOrganizationController(bytes32 organizationId, address account)
        external
        view
        returns (bool)
    {
        return _organizationExists[organizationId]
            && _organizations[organizationId].controller == account;
    }

    function getOrganization(bytes32 organizationId) external view returns (Organization memory) {
        return _getOrganizationStorage(organizationId);
    }

    function getSigningKey(address signingKey) external view returns (SigningKey memory) {
        SigningKey memory keyRecord = _signingKeys[signingKey];
        if (!keyRecord.exists) revert SigningKeyNotFound(signingKey);
        return keyRecord;
    }

    function isCurrentlyAuthorizedKey(bytes32 organizationId, address signingKey)
        external
        view
        returns (bool)
    {
        if (!_organizationExists[organizationId]) return false;
        Organization storage organization = _organizations[organizationId];
        if (!organization.active) return false;

        SigningKey storage keyRecord = _signingKeys[signingKey];
        if (!keyRecord.exists || keyRecord.organizationId != organizationId) return false;
        if (keyRecord.epoch != organization.currentEpoch) return false;

        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < keyRecord.validFrom) return false;
        if (keyRecord.validUntil != 0 && currentTime >= keyRecord.validUntil) return false;

        uint64 epochEnd = _epochEndedAt[organizationId][keyRecord.epoch];
        if (epochEnd != 0 && currentTime >= epochEnd) return false;

        return true;
    }

    function wasAuthorizedKeyAt(bytes32 organizationId, address signingKey, uint64 timestamp)
        external
        view
        returns (bool)
    {
        SigningKey storage keyRecord = _signingKeys[signingKey];
        if (!keyRecord.exists || keyRecord.organizationId != organizationId) return false;
        if (timestamp < keyRecord.validFrom) return false;
        if (keyRecord.validUntil != 0 && timestamp >= keyRecord.validUntil) return false;

        uint64 epochEnd = _epochEndedAt[organizationId][keyRecord.epoch];
        if (epochEnd != 0 && timestamp >= epochEnd) return false;

        return true;
    }

    function organizationCount() external view returns (uint256) {
        return _organizationIds.length;
    }

    function organizationIdAt(uint256 index) external view returns (bytes32) {
        if (index >= _organizationIds.length) revert InvalidIndex();
        return _organizationIds[index];
    }

    function signingKeyCount(bytes32 organizationId) external view returns (uint256) {
        _ensureOrganizationExists(organizationId);
        return _organizationSigningKeys[organizationId].length;
    }

    function signingKeyAt(bytes32 organizationId, uint256 index) external view returns (address) {
        _ensureOrganizationExists(organizationId);
        if (index >= _organizationSigningKeys[organizationId].length) revert InvalidIndex();
        return _organizationSigningKeys[organizationId][index];
    }

    function epochEndedAt(bytes32 organizationId, uint32 epoch) external view returns (uint64) {
        _ensureOrganizationExists(organizationId);
        return _epochEndedAt[organizationId][epoch];
    }

    function _addSigningKey(
        bytes32 organizationId,
        address signingKey,
        uint32 epoch,
        uint64 validFrom
    ) internal {
        _keyUsed[signingKey] = true;
        _signingKeys[signingKey] = SigningKey({
            organizationId: organizationId,
            epoch: epoch,
            validFrom: validFrom,
            validUntil: 0,
            exists: true
        });
        _organizationSigningKeys[organizationId].push(signingKey);

        emit SigningKeyAdded(organizationId, signingKey, epoch, validFrom);
    }

    function _ensureOrganizationExists(bytes32 organizationId) internal view {
        if (!_organizationExists[organizationId]) revert OrganizationNotFound(organizationId);
    }

    function _getOrganizationStorage(bytes32 organizationId)
        internal
        view
        returns (Organization storage organization)
    {
        if (!_organizationExists[organizationId]) revert OrganizationNotFound(organizationId);
        return _organizations[organizationId];
    }

    function _requireController(bytes32 organizationId, address caller)
        internal
        view
        returns (Organization storage organization)
    {
        organization = _getOrganizationStorage(organizationId);
        if (organization.controller != caller) revert InvalidController(organizationId, caller);
    }

    function _requireControllerOrOwner(bytes32 organizationId, address caller) internal view {
        Organization storage organization = _getOrganizationStorage(organizationId);
        if (organization.controller != caller && caller != owner()) {
            revert InvalidControllerOrOwner(organizationId, caller);
        }
    }
}
