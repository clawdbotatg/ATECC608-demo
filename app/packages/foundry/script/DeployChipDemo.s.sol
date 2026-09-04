// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DeployHelpers.s.sol";
import { MockUSDS } from "../contracts/MockUSDS.sol";
import { ChipAccount } from "../contracts/ChipAccount.sol";

/**
 * @notice Deploys the demo: a mock USDS on local chains and the ChipAccount vault.
 *
 * Env (packages/foundry/.env, all optional):
 *   CHIP_PUBKEY_X / CHIP_PUBKEY_Y  bytes32 hex of the chip's P-256 public key. Leave unset to deploy
 *                                  unpaired — the Pi announces its key to the app, which calls setSigner.
 *   CHIP_ADMIN                     address allowed to call setSigner. Defaults to the deployer.
 *   USDS_ADDRESS                   existing token to use (live chains). Unset on localhost → MockUSDS.
 *
 * yarn deploy                       # localhost
 * yarn deploy --network sepolia     # live (needs a keystore, see yarn generate)
 */
contract DeployChipDemo is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        bytes32 qx = vm.envOr("CHIP_PUBKEY_X", bytes32(0));
        bytes32 qy = vm.envOr("CHIP_PUBKEY_Y", bytes32(0));
        address admin = vm.envOr("CHIP_ADMIN", deployer);
        address usds = vm.envOr("USDS_ADDRESS", address(0));

        ChipAccount account = new ChipAccount(admin, qx, qy);
        deployments.push(Deployment("ChipAccount", address(account)));

        if (usds == address(0)) {
            require(block.chainid == 31337, "Set USDS_ADDRESS for live chains");
            MockUSDS mock = new MockUSDS();
            deployments.push(Deployment("MockUSDS", address(mock)));
            mock.mint(address(account), 1_000 ether); // 1,000 USDS of play money in the vault
            mock.mint(deployer, 1_000 ether);
            usds = address(mock);
        }

        console.log("ChipAccount:", address(account));
        console.log("USDS:       ", usds);
        console.log("Admin:      ", admin);
        if (qx == 0 && qy == 0) console.log("Signer:      (unpaired - the Pi will pair itself)");
    }
}
