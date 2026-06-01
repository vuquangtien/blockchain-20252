// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {IIssuerRegistry} from "../src/IIssuerRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IssuerRegistryTest is Test {
    IssuerRegistry registry;
    address admin = address(0xA11CE);
    address university = address(0xBEEF);
    address otherUni = address(0xCAFE);

    event IssuerRegistered(address indexed issuer, string name, string metadataURI);
    event IssuerRevoked(address indexed issuer, string reason);

    function setUp() public {
        vm.prank(admin);
        registry = new IssuerRegistry(admin);
    }

    function test_AdminCanRegisterIssuer() public {
        vm.expectEmit(true, false, false, true);
        emit IssuerRegistered(university, "HUST", "ipfs://meta");

        vm.prank(admin);
        registry.registerIssuer(university, "HUST", "ipfs://meta");

        assertTrue(registry.isAuthorized(university));
        IIssuerRegistry.Issuer memory rec = registry.getIssuer(university);
        assertEq(rec.name, "HUST");
        assertEq(rec.metadataURI, "ipfs://meta");
        assertTrue(rec.active);
        assertEq(rec.revokedAt, 0);
    }

    function test_NonAdminCannotRegister() public {
        vm.prank(university);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, university)
        );
        registry.registerIssuer(university, "HUST", "");
    }

    function test_CannotRegisterSameIssuerTwice() public {
        vm.startPrank(admin);
        registry.registerIssuer(university, "HUST", "");
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistry.IssuerAlreadyRegistered.selector, university)
        );
        registry.registerIssuer(university, "HUST", "");
        vm.stopPrank();
    }

    function test_RevokeAndReinstate() public {
        vm.startPrank(admin);
        registry.registerIssuer(university, "HUST", "");
        registry.revokeIssuer(university, "audit failed");
        vm.stopPrank();

        assertFalse(registry.isAuthorized(university));
        IIssuerRegistry.Issuer memory rec = registry.getIssuer(university);
        assertFalse(rec.active);
        assertGt(rec.revokedAt, 0);

        vm.prank(admin);
        registry.reinstateIssuer(university);
        assertTrue(registry.isAuthorized(university));
    }

    function test_CannotRevokeUnregistered() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(IssuerRegistry.IssuerNotRegistered.selector, otherUni)
        );
        registry.revokeIssuer(otherUni, "");
    }

    function test_UpdateIssuerMetadata() public {
        vm.startPrank(admin);
        registry.registerIssuer(university, "HUST", "ipfs://old");
        registry.updateIssuer(university, "HUST renamed", "ipfs://new");
        vm.stopPrank();

        IIssuerRegistry.Issuer memory rec = registry.getIssuer(university);
        assertEq(rec.name, "HUST renamed");
        assertEq(rec.metadataURI, "ipfs://new");
    }

    function test_EnumerateIssuers() public {
        vm.startPrank(admin);
        registry.registerIssuer(university, "HUST", "");
        registry.registerIssuer(otherUni, "VNU", "");
        vm.stopPrank();

        assertEq(registry.issuerCount(), 2);
        assertEq(registry.issuerAt(0), university);
        assertEq(registry.issuerAt(1), otherUni);
    }

    function test_RejectEmptyName() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.EmptyName.selector);
        registry.registerIssuer(university, "", "");
    }
}
