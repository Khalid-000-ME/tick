// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Tick} from "../src/Tick.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

contract TickTest is Test {
    Tick tick;
    MockERC20 tkn;
    MockPyth pyth;

    address alice = address(0xA1);
    address bob = address(0xB2);
    address carol = address(0xC3);

    bytes32 constant BTC = bytes32(uint256(0xB7C));
    int32 constant EXPO = -8;
    int64 constant STRIKE_STEP = 1e8; // $1 at expo -8
    uint32 constant WINDOW = 30;
    uint32 constant SETTLE_TOLERANCE = 5;
    uint16 constant FEE_BPS = 200;

    uint256 constant ACCEPT_MARGIN = 2;
    uint256 constant SETTLE_WINDOW = 10 minutes;

    function setUp() public {
        tkn = new MockERC20();
        pyth = new MockPyth();
        tick = new Tick(IERC20(address(tkn)), IPyth(address(pyth)), address(this), ACCEPT_MARGIN, SETTLE_WINDOW, 0, 0);

        // Start on a clean multiple of the window grid.
        vm.warp(1_000_000 * uint256(WINDOW));

        pyth.set(BTC, 90_000e8, EXPO, block.timestamp);
        tick.listFeed(BTC, STRIKE_STEP, WINDOW, SETTLE_TOLERANCE, FEE_BPS);

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; ++i) {
            tkn.mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            tkn.approve(address(tick), type(uint256).max);
        }
    }

    // ------------------------------------------------------------- helpers

    function _terms(int64 strike, uint64 closesAt) internal pure returns (Tick.Terms memory) {
        return Tick.Terms({feedId: BTC, strike: strike, expo: EXPO, closesAt: closesAt});
    }

    /// @dev Next window boundary strictly in the future.
    function _nextClose() internal view returns (uint64) {
        return uint64((block.timestamp / WINDOW + 1) * WINDOW);
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(who);
        tick.deposit(amount);
    }

    function _stake(address who, Tick.Terms memory t, bool above, uint128 amount) internal {
        vm.prank(who);
        tick.stakeOn(t, above, amount);
    }

    /// @dev Refreshes the feed at close and settles, the way a keeper would.
    function _settleAt(Tick.Terms memory t, int64 price) internal returns (uint8) {
        vm.warp(t.closesAt);
        return tick.settleWithUpdate{value: 1}(t, _first(t, price, t.closesAt));
    }

    /// @dev A signed update that is the FIRST one at or after the close, published at `at`.
    function _first(Tick.Terms memory t, int64 price, uint256 at) internal view returns (bytes[] memory u) {
        u = new bytes[](1);
        u[0] = pyth.encodeWithPrev(t.feedId, price, EXPO, at, uint256(t.closesAt) - 1);
    }

    function _twoSided() internal returns (Tick.Terms memory t, bytes32 id) {
        t = _terms(90_000e8, _nextClose());
        id = tick.marketId(t);
        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
        _stake(alice, t, true, 40e6);
        _stake(bob, t, false, 60e6);
    }

    // ------------------------------------------------------------- identity

    function test_marketIdIsTheHashOfItsTerms() public view {
        Tick.Terms memory t = _terms(90_000e8, 30_000_000);
        assertEq(tick.marketId(t), keccak256(abi.encode(BTC, int64(90_000e8), EXPO, uint64(30_000_000))));
        assertTrue(tick.marketId(t) != tick.marketId(_terms(90_001e8, 30_000_000)), "different strike, different market");
    }

    /// @notice Nothing is created, so the first staker writes no shared market slot.
    ///         The opening-block dependency that the signed-definition design had does
    ///         not exist here, rather than being worked around.
    function test_stakingNeedsNoCreationStep() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        _fund(alice, 100e6);
        _stake(alice, t, true, 10e6);
        (uint256 above, uint256 below) = tick.pools(tick.marketId(t));
        assertEq(above, 10e6);
        assertEq(below, 0);
    }

    // ------------------------------------------------------------- the grid

    /// @notice The grid stops a permissionless market space fragmenting into one-sided
    ///         pools that all void. Parimutuel needs both sides of the SAME pool.
    function test_grid_offGridStrikeReverts() public {
        Tick.Terms memory t = _terms(90_000e8 + 1, _nextClose());
        _fund(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Tick.OffStrikeGrid.selector, t.strike, STRIKE_STEP));
        tick.stakeOn(t, true, 10e6);
    }

    function test_grid_offGridCloseReverts() public {
        uint64 badClose = _nextClose() + 1;
        Tick.Terms memory t = _terms(90_000e8, badClose);
        _fund(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Tick.OffWindowGrid.selector, badClose, WINDOW));
        tick.stakeOn(t, true, 10e6);
    }

    function test_unlistedFeedCannotBeStakedOn() public {
        Tick.Terms memory t =
            Tick.Terms({feedId: bytes32(uint256(0xDEAD)), strike: 1e8, expo: EXPO, closesAt: _nextClose()});
        _fund(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Tick.FeedNotListed.selector, t.feedId));
        tick.stakeOn(t, true, 10e6);
    }

    function test_listFeed_isAdminOnly() public {
        vm.prank(alice);
        vm.expectRevert(Tick.NotAdmin.selector);
        tick.listFeed(BTC, STRIKE_STEP, WINDOW, SETTLE_TOLERANCE, FEE_BPS);
    }

    // ------------------------------------------------------------- THE CUTOFF

    /// @notice THE THESIS. A stake is accepted only while the chain's price is fresh.
    ///         When it goes stale, staking shuts by itself: nobody decides to close it,
    ///         and no operator can keep it open past the point where the price it trades
    ///         against stopped being current.
    function test_cutoff_staleOnChainPriceBlocksStaking() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        _fund(alice, 1_000e6);

        uint256 published = block.timestamp;

        // Exactly at the margin: still accepted.
        vm.warp(published + ACCEPT_MARGIN);
        _stake(alice, t, true, 10e6);

        // One second past: refused. Anyone staking now may already know where it moved.
        vm.warp(published + ACCEPT_MARGIN + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Tick.PriceTooStale.selector, published, ACCEPT_MARGIN));
        tick.stakeOn(t, true, 10e6);

        // Refresh the feed and staking reopens.
        pyth.set(BTC, 90_100e8, EXPO, block.timestamp);
        _stake(alice, t, true, 10e6);
    }

    function test_cutoff_statusViewAgreesWithStaking() public {
        (bool ok,,,) = tick.cutoffStatus(BTC);
        assertTrue(ok, "fresh price: open");

        vm.warp(block.timestamp + ACCEPT_MARGIN + 1);
        (bool ok2, uint256 age, uint256 margin,) = tick.cutoffStatus(BTC);
        assertFalse(ok2, "stale price: shut");
        assertEq(age, ACCEPT_MARGIN + 1);
        assertEq(margin, ACCEPT_MARGIN);

        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        _fund(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert();
        tick.stakeOn(t, true, 10e6);
    }

    /// @notice A changed exponent would silently redenominate the strike.
    function test_cutoff_expoMismatchReverts() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        _fund(alice, 100e6);
        pyth.set(BTC, 90_000e8, -6, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Tick.ExpoMismatch.selector, EXPO, int32(-6)));
        tick.stakeOn(t, true, 10e6);
    }

    function test_stakeAtOrAfterCloseReverts() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        _fund(alice, 100e6);

        vm.warp(t.closesAt);
        pyth.set(BTC, 90_000e8, EXPO, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(Tick.NotOpen.selector);
        tick.stakeOn(t, true, 10e6);
    }

    function test_stakeWithoutDepositReverts() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        vm.prank(alice);
        vm.expectRevert(Tick.InsufficientDeposit.selector);
        tick.stakeOn(t, true, 10e6);
    }

    // ------------------------------------------------------------- settlement

    /// @notice Settlement is a comparison anyone can recompute from public data. There is
    ///         no reporter, no bond and no dispute window, because there is no judgement.
    function test_settle_isPermissionlessAndMechanical() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();

        vm.warp(t.closesAt);
        bytes[] memory u = _first(t, 90_001e8, t.closesAt);

        // carol has no role and no permission, only a wei for Pyth's fee. She settles anyway.
        vm.deal(carol, 1);
        vm.prank(carol);
        assertEq(tick.settleWithUpdate{value: 1}(t, u), tick.ABOVE());

        (uint8 stored,, int64 price,,,) = tick.settlements(id);
        assertEq(stored, tick.ABOVE());
        assertEq(price, 90_001e8);
    }

    function test_settle_atStrikeExactlyIsAbove() public {
        (Tick.Terms memory t,) = _twoSided();
        assertEq(_settleAt(t, 90_000e8), tick.ABOVE(), "at-or-above is inclusive");
    }

    function test_settle_belowStrike() public {
        (Tick.Terms memory t,) = _twoSided();
        assertEq(_settleAt(t, 89_999e8), tick.BELOW());
    }

    function test_settle_beforeCloseReverts() public {
        (Tick.Terms memory t,) = _twoSided();
        bytes[] memory u = _first(t, 90_001e8, t.closesAt);
        vm.expectRevert(Tick.NotClosed.selector);
        tick.settleWithUpdate{value: 1}(t, u);
    }

    function test_settle_doubleSettleReverts() public {
        (Tick.Terms memory t,) = _twoSided();
        _settleAt(t, 90_001e8);
        bytes[] memory u = _first(t, 90_001e8, t.closesAt);
        vm.expectRevert(Tick.AlreadySettled.selector);
        tick.settleWithUpdate{value: 1}(t, u);
    }

    /// @notice Settlement is pinned to the close: a price from before it cannot settle the
    ///         market, and neither can one published after the tolerance.
    function test_settle_requiresPricePublishedJustAfterClose() public {
        (Tick.Terms memory t,) = _twoSided();
        vm.warp(uint256(t.closesAt) + SETTLE_TOLERANCE + 5);

        bytes[] memory early = _first(t, 90_001e8, uint256(t.closesAt) - 1);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        tick.settleWithUpdate{value: 1}(t, early);

        bytes[] memory late = _first(t, 90_001e8, uint256(t.closesAt) + SETTLE_TOLERANCE + 1);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        tick.settleWithUpdate{value: 1}(t, late);
    }

    /// @notice THE trust property. Pyth publishes many signed prices inside the settle
    ///         window. If any of them were acceptable, whoever settles could pick the one
    ///         that favours the side they staked. Only the first price at or after the
    ///         close is valid, so there is nothing to choose.
    function test_settle_rejectsACherryPickedLaterPrice() public {
        (Tick.Terms memory t,) = _twoSided();
        vm.warp(uint256(t.closesAt) + 8);

        // A real later tick (published close+5), whose predecessor (close+4) is itself
        // after the close, so it is NOT the first. Favourable to ABOVE, but unusable.
        bytes[] memory later = new bytes[](1);
        later[0] = pyth.encodeWithPrev(t.feedId, 95_000e8, EXPO, uint256(t.closesAt) + 5, uint256(t.closesAt) + 4);
        vm.expectRevert(MockPyth.PriceFeedNotFoundWithinRange.selector);
        tick.settleWithUpdate{value: 1}(t, later);

        // The first price (published close+1, predecessor before the close) is accepted,
        // and it is the one that decides the market, here BELOW.
        bytes[] memory first = new bytes[](1);
        first[0] = pyth.encodeWithPrev(t.feedId, 89_000e8, EXPO, uint256(t.closesAt) + 1, uint256(t.closesAt) - 1);
        assertEq(tick.settleWithUpdate{value: 1}(t, first), tick.BELOW());
    }

    function test_voidStale_refundsEveryone() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();

        vm.warp(uint256(t.closesAt) + SETTLE_WINDOW);
        tick.voidStale(t);

        (uint8 outcome,,,,,) = tick.settlements(id);
        assertEq(outcome, tick.VOID());

        vm.prank(alice);
        assertEq(tick.claim(id), 40e6, "alice refunded in full");
        vm.prank(bob);
        assertEq(tick.claim(id), 60e6, "bob refunded in full");
    }

    function test_voidStale_beforeWindowReverts() public {
        (Tick.Terms memory t,) = _twoSided();
        vm.warp(uint256(t.closesAt) + 1);
        vm.expectRevert(Tick.SettleWindowOpen.selector);
        tick.voidStale(t);
    }

    function test_oneSidedPoolVoids() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);
        _fund(alice, 100e6);
        _stake(alice, t, true, 10e6);

        assertEq(_settleAt(t, 90_001e8), tick.VOID(), "no counterparty: void");
        vm.prank(alice);
        assertEq(tick.claim(id), 10e6);
    }

    // ------------------------------------------------------------- payouts

    function test_proRataPayoutMath() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);
        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
        _stake(alice, t, true, 40e6);
        _stake(bob, t, false, 60e6);

        _settleAt(t, 90_001e8); // ABOVE wins

        // alice is the whole winning side: profit 60, fee 2% of 60 = 1.2.
        vm.prank(alice);
        assertEq(tick.claim(id), 40e6 + 60e6 - 1.2e6, "40 stake + 60 profit - 1.2 fee");

        vm.prank(bob);
        assertEq(tick.claim(id), 0, "losing side gets nothing");

        assertEq(tick.feesAccrued(address(this)), 1.2e6, "fee accrued to the recipient");
    }

    /// @notice The fee is captured at settlement, so an admin cannot raise it afterwards
    ///         and take more from people who have already won.
    function test_feeIsFixedAtSettlementNotAtClaim() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();
        _settleAt(t, 90_001e8);

        tick.listFeed(BTC, STRIKE_STEP, WINDOW, SETTLE_TOLERANCE, 500);

        vm.prank(alice);
        assertEq(tick.claim(id), 40e6 + 60e6 - 1.2e6, "settled market keeps its settled fee");
    }

    function test_doubleClaimReverts() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();
        _settleAt(t, 90_001e8);
        vm.prank(alice);
        tick.claim(id);
        vm.prank(alice);
        vm.expectRevert(Tick.NothingStaked.selector);
        tick.claim(id);
    }

    function test_claimBeforeSettleReverts() public {
        (, bytes32 id) = _twoSided();
        vm.prank(alice);
        vm.expectRevert(Tick.NotSettled.selector);
        tick.claim(id);
    }

    function test_previewMatchesClaim() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();
        _settleAt(t, 90_001e8);
        uint256 preview = tick.previewClaim(id, alice);
        vm.prank(alice);
        assertEq(tick.claim(id), preview);
    }

    function test_impliedOddsTrackPoolRatio() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);
        assertEq(tick.impliedAboveBps(id), 5_000, "empty market reads 50/50");

        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
        _stake(alice, t, true, 75e6);
        _stake(bob, t, false, 25e6);
        assertEq(tick.impliedAboveBps(id), 7_500);
    }

    // ------------------------------------------------------------- invariants

    function test_shardedPoolsSumCorrectly() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);

        uint256 n = 20;
        for (uint256 i; i < n; ++i) {
            address u = vm.addr(uint256(keccak256(abi.encode("staker", i))));
            tkn.mint(u, 1_000e6);
            vm.prank(u);
            tkn.approve(address(tick), type(uint256).max);
            vm.prank(u);
            tick.deposit(100e6);
            vm.prank(u);
            tick.stakeOn(t, i % 2 == 0, 5e6);
        }

        (uint256 above, uint256 below) = tick.pools(id);
        assertEq(above + below, n * 5e6, "shards must sum to everything staked");
    }

    function test_solvencyAfterFullSettlement() public {
        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);
        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
        _fund(carol, 1_000e6);
        _stake(alice, t, true, 40e6);
        _stake(bob, t, true, 60e6);
        _stake(carol, t, false, 100e6);

        _settleAt(t, 90_001e8);

        uint256 paid;
        vm.prank(alice);
        paid += tick.claim(id);
        vm.prank(bob);
        paid += tick.claim(id);
        vm.prank(carol);
        paid += tick.claim(id);

        (uint256 above, uint256 below) = tick.pools(id);
        assertLe(paid, above + below, "payouts must never exceed the pools");
        assertLe(paid + tick.feesAccrued(address(this)), above + below, "payouts + fees must not either");
    }

    function testFuzz_payoutsNeverExceedPools(uint96 a, uint96 b, uint96 c) public {
        a = uint96(bound(a, 1, 1_000e6));
        b = uint96(bound(b, 1, 1_000e6));
        c = uint96(bound(c, 1, 1_000e6));

        Tick.Terms memory t = _terms(90_000e8, _nextClose());
        bytes32 id = tick.marketId(t);
        _fund(alice, 10_000e6);
        _fund(bob, 10_000e6);
        _fund(carol, 10_000e6);
        _stake(alice, t, true, a);
        _stake(bob, t, true, b);
        _stake(carol, t, false, c);

        _settleAt(t, 90_001e8);

        uint256 paid;
        vm.prank(alice);
        paid += tick.claim(id);
        vm.prank(bob);
        paid += tick.claim(id);
        vm.prank(carol);
        paid += tick.claim(id);

        (uint256 above, uint256 below) = tick.pools(id);
        assertLe(paid + tick.feesAccrued(address(this)), above + below);
    }

    function test_collectFeesSweepsOnlyGivenShards() public {
        (Tick.Terms memory t, bytes32 id) = _twoSided();
        _settleAt(t, 90_001e8);
        vm.prank(alice);
        tick.claim(id);

        uint256 total = tick.feesAccrued(address(this));
        assertGt(total, 0);

        uint256 aliceShard = uint256(uint160(alice)) % tick.SHARDS();
        uint256[] memory wrong = new uint256[](1);
        wrong[0] = (aliceShard + 1) % tick.SHARDS();
        vm.expectRevert(Tick.ZeroAmount.selector);
        tick.collectFees(wrong);

        uint256[] memory right = new uint256[](1);
        right[0] = aliceShard;
        assertEq(tick.collectFees(right), total);
        assertEq(tick.feesAccrued(address(this)), 0);
    }
}
