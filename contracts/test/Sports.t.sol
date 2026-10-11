// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickSports} from "../src/TickSports.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice The attested settlement path, and the limits on what the attestor can do.
contract SportsTest is Test {
    TickSports tick;
    TestUSD usd;

    uint256 attestorPk = 0xA11CE;
    address attestor;
    address admin = address(0xAD);
    address alice = address(0xA1);
    address bob = address(0xB0);
    address stranger = address(0xC0FFEE);

    uint16 constant FEE_BPS = 200;
    uint16 constant BOUNTY_BPS = 5_000;
    uint256 constant MAX_BOUNTY = 2e6;
    uint256 constant SETTLE_WINDOW = 1 days;

    bytes32 constant EVENT_ID = keccak256("espn:401772999");
    uint64 kickoff;
    uint8 HOME_;
    uint8 AWAY_;
    uint8 VOID_;

    function setUp() public {
        attestor = vm.addr(attestorPk);
        usd = new TestUSD();
        tick = new TickSports(IERC20(address(usd)), admin, attestor, FEE_BPS, BOUNTY_BPS, MAX_BOUNTY, SETTLE_WINDOW);
        HOME_ = tick.HOME();
        AWAY_ = tick.AWAY();
        VOID_ = tick.VOID();
        kickoff = uint64(block.timestamp + 1 hours);
        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
    }

    function _fund(address who, uint256 amount) internal {
        usd.seed(who, amount);
        vm.startPrank(who);
        usd.approve(address(tick), type(uint256).max);
        tick.deposit(amount);
        vm.stopPrank();
    }

    function _terms() internal view returns (TickSports.Terms memory) {
        return TickSports.Terms({eventId: EVENT_ID, closesAt: kickoff});
    }

    function _sign(uint256 pk, TickSports.Terms memory t, uint8 outcome) internal view returns (bytes memory) {
        bytes32 digest = tick.attestationDigest(t, outcome);
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, prefixed);
        return abi.encodePacked(r, s, v);
    }

    function _twoSided() internal returns (TickSports.Terms memory t, bytes32 id) {
        t = _terms();
        id = tick.marketId(t);
        vm.prank(alice);
        tick.stakeOn(t, true, 100e6);
        vm.prank(bob);
        tick.stakeOn(t, false, 100e6);
    }

    // ---------------------------------------------------------------- happy path

    function test_attestedResultPaysTheWinningSide() public {
        (TickSports.Terms memory t, bytes32 id) = _twoSided();
        vm.warp(kickoff + 2 hours);

        bytes memory sig = _sign(attestorPk, t, HOME_);
        vm.prank(stranger);
        assertEq(tick.settleAttested(t, HOME_, sig), HOME_);

        vm.prank(alice);
        uint256 paid = tick.claim(id);
        assertGt(paid, 100e6, "winner takes more than the stake");

        vm.prank(bob);
        assertEq(tick.claim(id), 0, "loser takes nothing");
    }

    /// @notice Anyone holding the signature can land it and keep the bounty. The attestor
    ///         picks the result; it does not pick who profits from posting it.
    function test_anyoneMaySubmitAndKeepsTheBounty() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);

        bytes memory sig = _sign(attestorPk, t, AWAY_);
        uint256 before = tick.deposits(stranger);
        vm.prank(stranger);
        tick.settleAttested(t, AWAY_, sig);

        // Half of 2% of the 100e6 losing pool, under the 2e6 cap.
        assertEq(tick.deposits(stranger) - before, 1e6, "settler keeps half the fee");
    }

    // ---------------------------------------------------------------- the limits

    function test_aForgedSignatureCannotSettle() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);

        bytes memory forged = _sign(0xBAD, t, HOME_);
        vm.expectRevert(TickSports.BadAttestation.selector);
        tick.settleAttested(t, HOME_, forged);
    }

    /// @notice A signature for HOME cannot be replayed to settle AWAY: the outcome is
    ///         inside the digest.
    function test_signatureIsBoundToTheOutcome() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);

        bytes memory sig = _sign(attestorPk, t, HOME_);
        vm.expectRevert(TickSports.BadAttestation.selector);
        tick.settleAttested(t, AWAY_, sig);
    }

    /// @notice And not to a different fixture.
    function test_signatureIsBoundToTheMarket() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, HOME_);

        TickSports.Terms memory other = TickSports.Terms({eventId: keccak256("espn:other"), closesAt: kickoff});
        vm.expectRevert(TickSports.BadAttestation.selector);
        tick.settleAttested(other, HOME_, sig);
    }

    function test_cannotSettleBeforeKickoff() public {
        (TickSports.Terms memory t,) = _twoSided();
        bytes memory sig = _sign(attestorPk, t, HOME_);
        vm.expectRevert(TickSports.NotClosed.selector);
        tick.settleAttested(t, HOME_, sig);
    }

    function test_cannotSettleTwice() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, HOME_);
        tick.settleAttested(t, HOME_, sig);
        vm.expectRevert(TickSports.AlreadySettled.selector);
        tick.settleAttested(t, HOME_, sig);
    }

    /// @notice THE containment property. A silent or captured attestor cannot strand
    ///         anyone's money: after the settle window a stranger refunds the market.
    function test_aSilentAttestorCannotStrandTheMoney() public {
        (TickSports.Terms memory t, bytes32 id) = _twoSided();
        vm.warp(uint256(kickoff) + SETTLE_WINDOW + 1);

        vm.prank(stranger);
        tick.voidStale(t);

        vm.prank(alice);
        assertEq(tick.claim(id), 100e6, "stake returned in full");
        vm.prank(bob);
        assertEq(tick.claim(id), 100e6, "stake returned in full");
    }

    /// @notice Rotating the attestor cannot reopen or change a settled market.
    function test_rotatingTheAttestorCannotRewriteHistory() public {
        (TickSports.Terms memory t, bytes32 id) = _twoSided();
        vm.warp(kickoff + 1);
        tick.settleAttested(t, HOME_, _sign(attestorPk, t, HOME_));

        vm.prank(admin);
        tick.setAttestor(vm.addr(0xBAD));

        bytes memory rogue = _sign(0xBAD, t, AWAY_);
        vm.expectRevert(TickSports.AlreadySettled.selector);
        tick.settleAttested(t, AWAY_, rogue);

        (uint8 outcome,,,,) = tick.settlements(id);
        assertEq(outcome, HOME_, "the recorded result is unchanged");
    }

    function test_onlyAdminRotatesTheAttestor() public {
        vm.prank(stranger);
        vm.expectRevert(TickSports.NotAdmin.selector);
        tick.setAttestor(stranger);
    }

    function test_aDrawVoidsAndRefunds() public {
        (TickSports.Terms memory t, bytes32 id) = _twoSided();
        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, VOID_);
        tick.settleAttested(t, VOID_, sig);

        vm.prank(alice);
        assertEq(tick.claim(id), 100e6);
        vm.prank(bob);
        assertEq(tick.claim(id), 100e6);
    }

    function test_oneSidedMarketVoidsEvenOnAResult() public {
        TickSports.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        vm.prank(alice);
        tick.stakeOn(t, true, 50e6);

        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, HOME_);
        tick.settleAttested(t, HOME_, sig);

        (uint8 outcome,,,,) = tick.settlements(id);
        assertEq(outcome, VOID_, "nobody to win from");
        vm.prank(alice);
        assertEq(tick.claim(id), 50e6);
    }

    function test_cannotStakeAfterKickoff() public {
        TickSports.Terms memory t = _terms();
        vm.warp(kickoff);
        vm.prank(alice);
        vm.expectRevert(TickSports.NotOpen.selector);
        tick.stakeOn(t, true, 10e6);
    }

    function test_badOutcomeRejected() public {
        (TickSports.Terms memory t,) = _twoSided();
        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, 9);
        vm.expectRevert(TickSports.BadOutcome.selector);
        tick.settleAttested(t, 9, sig);
    }

    /// @notice Solvency: payouts plus fees plus bounty never exceed what was staked.
    function testFuzz_neverPaysOutMoreThanWasStaked(uint96 a, uint96 b) public {
        uint128 homeAmt = uint128(bound(uint256(a), 1e6, 500e6));
        uint128 awayAmt = uint128(bound(uint256(b), 1e6, 500e6));

        TickSports.Terms memory t = _terms();
        bytes32 id = tick.marketId(t);
        vm.prank(alice);
        tick.stakeOn(t, true, homeAmt);
        vm.prank(bob);
        tick.stakeOn(t, false, awayAmt);

        vm.warp(kickoff + 1);
        bytes memory sig = _sign(attestorPk, t, HOME_);
        vm.prank(stranger);
        tick.settleAttested(t, HOME_, sig);

        uint256 paid;
        vm.prank(alice);
        paid += tick.claim(id);
        vm.prank(bob);
        paid += tick.claim(id);

        uint256[] memory shards = new uint256[](tick.SHARDS());
        for (uint256 i; i < shards.length; ++i) {
            shards[i] = i;
        }
        vm.prank(admin);
        uint256 fees = tick.collectFees(shards);

        assertLe(paid + fees + tick.deposits(stranger), uint256(homeAmt) + awayAmt, "cannot pay out more than staked");
    }
}
