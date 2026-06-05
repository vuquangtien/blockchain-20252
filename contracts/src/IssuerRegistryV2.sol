// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IIssuerRegistryV2} from "./IIssuerRegistryV2.sol";

/// @title IssuerRegistryV2
/// @notice On-chain registry of university organizations authorized to issue credentials.
/// @dev    V2 replaces the single-address issuer model (V1) with an organization model:
///           - Each organization is identified by a governance-assigned `bytes32 orgId`.
///           - An organization can hold multiple signing keys (ECC key pairs used to sign
///             credentials off-chain). Keys can be rotated without changing the org's identity.
///           - Authorization is epoch-based: suspension increments the epoch, permanently
///             invalidating all signing keys from prior epochs without touching their records.
///             Reinstatement starts a new epoch with a fresh initial key.
///           - `wasAuthorizedAt` enables historical verification: a credential anchored at
///             time T can be validated even after the signing key was later rotated.
///
///         Security invariants:
///           - No `tx.origin` usage.
///           - No assembly, delegatecall, selfdestruct, or unchecked arithmetic.
///           - Checks-effects-interactions ordering throughout.
///           - A signing key address, once registered, can never be registered again
///             regardless of revocation or epoch transitions.
contract IssuerRegistryV2 is IIssuerRegistryV2, Ownable2Step {
    // ─────────────────────────── State ──────────────────────────────────────

    mapping(bytes32 => Organization) private _orgs;
    mapping(bytes32 => bool) private _orgExists;

    /// @dev Global map from signing-key address to its record.
    ///      A key belongs to exactly one organization for its entire lifetime.
    mapping(address => SigningKey) private _signingKeys;

    /// @dev Once a key address is registered (ever), it can never be re-added
    ///      to any organization after its epoch ends or it is individually revoked.
    mapping(address => bool) private _keyRegistered;

    /// @dev Per-organization list of epoch-end timestamps (ordered ascending).
    ///      Entry i records when epoch i ended (i.e. when the org was suspended
    ///      for the (i+1)-th time). Used to answer `wasAuthorizedAt` queries.
    mapping(bytes32 => uint64[]) private _epochEndTimes;

    // ─────────────────────────── Errors ─────────────────────────────────────

    error OrgAlreadyExists(bytes32 orgId);
    error OrgNotFound(bytes32 orgId);
    error OrgNotActive(bytes32 orgId);
    error OrgAlreadyActive(bytes32 orgId);
    error KeyAlreadyRegistered(address key);
    error KeyNotFound(address key);
    error KeyNotInOrg(address key, bytes32 orgId);
    error KeyAlreadyRevoked(address key);
    error ZeroOrgId();
    error ZeroControllerAddress();
    error ZeroKeyAddress();
    error EmptyName();
    error CallerNotController(address caller, bytes32 orgId);
    error CallerNotControllerOrOwner(address caller, bytes32 orgId);
    error NoPendingTransfer(bytes32 orgId);
    error CallerNotPendingController(address caller, bytes32 orgId);
    error ValidFromInPast(uint64 validFrom, uint64 blockTime);

    // ─────────────────────────────────────────────────────────────────────────

    constructor(address admin) Ownable(admin) {}

    // ────────────────────── Owner-only Mutations ─────────────────────────────

    /// @inheritdoc IIssuerRegistryV2
    function registerOrganization(
        bytes32 orgId,
        address controller,
        address initialKey,
        uint64 keyValidFrom,
        string calldata name,
        string calldata metadataURI
    ) external override onlyOwner {
        if (orgId == bytes32(0)) revert ZeroOrgId();
        if (controller == address(0)) revert ZeroControllerAddress();
        if (initialKey == address(0)) revert ZeroKeyAddress();
        if (bytes(name).length == 0) revert EmptyName();
        if (_orgExists[orgId]) revert OrgAlreadyExists(orgId);
        if (_keyRegistered[initialKey]) revert KeyAlreadyRegistered(initialKey);

        // Effects — organization record
        _orgExists[orgId] = true;
        _orgs[orgId] = Organization({
            controller: controller,
            pendingController: address(0),
            name: name,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            suspendedAt: 0,
            currentEpoch: 0,
            active: true
        });

        // Effects — initial signing key
        _keyRegistered[initialKey] = true;
        _signingKeys[initialKey] = SigningKey({
            organizationId: orgId, epoch: 0, validFrom: keyValidFrom, validUntil: 0, exists: true
        });

        emit OrganizationRegistered(orgId, controller, initialKey, name);
        emit SigningKeyAdded(orgId, initialKey, 0, keyValidFrom);
    }

    /// @inheritdoc IIssuerRegistryV2
    function suspendOrganization(bytes32 orgId, string calldata reason)
        external
        override
        onlyOwner
    {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];
        if (!org.active) revert OrgAlreadyActive(orgId); // already suspended

        // Effects: record epoch-end timestamp and mark inactive
        _epochEndTimes[orgId].push(uint64(block.timestamp));
        org.active = false;
        org.suspendedAt = uint64(block.timestamp);

        emit OrganizationSuspended(orgId, reason);
    }

    /// @inheritdoc IIssuerRegistryV2
    function reinstateOrganization(bytes32 orgId, address initialKey, uint64 keyValidFrom)
        external
        override
        onlyOwner
    {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];
        if (org.active) revert OrgAlreadyActive(orgId);
        if (initialKey == address(0)) revert ZeroKeyAddress();
        if (_keyRegistered[initialKey]) revert KeyAlreadyRegistered(initialKey);

        // Effects: advance epoch, reactivate, add initial key
        uint32 newEpoch = org.currentEpoch + 1;
        org.currentEpoch = newEpoch;
        org.active = true;
        org.suspendedAt = 0;

        _keyRegistered[initialKey] = true;
        _signingKeys[initialKey] = SigningKey({
            organizationId: orgId,
            epoch: newEpoch,
            validFrom: keyValidFrom,
            validUntil: 0,
            exists: true
        });

        emit OrganizationReinstated(orgId, newEpoch, initialKey);
        emit SigningKeyAdded(orgId, initialKey, newEpoch, keyValidFrom);
    }

    // ──────────────────── Controller-only Mutations ──────────────────────────

    /// @inheritdoc IIssuerRegistryV2
    function updateOrganization(bytes32 orgId, string calldata name, string calldata metadataURI)
        external
        override
    {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        if (bytes(name).length == 0) revert EmptyName();
        Organization storage org = _orgs[orgId];
        if (msg.sender != org.controller) revert CallerNotController(msg.sender, orgId);

        org.name = name;
        org.metadataURI = metadataURI;

        emit OrganizationUpdated(orgId, name, metadataURI);
    }

    /// @inheritdoc IIssuerRegistryV2
    function proposeControllerTransfer(bytes32 orgId, address newController) external override {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];
        if (msg.sender != org.controller) revert CallerNotController(msg.sender, orgId);

        org.pendingController = newController;

        emit ControllerTransferProposed(orgId, newController);
    }

    /// @inheritdoc IIssuerRegistryV2
    function acceptControllerTransfer(bytes32 orgId) external override {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];
        if (org.pendingController == address(0)) revert NoPendingTransfer(orgId);
        if (msg.sender != org.pendingController) {
            revert CallerNotPendingController(msg.sender, orgId);
        }

        address newController = org.pendingController;
        // Effects before any reads of external state
        org.controller = newController;
        org.pendingController = address(0);

        emit ControllerTransferred(orgId, newController);
    }

    /// @inheritdoc IIssuerRegistryV2
    function addSigningKey(bytes32 orgId, address key, uint64 validFrom) external override {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];
        if (!org.active) revert OrgNotActive(orgId);
        if (msg.sender != org.controller) revert CallerNotController(msg.sender, orgId);
        if (key == address(0)) revert ZeroKeyAddress();
        if (_keyRegistered[key]) revert KeyAlreadyRegistered(key);

        uint32 epoch = org.currentEpoch;

        _keyRegistered[key] = true;
        _signingKeys[key] = SigningKey({
            organizationId: orgId, epoch: epoch, validFrom: validFrom, validUntil: 0, exists: true
        });

        emit SigningKeyAdded(orgId, key, epoch, validFrom);
    }

    // ─────────────── Controller or Owner Mutations ──────────────────────────

    /// @inheritdoc IIssuerRegistryV2
    function revokeSigningKey(bytes32 orgId, address key) external override {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        Organization storage org = _orgs[orgId];

        bool isController = msg.sender == org.controller;
        bool isOwner = msg.sender == owner();
        if (!isController && !isOwner) revert CallerNotControllerOrOwner(msg.sender, orgId);

        if (!_signingKeys[key].exists) revert KeyNotFound(key);
        if (_signingKeys[key].organizationId != orgId) revert KeyNotInOrg(key, orgId);
        if (_signingKeys[key].validUntil != 0) revert KeyAlreadyRevoked(key);

        uint64 now_ = uint64(block.timestamp);
        _signingKeys[key].validUntil = now_;

        emit SigningKeyRevoked(orgId, key, now_);
    }

    // ──────────────────────────── Views ─────────────────────────────────────

    /// @inheritdoc IIssuerRegistryV2
    function organizationExists(bytes32 orgId) external view override returns (bool) {
        return _orgExists[orgId];
    }

    /// @inheritdoc IIssuerRegistryV2
    function isOrganizationActive(bytes32 orgId) external view override returns (bool) {
        return _orgExists[orgId] && _orgs[orgId].active;
    }

    /// @inheritdoc IIssuerRegistryV2
    function wasAuthorizedAt(bytes32 orgId, address key, uint64 at)
        external
        view
        override
        returns (bool)
    {
        return _wasAuthorizedAt(orgId, key, at);
    }

    /// @inheritdoc IIssuerRegistryV2
    function getOrganization(bytes32 orgId) external view override returns (Organization memory) {
        if (!_orgExists[orgId]) revert OrgNotFound(orgId);
        return _orgs[orgId];
    }

    /// @inheritdoc IIssuerRegistryV2
    function getSigningKey(address key) external view override returns (SigningKey memory) {
        if (!_signingKeys[key].exists) revert KeyNotFound(key);
        return _signingKeys[key];
    }

    // ──────────────────────── Internal Logic ────────────────────────────────

    /// @dev Returns the organization's epoch that was current at timestamp `at`.
    ///      Epochs are indexed 0, 1, 2, ... Epoch i ended at `_epochEndTimes[orgId][i]`.
    ///      Linearly scans the epoch-end list (bounded by the number of suspensions).
    function _epochAtTime(bytes32 orgId, uint64 at) internal view returns (uint32) {
        uint64[] storage ends = _epochEndTimes[orgId];
        uint256 len = ends.length;
        for (uint256 i = 0; i < len; i++) {
            if (at < ends[i]) {
                // casting to 'uint32' is safe because the number of epoch transitions
                // per organization is governance-bounded and can never reach 2^32.
                // forge-lint: disable-next-line(unsafe-typecast)
                return uint32(i);
            }
        }
        // casting to 'uint32' is safe: same reasoning as above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(len);
    }

    /// @dev Core authorization check used by both the public view and CredentialRegistryV2.
    function _wasAuthorizedAt(bytes32 orgId, address key, uint64 at) internal view returns (bool) {
        SigningKey storage sk = _signingKeys[key];
        if (!sk.exists) return false;
        if (sk.organizationId != orgId) return false;
        uint32 epochAtT = _epochAtTime(orgId, at);
        if (sk.epoch != epochAtT) return false;
        if (sk.validFrom > at) return false;
        if (sk.validUntil != 0 && sk.validUntil <= at) return false;
        return true;
    }
}
