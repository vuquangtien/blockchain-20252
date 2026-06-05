// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIssuerRegistryV2
/// @notice Interface for the on-chain V2 registry of universities modeled as organizations
///         with rotatable signing keys and epoch-based authorization history.
interface IIssuerRegistryV2 {
    // ─────────────────────────── Data Structures ────────────────────────────

    /// @notice On-chain record for an issuing organization (e.g. a university).
    /// @dev    `currentEpoch` is incremented on every suspension+reinstatement cycle.
    ///         All signing keys from earlier epochs are permanently invalidated.
    struct Organization {
        address controller; // address allowed to manage the organization's keys and metadata
        address pendingController; // proposed next controller (two-step transfer)
        string name; // human-readable organization name
        string metadataURI; // optional off-chain metadata URI
        uint64 registeredAt;
        uint64 suspendedAt; // 0 if currently active
        uint32 currentEpoch; // monotonically increasing; starts at 0
        bool active;
    }

    /// @notice On-chain record for a signing key belonging to an organization.
    /// @dev    `validUntil == 0` means the key has not been individually revoked;
    ///         it may still be logically expired because its epoch ended.
    struct SigningKey {
        bytes32 organizationId;
        uint32 epoch; // epoch of the organization when this key was added
        uint64 validFrom;
        uint64 validUntil; // 0 = not individually revoked
        bool exists;
    }

    // ──────────────────────────────── Events ────────────────────────────────

    event OrganizationRegistered(
        bytes32 indexed orgId, address indexed controller, address indexed initialKey, string name
    );
    event OrganizationUpdated(bytes32 indexed orgId, string name, string metadataURI);
    event OrganizationSuspended(bytes32 indexed orgId, string reason);
    event OrganizationReinstated(bytes32 indexed orgId, uint32 newEpoch, address initialKey);
    event ControllerTransferProposed(bytes32 indexed orgId, address indexed proposedController);
    event ControllerTransferred(bytes32 indexed orgId, address indexed newController);
    event SigningKeyAdded(
        bytes32 indexed orgId, address indexed key, uint32 epoch, uint64 validFrom
    );
    event SigningKeyRevoked(bytes32 indexed orgId, address indexed key, uint64 validUntil);

    // ────────────────────────── Owner-only Mutations ────────────────────────

    /// @notice Register a new organization with an initial signing key.
    /// @param  orgId        Globally unique nonzero bytes32 identifier for the organization.
    /// @param  controller   Address that will manage the organization.
    /// @param  initialKey   First signing key address for the organization.
    /// @param  keyValidFrom Timestamp from which `initialKey` is considered authorized.
    /// @param  name         Human-readable organization name (non-empty).
    /// @param  metadataURI  Optional off-chain metadata URI.
    function registerOrganization(
        bytes32 orgId,
        address controller,
        address initialKey,
        uint64 keyValidFrom,
        string calldata name,
        string calldata metadataURI
    ) external;

    /// @notice Suspend an active organization. Ends the current epoch, invalidating all
    ///         existing signing keys for authorization purposes from this point forward.
    function suspendOrganization(bytes32 orgId, string calldata reason) external;

    /// @notice Reinstate a suspended organization into a new epoch with a fresh initial key.
    ///         Old keys from previous epochs will never become current again.
    function reinstateOrganization(bytes32 orgId, address initialKey, uint64 keyValidFrom) external;

    // ────────────────────── Controller-only Mutations ───────────────────────

    /// @notice Update the organization's name and metadata URI.
    function updateOrganization(bytes32 orgId, string calldata name, string calldata metadataURI)
        external;

    /// @notice Propose a controller transfer (step 1 of 2).
    function proposeControllerTransfer(bytes32 orgId, address newController) external;

    /// @notice Accept a pending controller transfer (step 2 of 2, called by `newController`).
    function acceptControllerTransfer(bytes32 orgId) external;

    /// @notice Add a new signing key to the organization under the current epoch.
    /// @param  validFrom Timestamp from which the key is authorized.
    function addSigningKey(bytes32 orgId, address key, uint64 validFrom) external;

    // ─────────────── Controller or Owner Mutations ──────────────────────────

    /// @notice Individually revoke a signing key. Sets its `validUntil` to the current block
    ///         timestamp. The key can no longer be re-added to any organization.
    function revokeSigningKey(bytes32 orgId, address key) external;

    // ────────────────────────────── Views ───────────────────────────────────

    /// @notice Returns true if an organization record with `orgId` exists.
    function organizationExists(bytes32 orgId) external view returns (bool);

    /// @notice Returns true if the organization is currently active (not suspended).
    function isOrganizationActive(bytes32 orgId) external view returns (bool);

    /// @notice Returns true if `key` was an authorized signing key for `orgId` at timestamp `at`.
    /// @dev    "Authorized at `at`" means:
    ///           1. `key` is registered to `orgId`.
    ///           2. `key.epoch` equals the organization's epoch at time `at`.
    ///           3. `key.validFrom <= at`.
    ///           4. `key.validUntil == 0 || key.validUntil > at`.
    function wasAuthorizedAt(bytes32 orgId, address key, uint64 at) external view returns (bool);

    /// @notice Returns the full Organization record. Reverts if `orgId` does not exist.
    function getOrganization(bytes32 orgId) external view returns (Organization memory);

    /// @notice Returns the full SigningKey record. Reverts if `key` was never registered.
    function getSigningKey(address key) external view returns (SigningKey memory);
}
