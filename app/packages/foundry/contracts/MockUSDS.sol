// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local stand-in for USDS (18 decimals). Only deployed on the local chain.
///         Anyone can mint — it is play money for the demo.
contract MockUSDS is ERC20 {
    constructor() ERC20("USDS Stablecoin (mock)", "USDS") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
