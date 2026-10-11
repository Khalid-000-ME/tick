// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TickSports} from "../src/TickSports.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Deploys the attested sports market.
///
///   TOKEN=0x... ATTESTOR=0x... forge script script/DeploySports.s.sol:DeploySports \
///     --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PK --broadcast
contract DeploySports is Script {
    uint16 constant FEE_BPS = 200; // 2% of profit, as on the price markets
    uint16 constant SETTLE_BOUNTY_BPS = 5_000;
    uint256 constant MAX_SETTLE_BOUNTY = 2e6;
    /// @dev A fixture has a result within hours. Past this, anyone refunds the market, so
    ///      a silent attestor costs time rather than money.
    uint256 constant SETTLE_WINDOW = 1 days;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address token = vm.envAddress("TOKEN");
        address attestor = vm.envAddress("ATTESTOR");

        vm.startBroadcast(pk);
        TickSports sports =
            new TickSports(IERC20(token), deployer, attestor, FEE_BPS, SETTLE_BOUNTY_BPS, MAX_SETTLE_BOUNTY, SETTLE_WINDOW);
        vm.stopBroadcast();

        console.log("deployer   ", deployer);
        console.log("token      ", token);
        console.log("attestor   ", attestor);
        console.log("TickSports ", address(sports));
    }
}
