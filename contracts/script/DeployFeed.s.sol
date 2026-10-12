// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TickFeed} from "../src/TickFeed.sol";

/// @notice Deploys TickFeed. It holds no money and has no admin: anyone posts as themselves.
///
///   forge script script/DeployFeed.s.sol:DeployFeed \
///     --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PK --broadcast
contract DeployFeed is Script {
    function run() external {
        vm.startBroadcast();
        TickFeed feed = new TickFeed();
        vm.stopBroadcast();
        console.log("TickFeed", address(feed));
    }
}
