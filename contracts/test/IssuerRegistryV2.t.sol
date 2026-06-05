// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistryV2} from "../src/IssuerRegistryV2.sol";
import {IIssuerRegistryV2} from "../src/IIssuerRegistryV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IssuerRegistryV2Test is Test {
    IssuerRegistryV2 registry;

    address admin = address(0xA11CE);
    address controller = address(0xC0DE);
    address controller2 = address(0xBEEF);
    address key1 = address(0x1111);
    address key2 = address(0x2222);
    address key3 = address(0x3333);
    address rogue = address(0xDEAD);

    bytes32 constant ORG_A = keccak256("University A");
    bytes32 constant ORG_B = keccak256("University B");

    event OrganizationRegistered(
        bytes32 indexed orgId, address indexed controller, address indexed initialKey, string name
    );
    event OrganizationSuspended(bytes32 indexed orgId, string reason);
    event OrganizationReinstated(bytes32 indexed orgId, uint32 newEpoch, address initialKey);
    event ControllerTransferProposed(bytes32 indexed orgId, address indexed proposedController);
    event ControllerTransferred(bytes32 indexed orgId, address indexed newController);
    event SigningKeyAdded(
        bytes32 indexed orgId, address indexed key, uint32 epoch, uint64 validFrom
    );
    event SigningKeyRevoked(bytes32 indexed orgId, address indexed key, uint64 validUntil);

    function setUp() public {
        vm.prank(admin);
        registry = new IssuerRegistryV2(admin);
    }

    // ─────────────── Helpers ───────────────────────────────────────────────

    function _registerOrg(bytes32 orgId, address ctrl, address key) internal {
        vm.prank(admin);
        registry.registerOrganization(orgId, ctrl, key, uint64(block.timestamp), "HUST", "");
    }

    // ─────────────── Registration ─────────────────────────────────────────

    function test_RegisterOrganizationWithInitialKey() public {
        vm.expectEmit(true, true, true, false);
        emit OrganizationRegistered(ORG_A, controller, key1, "HUST");

        vm.prank(admin);
        registry.registerOrganization(
            ORG_A, controller, key1, uint64(block.timestamp), "HUST", "ipfs://meta"
        );

        assertTrue(registry.organizationExists(ORG_A));
        assertTrue(registry.isOrganizationActive(ORG_A));

        IIssuerRegistryV2.Organization memory org = registry.getOrganization(ORG_A);
        assertEq(org.controller, controller);
        assertEq(org.name, "HUST");
        assertEq(org.metadataURI, "ipfs://meta");
        assertEq(org.currentEpoch, 0);
        assertTrue(org.active);
        assertEq(org.suspendedAt, 0);

        IIssuerRegistryV2.SigningKey memory sk = registry.getSigningKey(key1);
        assertEq(sk.organizationId, ORG_A);
        assertEq(sk.epoch, 0);
        assertEq(sk.validUntil, 0);
        assertTrue(sk.exists);
    }

    function test_NonOwnerCannotRegister() public {
        vm.prank(rogue);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rogue));
        registry.registerOrganization(ORG_A, controller, key1, uint64(block.timestamp), "HUST", "");
    }

    function test_DuplicateOrgIdRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistryV2.OrgAlreadyExists.selector, ORG_A));
        registry.registerOrganization(
            ORG_A, controller2, key2, uint64(block.timestamp), "HUST2", ""
        );
    }

    function test_ZeroOrgIdRejected() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistryV2.ZeroOrgId.selector);
        registry.registerOrganization(
            bytes32(0), controller, key1, uint64(block.timestamp), "HUST", ""
        );
    }

    function test_ZeroControllerRejected() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistryV2.ZeroControllerAddress.selector);
        registry.registerOrganization(ORG_A, address(0), key1, uint64(block.timestamp), "HUST", "");
    }

    function test_ZeroInitialKeyRejected() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistryV2.ZeroKeyAddress.selector);
        registry.registerOrganization(
            ORG_A, controller, address(0), uint64(block.timestamp), "HUST", ""
        );
    }

    function test_EmptyNameRejected() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistryV2.EmptyName.selector);
        registry.registerOrganization(ORG_A, controller, key1, uint64(block.timestamp), "", "");
    }

    // ─────────────── Signing Key Management ───────────────────────────────

    function test_AddSigningKey_ControllerOnly() public {
        _registerOrg(ORG_A, controller, key1);

        vm.expectEmit(true, true, false, true);
        emit SigningKeyAdded(ORG_A, key2, 0, uint64(block.timestamp));

        vm.prank(controller);
        registry.addSigningKey(ORG_A, key2, uint64(block.timestamp));

        IIssuerRegistryV2.SigningKey memory sk = registry.getSigningKey(key2);
        assertEq(sk.organizationId, ORG_A);
        assertEq(sk.epoch, 0);
        assertTrue(sk.exists);
    }

    function test_AddSigningKey_NonControllerRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.CallerNotController.selector, rogue, ORG_A)
        );
        registry.addSigningKey(ORG_A, key2, uint64(block.timestamp));
    }

    function test_KeyReuse_SameKeyAcrossOrgsRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.KeyAlreadyRegistered.selector, key1)
        );
        registry.registerOrganization(ORG_B, controller2, key1, uint64(block.timestamp), "VNU", "");
    }

    function test_KeyReuse_AfterRevocationRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, key1);

        // Attempting to add the same key again to any org must fail
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.KeyAlreadyRegistered.selector, key1)
        );
        registry.registerOrganization(ORG_B, controller2, key1, uint64(block.timestamp), "VNU", "");
    }

    // ─────────────── wasAuthorizedAt ──────────────────────────────────────

    function test_WasAuthorizedAt_ActiveKey() public {
        uint64 t = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t));
        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t + 1000));
    }

    function test_WasAuthorizedAt_BeforeValidFrom() public {
        uint64 future = uint64(block.timestamp) + 1000;
        vm.prank(admin);
        registry.registerOrganization(ORG_A, controller, key1, future, "HUST", "");

        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, uint64(block.timestamp)));
        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, future));
    }

    function test_WasAuthorizedAt_AfterIndividualRevocation() public {
        uint64 t0 = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        vm.warp(t0 + 500);
        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, key1);
        uint64 t_revoke = uint64(block.timestamp);

        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t0 + 100));
        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, t_revoke));
        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, t_revoke + 1000));
    }

    // ─────────────── Suspension / Reinstatement ───────────────────────────

    function test_SuspendOrganization_EndsEpoch() public {
        uint64 t0 = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        vm.warp(t0 + 100);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A, "audit failure");

        assertFalse(registry.isOrganizationActive(ORG_A));
        IIssuerRegistryV2.Organization memory org = registry.getOrganization(ORG_A);
        assertFalse(org.active);
        assertGt(org.suspendedAt, 0);
    }

    function test_WasAuthorizedAt_OldKeyInvalidAfterSuspension() public {
        uint64 t0 = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        // key1 was authorized before suspension
        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t0 + 10));

        vm.warp(t0 + 100);
        uint64 t_suspend = uint64(block.timestamp);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A, "reason");

        // key1 should no longer be authorized AFTER suspension timestamp
        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, t_suspend));
        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, t_suspend + 1000));
        // But was authorized BEFORE suspension
        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t_suspend - 1));
    }

    function test_ReinstateOrganization_NewEpochWithNewKey() public {
        uint64 t0 = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        vm.warp(t0 + 100);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A, "audit");

        vm.warp(t0 + 200);
        uint64 t_reinstate = uint64(block.timestamp);

        vm.expectEmit(true, false, true, true);
        emit OrganizationReinstated(ORG_A, 1, key2);

        vm.prank(admin);
        registry.reinstateOrganization(ORG_A, key2, t_reinstate);

        assertTrue(registry.isOrganizationActive(ORG_A));
        IIssuerRegistryV2.Organization memory org = registry.getOrganization(ORG_A);
        assertEq(org.currentEpoch, 1);
        assertEq(org.suspendedAt, 0);
        assertTrue(org.active);

        IIssuerRegistryV2.SigningKey memory sk2 = registry.getSigningKey(key2);
        assertEq(sk2.epoch, 1);
    }

    function test_WasAuthorizedAt_OldKeyNeverCurrentAfterReinstatement() public {
        uint64 t0 = uint64(block.timestamp);
        _registerOrg(ORG_A, controller, key1);

        vm.warp(t0 + 100);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A, "reason");

        vm.warp(t0 + 200);
        uint64 t_reinstate = uint64(block.timestamp);
        vm.prank(admin);
        registry.reinstateOrganization(ORG_A, key2, t_reinstate);

        // key1 (epoch 0) must not be authorized after reinstatement
        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, t_reinstate + 10));
        // key2 (epoch 1) should be authorized after its validFrom
        assertTrue(registry.wasAuthorizedAt(ORG_A, key2, t_reinstate));
        assertTrue(registry.wasAuthorizedAt(ORG_A, key2, t_reinstate + 9999));
    }

    function test_KeyReuse_AfterEpochEndRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(admin);
        registry.suspendOrganization(ORG_A, "reason");

        // key1 belonged to epoch 0 — trying to register it again must fail even after epoch ended
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.KeyAlreadyRegistered.selector, key1)
        );
        registry.reinstateOrganization(ORG_A, key1, uint64(block.timestamp));
    }

    // ─────────────── Controller Transfer ──────────────────────────────────

    function test_ControllerTransferTwoStep() public {
        _registerOrg(ORG_A, controller, key1);

        vm.expectEmit(true, false, false, true);
        emit ControllerTransferProposed(ORG_A, controller2);

        vm.prank(controller);
        registry.proposeControllerTransfer(ORG_A, controller2);

        IIssuerRegistryV2.Organization memory org = registry.getOrganization(ORG_A);
        assertEq(org.pendingController, controller2);

        vm.expectEmit(true, false, false, true);
        emit ControllerTransferred(ORG_A, controller2);

        vm.prank(controller2);
        registry.acceptControllerTransfer(ORG_A);

        org = registry.getOrganization(ORG_A);
        assertEq(org.controller, controller2);
        assertEq(org.pendingController, address(0));
    }

    function test_NonPendingControllerCannotAcceptTransfer() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(controller);
        registry.proposeControllerTransfer(ORG_A, controller2);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistryV2.CallerNotPendingController.selector, rogue, ORG_A
            )
        );
        registry.acceptControllerTransfer(ORG_A);
    }

    function test_AcceptTransferWithNoPendingReverts() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(controller2);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistryV2.NoPendingTransfer.selector, ORG_A));
        registry.acceptControllerTransfer(ORG_A);
    }

    // ─────────────── Revocation ───────────────────────────────────────────

    function test_RevokeSigningKey_ByController() public {
        _registerOrg(ORG_A, controller, key1);
        uint64 t = uint64(block.timestamp);

        assertTrue(registry.wasAuthorizedAt(ORG_A, key1, t));

        vm.warp(t + 100);
        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, key1);

        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, uint64(block.timestamp)));
    }

    function test_RevokeSigningKey_ByOwner() public {
        _registerOrg(ORG_A, controller, key1);

        vm.warp(block.timestamp + 100);
        vm.prank(admin);
        registry.revokeSigningKey(ORG_A, key1);

        assertFalse(registry.wasAuthorizedAt(ORG_A, key1, uint64(block.timestamp)));
    }

    function test_RevokeSigningKey_NonControllerRejected() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistryV2.CallerNotControllerOrOwner.selector, rogue, ORG_A
            )
        );
        registry.revokeSigningKey(ORG_A, key1);
    }

    function test_CannotRevokeAlreadyRevokedKey() public {
        _registerOrg(ORG_A, controller, key1);

        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, key1);

        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistryV2.KeyAlreadyRevoked.selector, key1));
        registry.revokeSigningKey(ORG_A, key1);
    }

    function test_CannotRevokeKeyFromDifferentOrg() public {
        _registerOrg(ORG_A, controller, key1);
        _registerOrg(ORG_B, controller2, key2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IssuerRegistryV2.KeyNotInOrg.selector, key2, ORG_A));
        registry.revokeSigningKey(ORG_A, key2);
    }
}
