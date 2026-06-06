// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IssuerRegistryV2} from "../src/IssuerRegistryV2.sol";
import {CredentialRegistryV2} from "../src/CredentialRegistryV2.sol";

contract DeployV2 is Script {
    error IncompleteInitialOrganizationConfig();

    function run()
        external
        returns (IssuerRegistryV2 issuerRegistry, CredentialRegistryV2 credentialRegistry)
    {
        address admin = vm.envOr("V2_ADMIN_ADDRESS", msg.sender);
        bool hasAnyInitialOrgEnv = _hasAnyInitialOrganizationEnv();
        bool hasAllInitialOrgEnv = _hasAllInitialOrganizationEnv();

        if (hasAnyInitialOrgEnv && !hasAllInitialOrgEnv) {
            revert IncompleteInitialOrganizationConfig();
        }

        vm.startBroadcast();
        issuerRegistry = new IssuerRegistryV2(admin);
        credentialRegistry = new CredentialRegistryV2(issuerRegistry);

        if (hasAllInitialOrgEnv) {
            issuerRegistry.registerOrganization(
                vm.envBytes32("V2_INITIAL_ORGANIZATION_ID"),
                vm.envAddress("V2_INITIAL_CONTROLLER_ADDRESS"),
                vm.envString("V2_INITIAL_ORGANIZATION_NAME"),
                vm.envString("V2_INITIAL_METADATA_URI"),
                vm.envAddress("V2_INITIAL_SIGNING_KEY"),
                uint64(vm.envUint("V2_INITIAL_VALID_FROM"))
            );
        }

        vm.stopBroadcast();

        console2.log("IssuerRegistryV2 deployed at:", address(issuerRegistry));
        console2.log("CredentialRegistryV2 deployed at:", address(credentialRegistry));
        console2.log("V2 admin:", admin);
        console2.log("Initial organization registered:", hasAllInitialOrgEnv);
    }

    function _hasAnyInitialOrganizationEnv() internal view returns (bool) {
        return vm.envExists("V2_INITIAL_ORGANIZATION_ID")
            || vm.envExists("V2_INITIAL_CONTROLLER_ADDRESS")
            || vm.envExists("V2_INITIAL_ORGANIZATION_NAME")
            || vm.envExists("V2_INITIAL_METADATA_URI") || vm.envExists("V2_INITIAL_SIGNING_KEY")
            || vm.envExists("V2_INITIAL_VALID_FROM");
    }

    function _hasAllInitialOrganizationEnv() internal view returns (bool) {
        return vm.envExists("V2_INITIAL_ORGANIZATION_ID")
            && vm.envExists("V2_INITIAL_CONTROLLER_ADDRESS")
            && vm.envExists("V2_INITIAL_ORGANIZATION_NAME")
            && vm.envExists("V2_INITIAL_METADATA_URI") && vm.envExists("V2_INITIAL_SIGNING_KEY")
            && vm.envExists("V2_INITIAL_VALID_FROM");
    }
}
