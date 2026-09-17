// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Tick} from "../src/Tick.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";

/// @notice Redeploys Tick only, keeping the existing TestUSD so nobody's test balance is
///         lost. Lists the four feeds this Pyth API key can actually read, with a strike
///         step of 1 (exact strikes — /api/strike supplies the one shared value).
///
///   TESTUSD=0x... forge script script/DeployTick.s.sol:DeployTick \
///     --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_PK --broadcast
contract DeployTick is Script {
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;

    bytes32 constant BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    bytes32 constant ETH_USD = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 constant SOL_USD = 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d;
    bytes32 constant TSLA = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;

    /// @dev Measured, not chosen: see Deploy.s.sol and app/scripts/measure-latency.ts.
    uint256 constant ACCEPT_MARGIN = 10;
    uint256 constant SETTLE_WINDOW = 10 minutes;

    uint32 constant WINDOW = 30;
    /// @dev Pyth must have published the settlement price within 20s of the close.
    uint32 constant SETTLE_TOLERANCE = 20;
    uint16 constant FEE_BPS = 200; // 2% of profit

    /// @dev Half of a market's fee goes to whoever settles it, capped at 2 tUSD. Enough
    ///      that settling is worth a bot's while on a real pool, small enough that it is
    ///      never the point of the exercise.
    uint16 constant SETTLE_BOUNTY_BPS = 5_000;
    uint256 constant MAX_SETTLE_BOUNTY = 2e6;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address token = vm.envAddress("TESTUSD");

        vm.startBroadcast(pk);
        Tick tick = new Tick(
            IERC20(token), IPyth(PYTH), deployer, ACCEPT_MARGIN, SETTLE_WINDOW, SETTLE_BOUNTY_BPS, MAX_SETTLE_BOUNTY
        );
        tick.listFeed(BTC_USD, 1, WINDOW, SETTLE_TOLERANCE, FEE_BPS);
        tick.listFeed(ETH_USD, 1, WINDOW, SETTLE_TOLERANCE, FEE_BPS);
        tick.listFeed(SOL_USD, 1, WINDOW, SETTLE_TOLERANCE, FEE_BPS);
        tick.listFeed(TSLA, 1, WINDOW, SETTLE_TOLERANCE, FEE_BPS);
        vm.stopBroadcast();

        console.log("deployer       ", deployer);
        console.log("TestUSD        ", token);
        console.log("Tick           ", address(tick));
        console.log("settleBountyBps", tick.settleBountyBps());
        console.log("maxSettleBounty", tick.maxSettleBounty());
    }
}
