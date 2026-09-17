// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Tick} from "../src/Tick.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";

/// @notice Deploys Tick to Monad testnet (chain 10143) against the live Pyth deployment.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $MONAD_RPC --private-key $DEPLOYER_PK --broadcast
///
/// @dev Every feed id and exponent below was verified against the live Pyth contract on
///      Monad testnet with priceFeedExists + getPriceUnsafe before being written here. A
///      guessed NVDA id did not exist and was removed rather than shipped.
contract Deploy is Script {
    /// @dev Pyth on Monad testnet, per docs.monad.xyz and confirmed to hold code.
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;

    // ---- Crypto feeds: 24/7, so a demo works at any hour. Exponent -8.
    bytes32 constant BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    bytes32 constant ETH_USD = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 constant SOL_USD = 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d;

    // ---- US equity feeds. Exponent -5. These only move while the US market is open
    //      (14:30-21:00 UTC on weekdays), so outside those hours the cutoff correctly
    //      refuses every stake. That is the mechanism working, not a bug.
    bytes32 constant AAPL = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
    bytes32 constant TSLA = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
    bytes32 constant MSFT = 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1;

    /// @dev THE residual latency-arbitrage window, derived from measurement rather than
    ///      preference. On Monad testnet over a public RPC (app/scripts/measure-latency.ts):
    ///      the on-chain price is 2-6s old one block after a refresh, and submit->receipt
    ///      is p95 2.2s, so 6 + 3 + 1 = 10s. A first attempt at 2s was below the chain's
    ///      own inclusion latency and every second stake reverted.
    uint256 constant ACCEPT_MARGIN = 10;

    /// @dev No settlement price within this long after close: anyone may void and refund.
    uint256 constant SETTLE_WINDOW = 10 minutes;

    uint32 constant WINDOW = 30; // 30-second markets
    uint32 constant SETTLE_TOLERANCE = 5; // settlement price must land within 5s of close
    uint16 constant FEE_BPS = 200; // 2% of profit

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        TestUSD usd = new TestUSD();
        Tick tick = new Tick(IERC20(address(usd)), IPyth(PYTH), deployer, ACCEPT_MARGIN, SETTLE_WINDOW, 5_000, 2e6);

        // Strike grids are per feed because the exponent differs: at -8 one dollar is
        // 1e8, at -5 it is 1e5. Steps are chosen to be a sensible fraction of each
        // asset's price so neighbouring strikes stay liquid rather than fragmenting.
        tick.listFeed(BTC_USD, 100e8, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $100 steps
        tick.listFeed(ETH_USD, 10e8, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $10 steps
        tick.listFeed(SOL_USD, 1e8, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $1 steps
        tick.listFeed(AAPL, 1e5, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $1 steps
        tick.listFeed(TSLA, 1e5, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $1 steps
        tick.listFeed(MSFT, 1e5, WINDOW, SETTLE_TOLERANCE, FEE_BPS); // $1 steps

        // Seed the deployer so the operator can fund demo participants.
        usd.seed(deployer, 1_000_000e6);
        usd.approve(address(tick), type(uint256).max);

        vm.stopBroadcast();

        console.log("chainId        ", block.chainid);
        console.log("deployer       ", deployer);
        console.log("TestUSD        ", address(usd));
        console.log("Tick           ", address(tick));
        console.log("Pyth           ", PYTH);
        console.log("SHARDS         ", tick.SHARDS());
        console.log("acceptMargin(s)", tick.acceptMargin());
        console.log("settleWindow(s)", tick.settleWindow());
    }
}
