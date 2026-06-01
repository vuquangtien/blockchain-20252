// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {CredentialRegistry} from "../src/CredentialRegistry.sol";

/// @notice Deployment script for the academic credential system.
///         Usage:
///           forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast \
///                --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run()
        external
        returns (IssuerRegistry issuerRegistry, CredentialRegistry credentialRegistry)
    {
        address admin = vm.envOr("ADMIN_ADDRESS", msg.sender);

        vm.startBroadcast();
        issuerRegistry = new IssuerRegistry(admin);
        credentialRegistry = new CredentialRegistry(issuerRegistry);
        vm.stopBroadcast();

        console2.log("IssuerRegistry deployed at:", address(issuerRegistry));
        console2.log("CredentialRegistry deployed at:", address(credentialRegistry));
        console2.log("Admin:", admin);
    }
}
