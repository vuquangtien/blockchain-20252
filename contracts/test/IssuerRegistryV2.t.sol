// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistryV2} from "../src/IssuerRegistryV2.sol";
import {IIssuerRegistryV2} from "../src/IIssuerRegistryV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IssuerRegistryV2Test is Test {
    IssuerRegistryV2 internal registry;

    address internal admin = address(0xA11CE);
    address internal controller = address(0xC0DE);
    address internal newController = address(0xBEEF);
    address internal signer1 = address(0x1111);
    address internal signer2 = address(0x2222);
    address internal signer3 = address(0x3333);
    address internal rogue = address(0xDEAD);

    bytes32 internal constant ORG_A = keccak256("ORG_A");
    bytes32 internal constant ORG_B = keccak256("ORG_B");

    function setUp() public {
        vm.prank(admin);
        registry = new IssuerRegistryV2(admin);
    }

    function _register(bytes32 organizationId, address controller_, address signingKey) internal {
        vm.prank(admin);
        registry.registerOrganization(
            organizationId,
            controller_,
            "University",
            "ipfs://meta",
            signingKey,
            uint64(block.timestamp)
        );
    }

    function testRegisterOrganizationStoresControllerEpochAndLists() public {
        _register(ORG_A, controller, signer1);

        IIssuerRegistryV2.Organization memory organization = registry.getOrganization(ORG_A);
        assertEq(organization.controller, controller);
        assertEq(organization.currentEpoch, 1);
        assertTrue(organization.active);
        assertEq(registry.organizationCount(), 1);
        assertEq(registry.organizationIdAt(0), ORG_A);
        assertEq(registry.signingKeyCount(ORG_A), 1);
        assertEq(registry.signingKeyAt(ORG_A, 0), signer1);

        IIssuerRegistryV2.SigningKey memory keyRecord = registry.getSigningKey(signer1);
        assertEq(keyRecord.organizationId, ORG_A);
        assertEq(keyRecord.epoch, 1);
        assertEq(keyRecord.validUntil, 0);
    }

    function testUnknownOrganizationViewsReturnFalseOrRevert() public view {
        assertFalse(registry.organizationExists(ORG_A));
        assertFalse(registry.isOrganizationActive(ORG_A));
        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer1));
        assertFalse(registry.wasAuthorizedKeyAt(ORG_A, signer1, 1));
    }

    function testRegisterRejectsInvalidInputs() public {
        vm.startPrank(admin);

        vm.expectRevert(IssuerRegistryV2.ZeroOrganizationId.selector);
        registry.registerOrganization(bytes32(0), controller, "U", "", signer1, 1);

        vm.expectRevert(IssuerRegistryV2.ZeroAddress.selector);
        registry.registerOrganization(ORG_A, address(0), "U", "", signer1, 1);

        vm.expectRevert(IssuerRegistryV2.ZeroAddress.selector);
        registry.registerOrganization(ORG_A, controller, "U", "", address(0), 1);

        vm.expectRevert(IssuerRegistryV2.EmptyName.selector);
        registry.registerOrganization(ORG_A, controller, "", "", signer1, 1);

        vm.stopPrank();
    }

    function testRegisterRequiresOwnerAndUniqueOrganizationAndKey() public {
        vm.prank(rogue);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rogue));
        registry.registerOrganization(ORG_A, controller, "U", "", signer1, 1);

        _register(ORG_A, controller, signer1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationAlreadyExists.selector, ORG_A)
        );
        registry.registerOrganization(ORG_A, controller, "U2", "", signer2, 1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.SigningKeyAlreadyUsed.selector, signer1)
        );
        registry.registerOrganization(ORG_B, controller, "U2", "", signer1, 1);
    }

    function testControllerCanUpdateMetadataAndTransferController() public {
        _register(ORG_A, controller, signer1);

        vm.prank(controller);
        registry.updateOrganization(ORG_A, "Updated", "ipfs://updated");

        IIssuerRegistryV2.Organization memory organization = registry.getOrganization(ORG_A);
        assertEq(organization.name, "Updated");
        assertEq(organization.metadataURI, "ipfs://updated");

        vm.prank(controller);
        registry.proposeControllerTransfer(ORG_A, newController);

        organization = registry.getOrganization(ORG_A);
        assertEq(organization.pendingController, newController);

        vm.prank(newController);
        registry.acceptControllerTransfer(ORG_A);
        organization = registry.getOrganization(ORG_A);
        assertEq(organization.controller, newController);
        assertEq(organization.pendingController, address(0));
        assertTrue(registry.isOrganizationController(ORG_A, newController));
    }

    function testOnlyControllerCanManageOrganizationState() public {
        _register(ORG_A, controller, signer1);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.InvalidController.selector, ORG_A, rogue)
        );
        registry.updateOrganization(ORG_A, "Nope", "");

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.InvalidController.selector, ORG_A, rogue)
        );
        registry.proposeControllerTransfer(ORG_A, newController);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.NoPendingController.selector, ORG_A)
        );
        registry.acceptControllerTransfer(ORG_A);
    }

    function testControllerTransferRejectsZeroAddress() public {
        _register(ORG_A, controller, signer1);

        vm.prank(controller);
        vm.expectRevert(IssuerRegistryV2.ZeroAddress.selector);
        registry.proposeControllerTransfer(ORG_A, address(0));
    }

    function testControllerCanAddKeysAndCurrentAuthorizationTracksEpochAndRevocation() public {
        _register(ORG_A, controller, signer1);
        uint64 nowTs = uint64(block.timestamp);

        vm.prank(controller);
        registry.addSigningKey(ORG_A, signer2, nowTs + 20);

        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
        vm.warp(nowTs + 20);
        assertTrue(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer2, nowTs + 20));

        vm.warp(nowTs + 40);
        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, signer2);

        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer2, nowTs + 30));
        assertFalse(registry.wasAuthorizedKeyAt(ORG_A, signer2, uint64(block.timestamp)));
    }

    function testOwnerCanRevokeButUnauthorizedCallerCannot() public {
        _register(ORG_A, controller, signer1);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.InvalidControllerOrOwner.selector, ORG_A, rogue)
        );
        registry.revokeSigningKey(ORG_A, signer1);

        vm.prank(admin);
        registry.revokeSigningKey(ORG_A, signer1);
        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer1));
    }

    function testSuspensionEndsEpochAndReinstatementStartsNewOne() public {
        _register(ORG_A, controller, signer1);
        uint64 preSuspend = uint64(block.timestamp);
        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer1, preSuspend));

        vm.warp(preSuspend + 100);
        uint64 suspendedAt = uint64(block.timestamp);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A);

        IIssuerRegistryV2.Organization memory organization = registry.getOrganization(ORG_A);
        assertFalse(organization.active);
        assertEq(organization.suspendedAt, suspendedAt);
        assertEq(registry.epochEndedAt(ORG_A, 1), suspendedAt);
        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer1));
        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer1, suspendedAt - 1));
        assertFalse(registry.wasAuthorizedKeyAt(ORG_A, signer1, suspendedAt));

        vm.warp(suspendedAt + 10);
        vm.prank(admin);
        registry.reinstateOrganization(ORG_A, signer2, uint64(block.timestamp));

        organization = registry.getOrganization(ORG_A);
        assertTrue(organization.active);
        assertEq(organization.currentEpoch, 2);
        assertEq(organization.suspendedAt, 0);
        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer1));
        assertTrue(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
        assertFalse(registry.wasAuthorizedKeyAt(ORG_A, signer1, uint64(block.timestamp)));
    }

    function testSuspendedOrganizationCannotAddKeysUntilReinstated() public {
        _register(ORG_A, controller, signer1);

        vm.prank(admin);
        registry.suspendOrganization(ORG_A);

        vm.prank(controller);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationInactive.selector, ORG_A)
        );
        registry.addSigningKey(ORG_A, signer2, uint64(block.timestamp));
    }

    function testSuspendAndReinstateRejectInvalidLifecycleTransitions() public {
        _register(ORG_A, controller, signer1);

        vm.prank(admin);
        registry.suspendOrganization(ORG_A);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationAlreadySuspended.selector, ORG_A)
        );
        registry.suspendOrganization(ORG_A);

        vm.prank(admin);
        registry.reinstateOrganization(ORG_A, signer2, uint64(block.timestamp));

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationAlreadyActive.selector, ORG_A)
        );
        registry.reinstateOrganization(ORG_A, signer3, uint64(block.timestamp));
    }

    function testKeyReuseIsBlockedAcrossRevocationAndEpochChanges() public {
        _register(ORG_A, controller, signer1);

        vm.prank(controller);
        registry.revokeSigningKey(ORG_A, signer1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.SigningKeyAlreadyUsed.selector, signer1)
        );
        registry.registerOrganization(ORG_B, controller, "Other", "", signer1, 1);

        vm.prank(admin);
        registry.suspendOrganization(ORG_A);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.SigningKeyAlreadyUsed.selector, signer1)
        );
        registry.reinstateOrganization(ORG_A, signer1, uint64(block.timestamp));
    }

    function testUnknownOrganizationMutationsRevert() public {
        vm.prank(controller);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationNotFound.selector, ORG_A)
        );
        registry.updateOrganization(ORG_A, "Missing", "");

        vm.prank(controller);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationNotFound.selector, ORG_A)
        );
        registry.addSigningKey(ORG_A, signer1, 1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.OrganizationNotFound.selector, ORG_A)
        );
        registry.suspendOrganization(ORG_A);
    }

    function testGetUnknownSigningKeyReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistryV2.SigningKeyNotFound.selector, signer1)
        );
        registry.getSigningKey(signer1);
    }

    function testCurrentAuthorizationRequiresCurrentEpochAndActiveOrganization() public {
        _register(ORG_A, controller, signer1);
        uint64 validFrom = uint64(block.timestamp + 10);

        vm.prank(controller);
        registry.addSigningKey(ORG_A, signer2, validFrom);

        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
        vm.warp(validFrom);
        assertTrue(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));

        vm.prank(admin);
        registry.suspendOrganization(ORG_A);
        assertFalse(registry.isCurrentlyAuthorizedKey(ORG_A, signer2));
    }

    function testHistoricalAuthorizationTracksEpochEndSeparatelyFromCurrentEpoch() public {
        _register(ORG_A, controller, signer1);
        uint64 t0 = uint64(block.timestamp);

        vm.warp(t0 + 20);
        vm.prank(admin);
        registry.suspendOrganization(ORG_A);

        vm.warp(t0 + 40);
        vm.prank(admin);
        registry.reinstateOrganization(ORG_A, signer2, uint64(block.timestamp));

        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer1, t0 + 10));
        assertFalse(registry.wasAuthorizedKeyAt(ORG_A, signer1, t0 + 20));
        assertTrue(registry.wasAuthorizedKeyAt(ORG_A, signer2, t0 + 40));
    }

    function testGas_RegisterOrganization() public {
        vm.pauseGasMetering();
        vm.startPrank(admin);
        vm.resumeGasMetering();

        registry.registerOrganization(ORG_A, controller, "University", "ipfs://meta", signer1, 1);

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testGas_AddSigningKey() public {
        vm.pauseGasMetering();
        _register(ORG_A, controller, signer1);

        vm.startPrank(controller);
        vm.resumeGasMetering();

        registry.addSigningKey(ORG_A, signer2, uint64(block.timestamp));

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testGas_RevokeSigningKey() public {
        vm.pauseGasMetering();
        _register(ORG_A, controller, signer1);
        vm.prank(controller);
        registry.addSigningKey(ORG_A, signer2, uint64(block.timestamp));

        vm.startPrank(controller);
        vm.resumeGasMetering();

        registry.revokeSigningKey(ORG_A, signer2);

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testInvalidIndexesAndCrossOrganizationKeyChecksRevert() public {
        _register(ORG_A, controller, signer1);
        _register(ORG_B, newController, signer3);

        vm.expectRevert(IssuerRegistryV2.InvalidIndex.selector);
        registry.organizationIdAt(2);

        vm.expectRevert(IssuerRegistryV2.InvalidIndex.selector);
        registry.signingKeyAt(ORG_A, 1);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuerRegistryV2.SigningKeyWrongOrganization.selector, ORG_A, signer3
            )
        );
        registry.revokeSigningKey(ORG_A, signer3);
    }
}
