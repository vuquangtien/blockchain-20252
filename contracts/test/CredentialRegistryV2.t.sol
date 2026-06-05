// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistryV2} from "../src/IssuerRegistryV2.sol";
import {CredentialRegistryV2} from "../src/CredentialRegistryV2.sol";
import {ICredentialRegistryV2} from "../src/ICredentialRegistryV2.sol";

contract CredentialRegistryV2Test is Test {
    IssuerRegistryV2 issuerRegistry;
    CredentialRegistryV2 credentialRegistry;

    address admin = address(0xA11CE);
    address controller = address(0xC0DE);
    address signer1 = address(0x1111);
    address signer2 = address(0x2222);
    address rogue = address(0xDEAD);

    bytes32 constant ORG_A = keccak256("University A");
    bytes32 constant CRED_ID = keccak256("cred-1");
    bytes32 constant CRED_ID_2 = keccak256("cred-2");
    bytes32 constant CRED_DIGEST = keccak256("eip712-digest-1");
    bytes32 constant HOLDER_COMMIT = keccak256(abi.encodePacked(address(0xABCD)));

    function setUp() public {
        vm.startPrank(admin);
        issuerRegistry = new IssuerRegistryV2(admin);
        credentialRegistry = new CredentialRegistryV2(issuerRegistry);

        // Register ORG_A with signer1 as initial signing key
        issuerRegistry.registerOrganization(
            ORG_A, controller, signer1, uint64(block.timestamp), "HUST", ""
        );
        vm.stopPrank();
    }

    // ─────────────── Helpers ───────────────────────────────────────────────

    function _anchor(bytes32 credId) internal {
        vm.prank(signer1);
        credentialRegistry.anchorCredentialV2(
            credId, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    // ─────────────── Anchoring ─────────────────────────────────────────────

    function test_AnchorByAuthorizedSigner() public {
        _anchor(CRED_ID);

        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Valid)
        );

        ICredentialRegistryV2.AnchorV2 memory a = credentialRegistry.getAnchorV2(CRED_ID);
        assertEq(a.orgId, ORG_A);
        assertEq(a.signer, signer1);
        assertEq(a.credentialDigest, CRED_DIGEST);
        assertEq(a.holderCommitment, HOLDER_COMMIT);
        assertEq(a.revocationIndex, 0);
        assertTrue(a.exists);
    }

    function test_UnauthorizedKeyCannotAnchor() public {
        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.NotAuthorizedSigner.selector, rogue, ORG_A)
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_RevokedKeyCannotAnchor() public {
        // Revoke signer1 individually
        vm.prank(controller);
        issuerRegistry.revokeSigningKey(ORG_A, signer1);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.NotAuthorizedSigner.selector, signer1, ORG_A
            )
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_SuspendedOrgSignerCannotAnchor() public {
        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A, "audit");

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.NotAuthorizedSigner.selector, signer1, ORG_A
            )
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_CannotAnchorTwice() public {
        _anchor(CRED_ID);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.CredentialAlreadyAnchored.selector, CRED_ID)
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_ZeroCredentialIdRejected() public {
        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroCredentialId.selector);
        credentialRegistry.anchorCredentialV2(
            bytes32(0), ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_ZeroCredentialDigestRejected() public {
        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroCredentialDigest.selector);
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, bytes32(0), HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    function test_ZeroHolderCommitmentRejected() public {
        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroHolderCommitment.selector);
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, bytes32(0), uint64(block.timestamp), 0
        );
    }

    function test_InvalidExpiryRejected() public {
        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.InvalidExpiry.selector, uint64(2000), uint64(1000)
            )
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, 2000, 1000
        );
    }

    // Signer-scoped: a different authorized key of the same org cannot replace an existing anchor
    function test_DifferentSignerCannotReplaceExistingAnchor() public {
        _anchor(CRED_ID);

        // Add signer2 to ORG_A
        vm.prank(controller);
        issuerRegistry.addSigningKey(ORG_A, signer2, uint64(block.timestamp));

        vm.prank(signer2);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.CredentialAlreadyAnchored.selector, CRED_ID)
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
    }

    // ─────────────── Revocation ───────────────────────────────────────────

    function test_RevocationByOriginalSigner() public {
        _anchor(CRED_ID);

        vm.prank(signer1);
        credentialRegistry.revokeCredentialV2(CRED_ID);

        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Revoked)
        );
        assertFalse(credentialRegistry.isCurrentlyValidV2(CRED_ID));

        ICredentialRegistryV2.AnchorV2 memory a = credentialRegistry.getAnchorV2(CRED_ID);
        assertTrue(credentialRegistry.isRevokedByIndex(a.revocationIndex));
    }

    function test_RevocationByOrgController() public {
        _anchor(CRED_ID);

        vm.prank(controller);
        credentialRegistry.revokeCredentialV2(CRED_ID);

        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Revoked)
        );
    }

    function test_NonSignerNonControllerCannotRevoke() public {
        _anchor(CRED_ID);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.CallerNotAuthorized.selector, rogue)
        );
        credentialRegistry.revokeCredentialV2(CRED_ID);
    }

    function test_CannotRevokeAlreadyRevoked() public {
        _anchor(CRED_ID);

        vm.prank(signer1);
        credentialRegistry.revokeCredentialV2(CRED_ID);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.AlreadyRevoked.selector, CRED_ID)
        );
        credentialRegistry.revokeCredentialV2(CRED_ID);
    }

    function test_CannotRevokeNonExistent() public {
        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.CredentialNotFound.selector, CRED_ID)
        );
        credentialRegistry.revokeCredentialV2(CRED_ID);
    }

    // ─────────────── Bitmap Revocation ────────────────────────────────────

    function test_BitmapRevocation_MultipleInSameSlot() public {
        // Anchor two credentials — both get indices 0 and 1, same bitmap slot (slot 0)
        vm.startPrank(signer1);
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, uint64(block.timestamp), 0
        );
        credentialRegistry.anchorCredentialV2(
            CRED_ID_2, ORG_A, keccak256("digest-2"), HOLDER_COMMIT, uint64(block.timestamp), 0
        );
        vm.stopPrank();

        ICredentialRegistryV2.AnchorV2 memory a1 = credentialRegistry.getAnchorV2(CRED_ID);
        ICredentialRegistryV2.AnchorV2 memory a2 = credentialRegistry.getAnchorV2(CRED_ID_2);

        assertEq(a1.revocationIndex, 0);
        assertEq(a2.revocationIndex, 1);
        assertFalse(credentialRegistry.isRevokedByIndex(0));
        assertFalse(credentialRegistry.isRevokedByIndex(1));

        // Revoke first credential only
        vm.prank(signer1);
        credentialRegistry.revokeCredentialV2(CRED_ID);

        assertTrue(credentialRegistry.isRevokedByIndex(0));
        assertFalse(credentialRegistry.isRevokedByIndex(1)); // second credential unaffected

        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Revoked)
        );
        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID_2)),
            uint8(ICredentialRegistryV2.StatusV2.Valid)
        );
    }

    function test_BitmapRevocation_AcrossSlotBoundary() public {
        // Anchor 256 credentials to fill slot 0, then one more in slot 1
        bytes32 lastInSlot0;
        bytes32 firstInSlot1;

        // Fill indices 0..254
        for (uint256 i = 0; i < 255; i++) {
            bytes32 id = keccak256(abi.encodePacked("cred", i));
            vm.prank(signer1);
            credentialRegistry.anchorCredentialV2(
                id,
                ORG_A,
                keccak256(abi.encodePacked("digest", i)),
                HOLDER_COMMIT,
                uint64(block.timestamp),
                0
            );
        }

        // Index 255 — last bit of slot 0
        lastInSlot0 = keccak256(abi.encodePacked("cred255"));
        vm.prank(signer1);
        credentialRegistry.anchorCredentialV2(
            lastInSlot0, ORG_A, keccak256("d255"), HOLDER_COMMIT, uint64(block.timestamp), 0
        );

        // Index 256 — first bit of slot 1
        firstInSlot1 = keccak256(abi.encodePacked("cred256"));
        vm.prank(signer1);
        credentialRegistry.anchorCredentialV2(
            firstInSlot1, ORG_A, keccak256("d256"), HOLDER_COMMIT, uint64(block.timestamp), 0
        );

        ICredentialRegistryV2.AnchorV2 memory aLast = credentialRegistry.getAnchorV2(lastInSlot0);
        ICredentialRegistryV2.AnchorV2 memory aFirst = credentialRegistry.getAnchorV2(firstInSlot1);

        assertEq(aLast.revocationIndex, 255);
        assertEq(aFirst.revocationIndex, 256);

        // Revoke the slot-1 credential
        vm.prank(signer1);
        credentialRegistry.revokeCredentialV2(firstInSlot1);

        assertTrue(credentialRegistry.isRevokedByIndex(256));
        assertFalse(credentialRegistry.isRevokedByIndex(255)); // slot 0 untouched
    }

    // ─────────────── Status / Validity ────────────────────────────────────

    function test_ExpiredStatus() public {
        uint64 t = uint64(block.timestamp);
        vm.prank(signer1);
        credentialRegistry.anchorCredentialV2(
            CRED_ID, ORG_A, CRED_DIGEST, HOLDER_COMMIT, t, t + 100
        );

        vm.warp(t + 200);
        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Expired)
        );
        assertFalse(credentialRegistry.isCurrentlyValidV2(CRED_ID));
    }

    function test_UnknownStatus_NeverAnchored() public view {
        assertEq(
            uint8(credentialRegistry.statusOfV2(keccak256("unknown"))),
            uint8(ICredentialRegistryV2.StatusV2.Unknown)
        );
    }

    function test_IsCurrentlyValidV2_FalseWhenOrgSuspended() public {
        _anchor(CRED_ID);
        assertTrue(credentialRegistry.isCurrentlyValidV2(CRED_ID));

        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A, "reason");

        // Anchor status is still Valid (not revoked or expired), but isCurrentlyValidV2 is false
        assertEq(
            uint8(credentialRegistry.statusOfV2(CRED_ID)),
            uint8(ICredentialRegistryV2.StatusV2.Valid)
        );
        assertFalse(credentialRegistry.isCurrentlyValidV2(CRED_ID));
    }

    function testFuzz_AnchorRevokeRoundtrip(
        bytes32 credId,
        bytes32 digest,
        bytes32 holderCommit,
        uint64 issuedAt
    ) public {
        vm.assume(credId != bytes32(0));
        vm.assume(digest != bytes32(0));
        vm.assume(holderCommit != bytes32(0));
        vm.assume(issuedAt > 0 && issuedAt < type(uint64).max - 1000);

        vm.warp(issuedAt + 10);

        vm.prank(signer1);
        credentialRegistry.anchorCredentialV2(credId, ORG_A, digest, holderCommit, issuedAt, 0);

        assertTrue(credentialRegistry.isCurrentlyValidV2(credId));

        vm.prank(signer1);
        credentialRegistry.revokeCredentialV2(credId);

        assertFalse(credentialRegistry.isCurrentlyValidV2(credId));
        assertEq(
            uint8(credentialRegistry.statusOfV2(credId)),
            uint8(ICredentialRegistryV2.StatusV2.Revoked)
        );
    }
}
