// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistryV2} from "../src/IssuerRegistryV2.sol";
import {CredentialRegistryV2} from "../src/CredentialRegistryV2.sol";
import {ICredentialRegistryV2} from "../src/ICredentialRegistryV2.sol";
import {IIssuerRegistryV2} from "../src/IIssuerRegistryV2.sol";

contract CredentialRegistryV2Test is Test {
    IssuerRegistryV2 internal issuerRegistry;
    CredentialRegistryV2 internal credentialRegistry;

    address internal admin = address(0xA11CE);
    address internal controller = address(0xC0DE);
    address internal signer1 = address(0x1111);
    address internal signer2 = address(0x2222);
    address internal outsider = address(0xDEAD);
    address internal holder = address(0xABCD);

    bytes32 internal constant ORG_A = keccak256("ORG_A");
    bytes32 internal constant ORG_B = keccak256("ORG_B");
    bytes32 internal constant CREDENTIAL_ID = keccak256("credential-1");
    bytes32 internal constant DIGEST = keccak256("digest-1");
    bytes32 internal constant ROOT = keccak256("root-1");

    function setUp() public {
        vm.startPrank(admin);
        issuerRegistry = new IssuerRegistryV2(admin);
        credentialRegistry = new CredentialRegistryV2(issuerRegistry);
        issuerRegistry.registerOrganization(
            ORG_A, controller, "University A", "ipfs://a", signer1, uint64(block.timestamp)
        );
        issuerRegistry.registerOrganization(
            ORG_B,
            address(0xB0B),
            "University B",
            "ipfs://b",
            address(0x3333),
            uint64(block.timestamp)
        );
        vm.stopPrank();
    }

    function _holderCommitment(bytes32 organizationId, address signer, bytes32 credentialId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(organizationId, signer, credentialId, address(0xABCD)));
    }

    function _anchorAs(
        address signer,
        bytes32 organizationId,
        bytes32 credentialId,
        uint64 issuedAt
    ) internal {
        vm.prank(signer);
        credentialRegistry.anchorCredential(
            organizationId,
            credentialId,
            DIGEST,
            _holderCommitment(organizationId, signer, credentialId),
            ROOT,
            issuedAt,
            0,
            2
        );
    }

    function _anchorCustom(
        address signer,
        bytes32 organizationId,
        bytes32 credentialId,
        bytes32 digest,
        bytes32 merkleRoot,
        uint64 issuedAt,
        uint64 expiresAt,
        uint32 claimCount
    ) internal {
        vm.prank(signer);
        credentialRegistry.anchorCredential(
            organizationId,
            credentialId,
            digest,
            _holderCommitment(organizationId, signer, credentialId),
            merkleRoot,
            issuedAt,
            expiresAt,
            claimCount
        );
    }

    function testConstructorRejectsZeroRegistry() public {
        vm.expectRevert(CredentialRegistryV2.ZeroRegistryAddress.selector);
        new CredentialRegistryV2(IIssuerRegistryV2(address(0)));
    }

    function testAnchorStoresSignerScopedRecordAndNextRevocationIndex() public {
        uint64 issuedAt = uint64(block.timestamp);
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, issuedAt);

        ICredentialRegistryV2.CredentialAnchor memory anchor =
            credentialRegistry.getAnchor(ORG_A, signer1, CREDENTIAL_ID);
        assertEq(anchor.organizationId, ORG_A);
        assertEq(anchor.issuerSigningAddress, signer1);
        assertEq(anchor.credentialDigest, DIGEST);
        assertEq(anchor.merkleRoot, ROOT);
        assertEq(anchor.holderCommitment, _holderCommitment(ORG_A, signer1, CREDENTIAL_ID));
        assertEq(anchor.issuedAt, issuedAt);
        assertEq(anchor.revocationIndex, 0);
        assertEq(anchor.claimCount, 2);
        assertEq(credentialRegistry.nextRevocationIndex(ORG_A), 1);
    }

    function testAnchorRejectsInvalidInputsAndUnauthorizedSigners() public {
        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroOrganizationId.selector);
        credentialRegistry.anchorCredential(bytes32(0), CREDENTIAL_ID, DIGEST, ROOT, ROOT, 1, 0, 1);

        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroCredentialId.selector);
        credentialRegistry.anchorCredential(ORG_A, bytes32(0), DIGEST, ROOT, ROOT, 1, 0, 1);

        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroCredentialDigest.selector);
        credentialRegistry.anchorCredential(ORG_A, CREDENTIAL_ID, bytes32(0), ROOT, ROOT, 1, 0, 1);

        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroHolderCommitment.selector);
        credentialRegistry.anchorCredential(ORG_A, CREDENTIAL_ID, DIGEST, bytes32(0), ROOT, 1, 0, 1);

        vm.prank(signer1);
        vm.expectRevert(CredentialRegistryV2.ZeroMerkleRoot.selector);
        credentialRegistry.anchorCredential(ORG_A, CREDENTIAL_ID, DIGEST, ROOT, bytes32(0), 1, 0, 1);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.InvalidClaimCount.selector, uint32(0))
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            1,
            0,
            0
        );

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.InvalidIssuedAt.selector,
                uint64(block.timestamp + 61),
                uint64(block.timestamp)
            )
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            uint64(block.timestamp + 61),
            0,
            1
        );

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.InvalidExpiry.selector, uint64(50), uint64(50)
            )
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            50,
            50,
            1
        );

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.UnauthorizedSigningKey.selector, ORG_A, outsider
            )
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, outsider, CREDENTIAL_ID),
            ROOT,
            uint64(block.timestamp),
            0,
            1
        );
    }

    function testAnchorRejectsSuspendedOrganization() public {
        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.OrganizationInactive.selector, ORG_A)
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            uint64(block.timestamp),
            0,
            1
        );
    }

    function testAnchorRequiresHistoricalAuthorizationAtIssuedAt() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        vm.prank(controller);
        issuerRegistry.addSigningKey(ORG_A, signer2, uint64(block.timestamp + 100));

        vm.warp(block.timestamp + 150);
        vm.prank(signer2);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.SigningKeyNotAuthorizedAtIssuedAt.selector,
                ORG_A,
                signer2,
                uint64(block.timestamp - 120)
            )
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            keccak256("credential-2"),
            DIGEST,
            _holderCommitment(ORG_A, signer2, keccak256("credential-2")),
            ROOT,
            uint64(block.timestamp - 120),
            0,
            2
        );
    }

    function testSignerScopedNamespaceAllowsSameCredentialIdAcrossDifferentSigners() public {
        uint64 issuedAt = uint64(block.timestamp);
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, issuedAt);

        vm.prank(controller);
        issuerRegistry.addSigningKey(ORG_A, signer2, issuedAt);

        _anchorAs(signer2, ORG_A, CREDENTIAL_ID, issuedAt);

        bytes32 anchorKey1 = credentialRegistry.computeAnchorKey(ORG_A, signer1, CREDENTIAL_ID);
        bytes32 anchorKey2 = credentialRegistry.computeAnchorKey(ORG_A, signer2, CREDENTIAL_ID);
        assertTrue(anchorKey1 != anchorKey2);
        assertEq(credentialRegistry.nextRevocationIndex(ORG_A), 2);
    }

    function testDuplicateAnchorForSameSignerIsRejected() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        bytes32 anchorKey = credentialRegistry.computeAnchorKey(ORG_A, signer1, CREDENTIAL_ID);
        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.AnchorAlreadyExists.selector, anchorKey)
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            uint64(block.timestamp),
            0,
            2
        );
    }

    function testControllerOrCurrentAuthorizedKeyCanRevoke() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        vm.prank(controller);
        issuerRegistry.addSigningKey(ORG_A, signer2, uint64(block.timestamp));

        vm.prank(signer2);
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, keccak256("rotation"));

        assertTrue(credentialRegistry.isRevoked(ORG_A, signer1, CREDENTIAL_ID));
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Revoked)
        );
    }

    function testControllerCanStillRevokeWhileOrganizationSuspended() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A);

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, keccak256("suspended"));

        assertTrue(credentialRegistry.isRevoked(ORG_A, signer1, CREDENTIAL_ID));
    }

    function testOtherOrganizationsCannotRevokeAndRerevokeFails() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.UnauthorizedRevoker.selector, ORG_A, outsider
            )
        );
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, bytes32(0));

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, bytes32(0));

        bytes32 anchorKey = credentialRegistry.computeAnchorKey(ORG_A, signer1, CREDENTIAL_ID);
        vm.prank(controller);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistryV2.CredentialAlreadyRevoked.selector, anchorKey
            )
        );
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, bytes32(0));
    }

    function testRevokeRejectsZeroIssuerAddressAndUnknownAnchor() public {
        vm.prank(controller);
        vm.expectRevert(CredentialRegistryV2.ZeroIssuerSigningAddress.selector);
        credentialRegistry.revokeCredential(ORG_A, address(0), CREDENTIAL_ID, bytes32(0));

        bytes32 missingAnchorKey =
            credentialRegistry.computeAnchorKey(ORG_A, signer1, CREDENTIAL_ID);
        vm.prank(controller);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.AnchorNotFound.selector, missingAnchorKey)
        );
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, bytes32(0));
    }

    function testBitmapWordsAndOrganizationScopedIndicesWork() public {
        for (uint256 i = 0; i < 257; i++) {
            bytes32 credentialId = keccak256(abi.encodePacked(i));
            _anchorAs(signer1, ORG_A, credentialId, uint64(block.timestamp));
        }

        vm.prank(controller);
        credentialRegistry.revokeCredential(
            ORG_A, signer1, keccak256(abi.encodePacked(uint256(255))), bytes32(0)
        );
        vm.prank(controller);
        credentialRegistry.revokeCredential(
            ORG_A, signer1, keccak256(abi.encodePacked(uint256(256))), bytes32(0)
        );

        uint256 word0 = credentialRegistry.revocationWord(ORG_A, 0);
        uint256 word1 = credentialRegistry.revocationWord(ORG_A, 1);
        assertTrue((word0 & (uint256(1) << 255)) != 0);
        assertTrue((word1 & 1) != 0);
    }

    function testRevocationBitmapIsScopedPerOrganization() public {
        _anchorAs(signer1, ORG_A, CREDENTIAL_ID, uint64(block.timestamp));

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, CREDENTIAL_ID, bytes32(0));

        assertEq(credentialRegistry.revocationWord(ORG_B, 0), 0);
    }

    function testStatusPrecedenceIsRevokedThenExpiredThenIssuerInactiveThenValid() public {
        uint64 nowTs = uint64(block.timestamp);

        vm.prank(signer1);
        credentialRegistry.anchorCredential(
            ORG_A,
            CREDENTIAL_ID,
            DIGEST,
            _holderCommitment(ORG_A, signer1, CREDENTIAL_ID),
            ROOT,
            nowTs,
            nowTs + 50,
            2
        );
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Valid)
        );

        vm.warp(nowTs + 60);
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Expired)
        );

        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A);
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Expired)
        );

        bytes32 secondId = keccak256("credential-issuer-inactive");
        vm.prank(admin);
        issuerRegistry.reinstateOrganization(ORG_A, signer2, uint64(block.timestamp));
        _anchorAs(signer2, ORG_A, secondId, uint64(block.timestamp));

        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A);
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer2, secondId)),
            uint8(ICredentialRegistryV2.Status.IssuerInactive)
        );

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer2, secondId, bytes32(0));
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer2, secondId)),
            uint8(ICredentialRegistryV2.Status.Revoked)
        );
    }

    function testComputeHolderCommitmentMatchesSpecification() public view {
        bytes32 expected = keccak256(abi.encode(ORG_A, signer1, CREDENTIAL_ID, holder));
        assertEq(
            credentialRegistry.computeHolderCommitment(ORG_A, signer1, CREDENTIAL_ID, holder),
            expected
        );
    }

    function testGetAnchorUnknownRevertsAndUnknownStatusIsReturned() public {
        bytes32 anchorKey = credentialRegistry.computeAnchorKey(ORG_A, signer1, CREDENTIAL_ID);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.AnchorNotFound.selector, anchorKey)
        );
        credentialRegistry.getAnchor(ORG_A, signer1, CREDENTIAL_ID);

        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Unknown)
        );
        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, address(0), CREDENTIAL_ID)),
            uint8(ICredentialRegistryV2.Status.Unknown)
        );
        assertFalse(credentialRegistry.isRevoked(ORG_A, address(0), CREDENTIAL_ID));
    }

    function testFuzz_AnchorKeyMatchesAbiEncodeAndChangesAcrossNamespace(
        bytes32 organizationId,
        bytes32 otherOrganizationId,
        bytes32 credentialId,
        bytes32 otherCredentialId,
        address issuerSigningAddress,
        address otherIssuerSigningAddress
    ) public view {
        vm.assume(organizationId != bytes32(0));
        vm.assume(otherOrganizationId != bytes32(0));
        vm.assume(credentialId != bytes32(0));
        vm.assume(otherCredentialId != bytes32(0));
        vm.assume(issuerSigningAddress != address(0));
        vm.assume(otherIssuerSigningAddress != address(0));

        bytes32 anchorKey =
            credentialRegistry.computeAnchorKey(organizationId, issuerSigningAddress, credentialId);
        assertEq(
            anchorKey, keccak256(abi.encode(organizationId, issuerSigningAddress, credentialId))
        );

        if (
            organizationId != otherOrganizationId
                || issuerSigningAddress != otherIssuerSigningAddress
                || credentialId != otherCredentialId
        ) {
            bytes32 otherAnchorKey = credentialRegistry.computeAnchorKey(
                otherOrganizationId, otherIssuerSigningAddress, otherCredentialId
            );
            assertTrue(anchorKey != otherAnchorKey);
        }
    }

    function testFuzz_HolderCommitmentMatchesAbiEncode(
        bytes32 organizationId,
        bytes32 credentialId,
        address issuerSigningAddress,
        address holderAddress
    ) public view {
        vm.assume(organizationId != bytes32(0));
        vm.assume(credentialId != bytes32(0));
        vm.assume(issuerSigningAddress != address(0));
        vm.assume(holderAddress != address(0));

        assertEq(
            credentialRegistry.computeHolderCommitment(
                organizationId, issuerSigningAddress, credentialId, holderAddress
            ),
            keccak256(abi.encode(organizationId, issuerSigningAddress, credentialId, holderAddress))
        );
    }

    function testFuzz_ClaimCountBounds(uint32 claimCount) public {
        vm.assume(claimCount == 0 || claimCount > 256);

        vm.prank(signer1);
        vm.expectRevert(
            abi.encodeWithSelector(CredentialRegistryV2.InvalidClaimCount.selector, claimCount)
        );
        credentialRegistry.anchorCredential(
            ORG_A,
            keccak256(abi.encodePacked("claim-count", claimCount)),
            DIGEST,
            _holderCommitment(
                ORG_A, signer1, keccak256(abi.encodePacked("claim-count", claimCount))
            ),
            ROOT,
            uint64(block.timestamp),
            0,
            claimCount
        );
    }

    function testFuzz_IssuedAtGracePeriodBounds(uint8 grace) public {
        bytes32 credentialId = keccak256(abi.encodePacked("grace", grace));
        uint64 issuedAt = uint64(block.timestamp) + grace;

        vm.prank(signer1);
        if (grace <= 60) {
            credentialRegistry.anchorCredential(
                ORG_A,
                credentialId,
                DIGEST,
                _holderCommitment(ORG_A, signer1, credentialId),
                ROOT,
                issuedAt,
                0,
                1
            );
            assertEq(credentialRegistry.getAnchor(ORG_A, signer1, credentialId).issuedAt, issuedAt);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    CredentialRegistryV2.InvalidIssuedAt.selector, issuedAt, uint64(block.timestamp)
                )
            );
            credentialRegistry.anchorCredential(
                ORG_A,
                credentialId,
                DIGEST,
                _holderCommitment(ORG_A, signer1, credentialId),
                ROOT,
                issuedAt,
                0,
                1
            );
        }
    }

    function testFuzz_BitmapWordAndBitPositioning(uint8 targetIndex) public {
        uint256 total = uint256(targetIndex) + 1;
        for (uint256 i = 0; i < total; i++) {
            _anchorAs(
                signer1, ORG_A, keccak256(abi.encodePacked("bitmap", i)), uint64(block.timestamp)
            );
        }

        bytes32 credentialId = keccak256(abi.encodePacked("bitmap", uint256(targetIndex)));
        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, credentialId, bytes32(0));

        ICredentialRegistryV2.CredentialAnchor memory anchor =
            credentialRegistry.getAnchor(ORG_A, signer1, credentialId);
        uint256 wordIndex = uint256(anchor.revocationIndex >> 8);
        uint256 bitIndex = uint256(anchor.revocationIndex & 255);
        uint256 mask = uint256(1) << bitIndex;

        assertTrue((credentialRegistry.revocationWord(ORG_A, wordIndex) & mask) != 0);
    }

    function testFuzz_RevokedStatusDominatesExpiryAndIssuerInactive(uint32 expiryDelta) public {
        uint64 expiresAt = uint64(block.timestamp) + uint64(bound(expiryDelta, 1, 3600));
        bytes32 credentialId = keccak256(abi.encodePacked("revoked-dominates", expiryDelta));

        _anchorCustom(
            signer1, ORG_A, credentialId, DIGEST, ROOT, uint64(block.timestamp), expiresAt, 1
        );

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, credentialId, bytes32(0));

        vm.warp(expiresAt + 1);
        vm.prank(admin);
        issuerRegistry.suspendOrganization(ORG_A);

        assertEq(
            uint8(credentialRegistry.statusOf(ORG_A, signer1, credentialId)),
            uint8(ICredentialRegistryV2.Status.Revoked)
        );
    }

    function testGas_AnchorCredential() public {
        bytes32 credentialId = keccak256("gas-anchor");

        vm.pauseGasMetering();
        vm.startPrank(signer1);
        vm.resumeGasMetering();

        credentialRegistry.anchorCredential(
            ORG_A,
            credentialId,
            DIGEST,
            _holderCommitment(ORG_A, signer1, credentialId),
            ROOT,
            uint64(block.timestamp),
            0,
            2
        );

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testGas_RevokeCredential_FirstWordBit() public {
        vm.pauseGasMetering();
        bytes32 credentialId = keccak256("gas-revoke-first");
        _anchorAs(signer1, ORG_A, credentialId, uint64(block.timestamp));

        vm.startPrank(controller);
        vm.resumeGasMetering();

        credentialRegistry.revokeCredential(ORG_A, signer1, credentialId, bytes32(0));

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testGas_RevokeCredential_SameWordBit() public {
        vm.pauseGasMetering();
        bytes32 firstId = keccak256("gas-revoke-same-1");
        bytes32 secondId = keccak256("gas-revoke-same-2");
        _anchorAs(signer1, ORG_A, firstId, uint64(block.timestamp));
        _anchorAs(signer1, ORG_A, secondId, uint64(block.timestamp));

        vm.prank(controller);
        credentialRegistry.revokeCredential(ORG_A, signer1, firstId, bytes32(0));

        vm.startPrank(controller);
        vm.resumeGasMetering();

        credentialRegistry.revokeCredential(ORG_A, signer1, secondId, bytes32(0));

        vm.pauseGasMetering();
        vm.stopPrank();
    }

    function testGas_RevokeCredential_NewWordBit() public {
        vm.pauseGasMetering();
        for (uint256 i = 0; i < 257; i++) {
            _anchorAs(
                signer1,
                ORG_A,
                keccak256(abi.encodePacked("gas-new-word", i)),
                uint64(block.timestamp)
            );
        }

        bytes32 credentialId = keccak256(abi.encodePacked("gas-new-word", uint256(256)));

        vm.startPrank(controller);
        vm.resumeGasMetering();

        credentialRegistry.revokeCredential(ORG_A, signer1, credentialId, bytes32(0));

        vm.pauseGasMetering();
        vm.stopPrank();
    }
}
