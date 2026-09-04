//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { DeployChipDemo } from "./DeployChipDemo.s.sol";

/**
 * @notice Main deployment script for all contracts
 * Example: yarn deploy # runs this script (without `--file` flag)
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployChipDemo demo = new DeployChipDemo();
        demo.run();
    }
}
