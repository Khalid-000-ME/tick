// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Tick} from "../src/Tick.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

/// @notice The settler bounty and settleWithUpdate.
///
/// What matters here is not that a bounty gets paid — it is that paying it can never make
/// the contract insolvent and never charges winners more than the published fee. Both are
/// asserted directly, including under fuzzing.
contract BountyTest is Test {
    Tick tick;
    MockERC20 tkn;
    MockPyth pyth;

    address alice = address(0xA1);
    address bob = address(0xB2);
    address carol = address(0xC3);
    address settler = address(0x5E77);

    bytes32 constant BTC = bytes32(uint256(0xB7C));
    int32 constant EXPO = -8;
    uint32 constant WINDOW = 30;
    uint32 constant TOL = 20;
    uint16 constant FEE_BPS = 200;
    uint16 constant SHARE_BPS = 5_000;
    uint256 constant MAX_BOUNTY = 2e6;

    function setUp() public {
        tkn = new MockERC20();
        pyth = new MockPyth();
        tick = new Tick(
            IERC20(address(tkn)), IPyth(address(pyth)), address(this), 10, 10 minutes, SHARE_BPS, MAX_BOUNTY
        );
        vm.warp(1_000_000 * uint256(WINDOW));
        pyth.set(BTC, 90_000e8, EXPO, block.timestamp);
        tick.listFeed(BTC, 1, WINDOW, TOL, FEE_BPS);

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; ++i) {
            tkn.mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            tkn.approve(address(tick), type(uint256).max);
        }
        vm.deal(settler, 1 ether);
    }

    function _terms() internal view returns (Tick.Terms memory) {
        return Tick.Terms({
            feedId: BTC,
            strike: 90_000e8,
            expo: EXPO,
            closesAt: uint64((block.timestamp / WINDOW + 1) * WINDOW)
        });
    }

    function _stake(address who, Tick.Terms memory t, bool above, uint128 amount) internal {
        vm.startPrank(who);
        tick.deposit(amount);
        tick.stakeOn(t, above, amount);
        vm.stopPrank();
    }

    function _update(Tick.Terms memory t, int64 price, uint256 at) internal view returns (bytes[] memory u) {
        u = new bytes[](1);
        // The first update at or after the close, published at `at`.
        u[0] = pyth.encodeWithPrev(t.feedId, price, EXPO, at, uint256(t.closesAt) - 1);
    }

    function _settleViaStored(Tick.Terms memory t, int64 price) internal {
        vm.warp(t.closesAt);
        bytes[] memory u = _update(t, price, t.closesAt);
        vm.prank(settler);
        tick.settleWithUpdate{value: 1}(t, u);
    }

    // ---------------------------------------------------------------- bounty

    function test_settlerIsPaidFromTheFee() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);

        _settleViaStored(t, 90_001e8);

        // fee pot = 2% of the 100 losing = 2; settler's share = half = 1.
        assertEq(tick.deposits(settler), 1e6, "settler credited half the fee pot");
    }

    function test_winnersNeverPayMoreThanThePublishedFee() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);
        _settleViaStored(t, 90_001e8);

        // Gross profit is the whole 100 losing. Published fee is 2% of it = 2.
        // Winner payout + fee recipient + settler must equal the 200 staked, within dust.
        vm.prank(alice);
        uint256 payout = tick.claim(id);
        uint256 recipient = tick.feesAccrued(address(this));
        uint256 bounty = tick.deposits(settler);

        assertGe(payout, 100e6 + 98e6, "winner keeps at least profit minus the 2% fee");
        assertLe(payout + recipient + bounty, 200e6, "never pays out more than was staked");
        assertGe(payout + recipient + bounty, 200e6 - 1e3, "and distributes essentially all of it");
        assertLe(recipient + bounty, 2e6, "fee recipient + settler never exceed the published 2%");
    }

    function test_bountyIsCappedAtTheMaximum() public {
        Tick.Terms memory t = _terms();
        // 2% of a 1,000 losing pool is 20; half is 10, capped to 2.
        _stake(alice, t, true, 1_000e6);
        _stake(bob, t, false, 1_000e6);
        _settleViaStored(t, 90_001e8);
        assertEq(tick.deposits(settler), MAX_BOUNTY);
    }

    function test_voidPaysNoBounty() public {
        Tick.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        _stake(alice, t, true, 100e6); // nobody on the other side
        _settleViaStored(t, 90_001e8);

        assertEq(tick.deposits(settler), 0, "a refund market has no fee to share");
        vm.prank(alice);
        assertEq(tick.claim(id), 100e6, "and the staker is refunded in full");
    }

    function test_tooSmallToPayFailsSafe() public {
        Tick.Terms memory t = _terms();
        // 2% of 40 base units is under one unit, so the pot floors to zero.
        _stake(alice, t, true, 40);
        _stake(bob, t, false, 40);
        _settleViaStored(t, 90_001e8);
        assertEq(tick.deposits(settler), 0, "no bounty when the fee cannot cover one");
    }

    function test_shareAboveHalfIsRejectedAtDeploy() public {
        vm.expectRevert(Tick.BountyShareTooHigh.selector);
        new Tick(IERC20(address(tkn)), IPyth(address(pyth)), address(this), 10, 10 minutes, 5_001, MAX_BOUNTY);
    }

    function testFuzz_bountyNeverBreaksSolvency(uint96 a, uint96 b, uint96 c, uint16 share, uint96 cap) public {
        a = uint96(bound(a, 1, 1_000e6));
        b = uint96(bound(b, 1, 1_000e6));
        c = uint96(bound(c, 1, 1_000e6));
        share = uint16(bound(share, 0, 5_000));
        cap = uint96(bound(cap, 0, 100e6));

        Tick t2 = new Tick(IERC20(address(tkn)), IPyth(address(pyth)), address(this), 10, 10 minutes, share, cap);
        t2.listFeed(BTC, 1, WINDOW, TOL, FEE_BPS);
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; ++i) {
            vm.prank(users[i]);
            tkn.approve(address(t2), type(uint256).max);
        }
        Tick.Terms memory t = _terms();
        bytes32 id = t2.marketId(t);

        vm.startPrank(alice);
        t2.deposit(a);
        t2.stakeOn(t, true, a);
        vm.stopPrank();
        vm.startPrank(bob);
        t2.deposit(b);
        t2.stakeOn(t, true, b);
        vm.stopPrank();
        vm.startPrank(carol);
        t2.deposit(c);
        t2.stakeOn(t, false, c);
        vm.stopPrank();

        vm.warp(t.closesAt);
        bytes[] memory u2 = _update(t, 90_001e8, t.closesAt);
        vm.prank(settler);
        t2.settleWithUpdate{value: 1}(t, u2);

        uint256 paid;
        vm.prank(alice);
        paid += t2.claim(id);
        vm.prank(bob);
        paid += t2.claim(id);
        vm.prank(carol);
        paid += t2.claim(id);

        uint256 bountyPaid = t2.deposits(settler);
        uint256 staked = uint256(a) + b + c;
        assertLe(paid + t2.feesAccrued(address(this)) + bountyPaid, staked, "payouts + fees + bounty <= staked");

        // And the bounty plus the recipient's cut never exceeds the published fee on the
        // losing pool, so a winner is never charged more than the fee they were shown.
        uint256 lose = c; // ABOVE won, so BELOW lost
        assertLe(t2.feesAccrued(address(this)) + bountyPaid, (lose * FEE_BPS) / 10_000 + 1);
    }

    // ---------------------------------------------------------------- settleWithUpdate

    function test_settleWithUpdate_usesTheSuppliedPriceAndPaysTheBounty() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);

        vm.warp(t.closesAt);
        // The stored price is old and says BELOW; the supplied close price says ABOVE.
        pyth.set(BTC, 89_000e8, EXPO, t.closesAt - 100);
        bytes[] memory u = _update(t, 90_500e8, t.closesAt);

        vm.prank(settler);
        uint8 outcome = tick.settleWithUpdate{value: 1}(t, u);

        assertEq(outcome, tick.ABOVE(), "outcome comes from the supplied close price");
        assertEq(tick.deposits(settler), 1e6);
    }

    function test_settleWithUpdate_worksLongAfterTheWindow() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);

        // Five minutes late. settle() would revert NoSettlementPrice here.
        vm.warp(t.closesAt + 5 minutes);
        bytes[] memory u = _update(t, 90_500e8, t.closesAt + 3);

        vm.prank(settler);
        assertEq(tick.settleWithUpdate{value: 1}(t, u), tick.ABOVE());
    }

    function test_settleWithUpdate_rejectsAPriceOutsideTheWindow() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);
        vm.warp(t.closesAt + 60);

        // One second BEFORE close, and one past the tolerance. A settler picks neither.
        bytes[] memory early = _update(t, 90_500e8, t.closesAt - 1);
        vm.prank(settler);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        tick.settleWithUpdate{value: 1}(t, early);

        bytes[] memory late = _update(t, 90_500e8, t.closesAt + TOL + 1);
        vm.prank(settler);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        tick.settleWithUpdate{value: 1}(t, late);
    }

    function test_settleWithUpdate_refundsExcessAndRejectsShortFee() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);
        vm.warp(t.closesAt);
        bytes[] memory u = _update(t, 90_500e8, t.closesAt);

        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(Tick.InsufficientUpdateFee.selector, 0, 1));
        tick.settleWithUpdate{value: 0}(t, u);

        uint256 before = settler.balance;
        vm.prank(settler);
        tick.settleWithUpdate{value: 0.5 ether}(t, u);
        assertEq(before - settler.balance, 1, "only Pyth's 1 wei fee is kept; the rest comes back");
    }

    function test_settleWithUpdate_cannotSettleTwiceOrEarly() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);

        bytes[] memory u = _update(t, 90_500e8, t.closesAt);
        vm.prank(settler);
        vm.expectRevert(Tick.NotClosed.selector);
        tick.settleWithUpdate{value: 1}(t, u);

        vm.warp(t.closesAt);
        vm.prank(settler);
        tick.settleWithUpdate{value: 1}(t, u);
        vm.prank(settler);
        vm.expectRevert(Tick.AlreadySettled.selector);
        tick.settleWithUpdate{value: 1}(t, u);
    }

    function test_settleWithUpdate_writesNothingToPyth() public {
        Tick.Terms memory t = _terms();
        _stake(alice, t, true, 100e6);
        _stake(bob, t, false, 100e6);
        vm.warp(t.closesAt);
        uint256 before = pyth.updateCount();
        bytes[] memory u = _update(t, 90_500e8, t.closesAt);
        vm.prank(settler);
        tick.settleWithUpdate{value: 1}(t, u);
        assertEq(pyth.updateCount(), before, "settling by update never touches Pyth's shared slot");
    }
}
