// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Tick} from "../src/Tick.sol";
import {TickSports} from "../src/TickSports.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

/// @notice The question "I staked $5, what do I get back?", answered with exact numbers.
///
/// The fee is 2% of the PROFIT (the losing pool), not of the stake, and half of it goes to
/// whoever settles. So a winner always gets their stake back plus the profit, minus that
/// fee. Every expected value below was worked out by hand from the published formula, then
/// asserted exactly, and each scenario also checks that nothing is created or lost:
/// winner payout + settler bounty + protocol fee == everything staked.
contract PricePayoutsTest is Test {
    Tick tick;
    MockERC20 tkn;
    MockPyth pyth;

    address alice = address(0xA1);
    address bob = address(0xB2);
    address settler = address(0x5E77);

    bytes32 constant BTC = bytes32(uint256(0xB7C));
    int32 constant EXPO = -8;
    uint32 constant WINDOW = 30;

    function setUp() public {
        tkn = new MockERC20();
        pyth = new MockPyth();
        // 2% fee, half of it to the settler, capped at 2 USDC.
        tick = new Tick(IERC20(address(tkn)), IPyth(address(pyth)), address(this), 10, 10 minutes, 5_000, 2e6);
        vm.warp(1_000_000 * uint256(WINDOW));
        pyth.set(BTC, 90_000e8, EXPO, block.timestamp);
        tick.listFeed(BTC, 1, WINDOW, 20, 200);
        address[2] memory users = [alice, bob];
        for (uint256 i; i < users.length; ++i) {
            tkn.mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            tkn.approve(address(tick), type(uint256).max);
        }
        vm.deal(settler, 1 ether);
    }

    function _terms() internal view returns (Tick.Terms memory) {
        return Tick.Terms({feedId: BTC, strike: 90_000e8, expo: EXPO, closesAt: uint64((block.timestamp / WINDOW + 1) * WINDOW)});
    }

    function _stake(address who, Tick.Terms memory t, bool above, uint128 amount) internal {
        vm.startPrank(who);
        tick.deposit(amount);
        tick.stakeOn(t, above, amount);
        vm.stopPrank();
    }

    /// Settle with the price ending ABOVE the strike, as the settler.
    function _settleAbove(Tick.Terms memory t) internal {
        vm.warp(t.closesAt);
        bytes[] memory u = new bytes[](1);
        u[0] = pyth.encodeWithPrev(t.feedId, 90_001e8, EXPO, t.closesAt, uint256(t.closesAt) - 1);
        vm.prank(settler);
        tick.settleWithUpdate{value: 1}(t, u);
    }

    function _claim(address who, bytes32 id) internal returns (uint256 paid) {
        vm.prank(who);
        paid = tick.claim(id);
    }

    /// $5 against $5: the case in question.
    function test_fiveAgainstFive_winnerKeepsStakePlusProfitMinusTwoPercentOfProfit() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 5e6);
        _stake(bob, t, false, 5e6);
        _settleAbove(t);

        uint256 paid = _claim(alice, id);
        uint256 loser = _claim(bob, id);
        uint256 bounty = tick.deposits(settler);
        uint256 fee = tick.feesAccrued(tick.feeRecipient());

        console2.log("staked 5.00 vs 5.00 -> winner payout (USDC units):", paid);
        console2.log("                        winner profit:", paid - 5e6);
        console2.log("                        settler bounty:", bounty);
        console2.log("                        protocol fee:", fee);

        // 5.00 profit less 2% (0.10) = 4.90 profit, so 9.90 comes back on the 5.00 staked.
        // The settler's half (0.05) and the protocol's half (0.049995, the fee in whole
        // basis points rounds down by 5 millionths) add up to that 2%.
        assertEq(paid, 9_900_005, "winner gets 9.90 back on a 5.00 stake");
        assertEq(loser, 0, "the losing side gets nothing");
        assertEq(bounty, 50_000, "settler gets half the fee");
        assertEq(fee, 49_995, "protocol keeps the other half");
        assertEq(paid + bounty + fee, 10e6, "every unit staked is accounted for");
        assertGt(paid, 5e6, "a winner never gets back less than they staked");
    }

    /// Nobody to play against: the market voids and the stake comes back whole.
    function test_oneSidedMarket_refundsTheFullStake() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 5e6);
        _settleAbove(t);

        assertEq(_claim(alice, id), 5e6, "refund is exactly the stake");
        assertEq(tick.deposits(settler), 0, "no bounty on a void");
        assertEq(tick.feesAccrued(tick.feeRecipient()), 0, "no fee on a void");
    }

    /// A $5 stake against a $20 pool: the profit is the other side's money, so it is large.
    function test_fiveAgainstTwenty() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 5e6);
        _stake(bob, t, false, 20e6);
        _settleAbove(t);

        uint256 paid = _claim(alice, id);
        uint256 bounty = tick.deposits(settler);
        uint256 fee = tick.feesAccrued(tick.feeRecipient());
        assertEq(paid, 24_600_020, "5.00 stake plus 20.00 pool less 2% of the profit");
        assertEq(bounty, 200_000);
        assertEq(fee, 199_980);
        assertEq(paid + bounty + fee, 25e6);
    }

    /// The reverse: a big stake against a small pool wins a small profit, whatever the stake.
    function test_twentyAgainstFive_smallProfitOnALargeStake() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 20e6);
        _stake(bob, t, false, 5e6);
        _settleAbove(t);

        uint256 paid = _claim(alice, id);
        assertEq(paid, 24_900_005, "20.00 stake returns 24.90: profit is 4.90, the other side's 5.00 less 2%");
        assertEq(paid + tick.deposits(settler) + tick.feesAccrued(tick.feeRecipient()), 25e6);
    }

    /// Large pools hit the 2 USDC bounty cap, and the fee on winners shrinks to compensate,
    /// so the total taken never exceeds the published 2% of the profit.
    function test_bountyCapKeepsTotalTakeBelowTwoPercent() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 1_000e6);
        _stake(bob, t, false, 1_000e6);
        _settleAbove(t);

        uint256 paid = _claim(alice, id);
        uint256 bounty = tick.deposits(settler);
        uint256 fee = tick.feesAccrued(tick.feeRecipient());
        assertEq(bounty, 2e6, "bounty capped at 2 USDC");
        assertEq(paid, 1_980_036_000);
        assertEq(paid + bounty + fee, 2_000e6);
        assertLe(bounty + fee, (1_000e6 * 200) / 10_000, "total take never exceeds 2% of the profit");
    }
}

/// The same question for sports markets, settled by the attestor.
contract SportsPayoutsTest is Test {
    TickSports sports;
    TestUSD usd;
    uint256 attestorPk = 0xA11CE;
    address alice = address(0xA1);
    address bob = address(0xB2);
    address stranger = address(0xC0FFEE);
    bytes32 constant EVENT_ID = keccak256("espn:401772999");
    uint64 kickoff;

    function setUp() public {
        usd = new TestUSD();
        sports = new TickSports(IERC20(address(usd)), address(this), vm.addr(attestorPk), 200, 5_000, 2e6, 1 days);
        kickoff = uint64(block.timestamp + 1 hours);
        address[2] memory users = [alice, bob];
        for (uint256 i; i < users.length; ++i) {
            usd.seed(users[i], 1_000e6);
            vm.startPrank(users[i]);
            usd.approve(address(sports), type(uint256).max);
            sports.deposit(1_000e6);
            vm.stopPrank();
        }
    }

    function test_fiveAgainstFive_homeWins() public {
        TickSports.Terms memory t = TickSports.Terms({eventId: EVENT_ID, closesAt: kickoff});
        bytes32 id = sports.marketId(t);
        vm.prank(alice);
        sports.stakeOn(t, true, 5e6);
        vm.prank(bob);
        sports.stakeOn(t, false, 5e6);
        vm.warp(kickoff + 2 hours);

        uint8 home = sports.HOME();
        bytes32 digest = sports.attestationDigest(t, home);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)));
        vm.prank(stranger);
        sports.settleAttested(t, home, abi.encodePacked(r, s, v));

        vm.prank(alice);
        uint256 paid = sports.claim(id);
        vm.prank(bob);
        uint256 loser = sports.claim(id);
        uint256 bounty = sports.deposits(stranger);
        uint256 fee;
        for (uint256 i; i < sports.SHARDS(); ++i) fee += sports.feesShard(sports.feeRecipient(), i);
        console2.log("sports 5.00 vs 5.00 -> winner payout (USDC units):", paid);

        assertEq(paid, 9_900_005, "same arithmetic as the price markets");
        assertEq(loser, 0);
        assertEq(paid + bounty + fee, 10e6, "every unit staked is accounted for");
    }
}
