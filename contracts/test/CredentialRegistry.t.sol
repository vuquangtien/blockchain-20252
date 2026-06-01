// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {CredentialRegistry} from "../src/CredentialRegistry.sol";

contract CredentialRegistryTest is Test {
    IssuerRegistry issuerRegistry;
    CredentialRegistry credentialRegistry;

    address admin = address(0xA11CE);
    address university = address(0xBEEF);
    address rogue = address(0xDEAD);

    bytes32 constant CRED_ID = keccak256("cred-1");
    bytes32 constant HOLDER_HASH = keccak256("alice@hust.edu.vn");
    bytes32 constant MROOT = keccak256("merkle-root");

    function setUp() public {
        vm.startPrank(admin);
        issuerRegistry = new IssuerRegistry(admin);
        credentialRegistry = new CredentialRegistry(issuerRegistry);
        issuerRegistry.registerIssuer(university, "HUST", "");
        vm.stopPrank();
    }

    function test_AnchorByAuthorizedIssuer() public {
        vm.prank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);

        assertEq(
            uint8(credentialRegistry.statusOf(CRED_ID)), uint8(CredentialRegistry.Status.Valid)
        );
        CredentialRegistry.CredentialAnchor memory a = credentialRegistry.getAnchor(CRED_ID);
        assertEq(a.issuer, university);
        assertEq(a.holderHash, HOLDER_HASH);
        assertEq(a.merkleRoot, MROOT);
        assertTrue(a.exists);
    }

    function test_UnauthorizedCannotAnchor() public {
        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistry.NotAuthorizedIssuer.selector, rogue)
        );
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);
    }

    function test_CannotAnchorTwice() public {
        vm.startPrank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistry.CredentialAlreadyAnchored.selector, CRED_ID)
        );
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);
        vm.stopPrank();
    }

    function test_ZeroMerkleRootRejected() public {
        vm.prank(university);
        vm.expectRevert(CredentialRegistry.ZeroMerkleRoot.selector);
        credentialRegistry.anchorCredential(
            CRED_ID, HOLDER_HASH, bytes32(0), uint64(block.timestamp), 0
        );
    }

    function test_ZeroCredentialIdRejected() public {
        vm.prank(university);
        vm.expectRevert(CredentialRegistry.ZeroCredentialId.selector);
        credentialRegistry.anchorCredential(
            bytes32(0), HOLDER_HASH, MROOT, uint64(block.timestamp), 0
        );
    }

    function test_ZeroHolderHashRejected() public {
        vm.prank(university);
        vm.expectRevert(CredentialRegistry.ZeroHolderHash.selector);
        credentialRegistry.anchorCredential(CRED_ID, bytes32(0), MROOT, uint64(block.timestamp), 0);
    }

    function test_InvalidExpiryRejected() public {
        vm.prank(university);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.InvalidExpiry.selector, uint64(2000), uint64(1000)
            )
        );
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, 2000, 1000);
    }

    function test_RevocationByIssuer() public {
        vm.startPrank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);
        credentialRegistry.revokeCredential(CRED_ID, "academic dishonesty");
        vm.stopPrank();

        assertEq(
            uint8(credentialRegistry.statusOf(CRED_ID)), uint8(CredentialRegistry.Status.Revoked)
        );
        assertEq(credentialRegistry.revocationReason(CRED_ID), "academic dishonesty");
        assertFalse(credentialRegistry.isCurrentlyValid(CRED_ID));
    }

    function test_NonIssuerCannotRevoke() public {
        vm.prank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);

        vm.prank(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistry.CallerNotIssuer.selector, rogue, university)
        );
        credentialRegistry.revokeCredential(CRED_ID, "trying to grief");
    }

    function test_ExpiredStatus() public {
        uint64 t = uint64(block.timestamp);
        vm.prank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, t, t + 100);
        vm.warp(t + 200);

        assertEq(
            uint8(credentialRegistry.statusOf(CRED_ID)), uint8(CredentialRegistry.Status.Expired)
        );
        assertFalse(credentialRegistry.isCurrentlyValid(CRED_ID));
    }

    function test_UnknownCredentialStatus() public view {
        assertEq(
            uint8(credentialRegistry.statusOf(keccak256("nope"))),
            uint8(CredentialRegistry.Status.Unknown)
        );
    }

    function test_IssuerLosesAuthority_StatusReflects() public {
        vm.prank(university);
        credentialRegistry.anchorCredential(CRED_ID, HOLDER_HASH, MROOT, uint64(block.timestamp), 0);

        assertTrue(credentialRegistry.isCurrentlyValid(CRED_ID));

        vm.prank(admin);
        issuerRegistry.revokeIssuer(university, "lost accreditation");

        // statusOf still reports Valid (anchor itself wasn't revoked) but isCurrentlyValid is false
        assertEq(
            uint8(credentialRegistry.statusOf(CRED_ID)), uint8(CredentialRegistry.Status.Valid)
        );
        assertFalse(credentialRegistry.isCurrentlyValid(CRED_ID));
    }

    function test_VerifyClaimHashMatchesOffchainMerkleShape() public view {
        bytes32 left = keccak256(abi.encodePacked(bytes1(0x00), bytes("claim:A")));
        bytes32 right = keccak256(abi.encodePacked(bytes1(0x00), bytes("claim:B")));
        bytes32 root = keccak256(abi.encodePacked(bytes1(0x01), left, right));

        bytes32[] memory siblings = new bytes32[](1);
        bool[] memory positions = new bool[](1);

        siblings[0] = right;
        positions[0] = false;
        assertTrue(credentialRegistry.verifyClaimHash(left, siblings, positions, root));

        siblings[0] = left;
        positions[0] = true;
        assertTrue(credentialRegistry.verifyClaimHash(right, siblings, positions, root));

        positions[0] = false;
        assertFalse(credentialRegistry.verifyClaimHash(right, siblings, positions, root));
    }

    function test_VerifyClaimHashRejectsLengthMismatch() public view {
        bytes32[] memory siblings = new bytes32[](1);
        bool[] memory positions = new bool[](0);
        assertFalse(credentialRegistry.verifyClaimHash(MROOT, siblings, positions, MROOT));
    }

    function testFuzz_AnchorRevokeRoundtrip(bytes32 cid, bytes32 hh, bytes32 root, uint64 issuedAt)
        public
    {
        vm.assume(root != bytes32(0));
        vm.assume(cid != bytes32(0));
        vm.assume(hh != bytes32(0));
        vm.assume(issuedAt > 0 && issuedAt < type(uint64).max - 1000);
        vm.warp(issuedAt + 10);

        vm.prank(university);
        credentialRegistry.anchorCredential(cid, hh, root, issuedAt, 0);
        assertTrue(credentialRegistry.isCurrentlyValid(cid));

        vm.prank(university);
        credentialRegistry.revokeCredential(cid, "fuzz");
        assertFalse(credentialRegistry.isCurrentlyValid(cid));
    }
}
