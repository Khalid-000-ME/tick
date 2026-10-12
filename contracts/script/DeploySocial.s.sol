// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TickSocial} from "../src/TickSocial.sol";

/// @notice Deploys TickSocial, which holds groups and rooms. It owns no money and has no
///         admin: anyone can make a group or a room, and only the sender can be added.
///
///   forge script script/DeploySocial.s.sol:DeploySocial \
///     --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PK --broadcast
contract DeploySocial is Script {
    function run() external {
        vm.startBroadcast();
        TickSocial social = new TickSocial();
        vm.stopBroadcast();
        console.log("TickSocial", address(social));
    }
}
