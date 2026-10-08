// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {Tick} from "../src/Tick.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

/// @notice Measures concurrency the way Monad actually experiences it.
///
/// @dev WHY READ-AFTER-WRITE, NOT WRITE-WRITE. Monad executes optimistically and
///      re-executes a transaction when a slot it READ was WRITTEN by an earlier
///      transaction in the same block. The predictive quantity is therefore
///      reads(txB) INTERSECT writes(txA), not the overlap of two write sets.
///
///      Two earlier attempts at this measurement were wrong, and both are recorded so
///      the mistake is not repeated:
///        - `eth_createAccessList` merges reads and writes into one list, so two designs
///          differing only in what they WRITE look identical.
///        - diffing `eth_getStorageAt` before and after a transaction reveals writes
///          only, so it is structurally blind to read-only dependencies.
///
///      `vm.startStateDiffRecording` carries an isWrite flag per access, which is what
///      makes the correct intersection computable at all.
///
///      Accesses are collected at BOTH Tick and Pyth, because the dependency that
///      decides whether sharding is worth anything is a cross-contract one: stakes read
///      Pyth's price slot, and whoever refreshes the price writes it.
///
///      These are Foundry simulations, not measurements of Monad's scheduler. They are
///      evidence about the storage layout.
contract ConcurrencyTest is Test {
    Tick tick;
    MockERC20 tkn;
    MockPyth pyth;

    address alice = address(0xA1);
    address bob = address(0xB2);
    address keeper = address(0xCAFE);

    bytes32 constant BTC = bytes32(uint256(0xB7C));
    int32 constant EXPO = -8;
    uint32 constant WINDOW = 30;
    uint256 constant ACCEPT_MARGIN = 2;

    function setUp() public {
        tkn = new MockERC20();
        pyth = new MockPyth();
        tick = new Tick(IERC20(address(tkn)), IPyth(address(pyth)), address(this), ACCEPT_MARGIN, 10 minutes, 0, 0);

        vm.warp(1_000_000 * uint256(WINDOW));
        pyth.set(BTC, 90_000e8, EXPO, block.timestamp);
        tick.listFeed(BTC, 100e8, WINDOW, 5, 200);

        address[2] memory users = [alice, bob];
        for (uint256 i; i < users.length; ++i) {
            tkn.mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            tkn.approve(address(tick), type(uint256).max);
            vm.prank(users[i]);
            tick.deposit(10_000e6);
        }
    }

    // ------------------------------------------------------------- helpers

    function _terms(int64 strike) internal view returns (Tick.Terms memory) {
        return Tick.Terms({
            feedId: BTC,
            strike: strike,
            expo: EXPO,
            closesAt: uint64((block.timestamp / WINDOW + 1) * WINDOW)
        });
    }

    struct Access {
        address account;
        bytes32 slot;
    }

    /// @dev Reads and writes across every contract touched, keyed by (account, slot) so a
    ///      Tick slot is never confused with a Pyth slot that happens to share a number.
    function _collect() internal returns (Access[] memory reads, Access[] memory writes) {
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();

        uint256 nr;
        uint256 nw;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                if (accesses[i].storageAccesses[j].reverted) continue;
                if (accesses[i].storageAccesses[j].isWrite) nw++;
                else nr++;
            }
        }

        reads = new Access[](nr);
        writes = new Access[](nw);
        nr = 0;
        nw = 0;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 j; j < accesses[i].storageAccesses.length; ++j) {
                Vm.StorageAccess memory sa = accesses[i].storageAccesses[j];
                if (sa.reverted) continue;
                if (sa.isWrite) writes[nw++] = Access(sa.account, sa.slot);
                else reads[nr++] = Access(sa.account, sa.slot);
            }
        }
    }

    function _overlap(Access[] memory a, Access[] memory b) internal pure returns (uint256 n) {
        for (uint256 i; i < a.length; ++i) {
            for (uint256 j; j < b.length; ++j) {
                if (a[i].account == b[j].account && a[i].slot == b[j].slot) {
                    n++;
                    break;
                }
            }
        }
    }

    // ------------------------------------------------- the headline measurement

    /// @notice THE CLAIM. With the price already refreshed in an earlier block, one
    ///         stake's writes are disjoint from the next stake's reads. Neither
    ///         re-executes, across Tick AND Pyth.
    function test_raw_stakesAreIndependentWhenPriceIsAlreadyFresh() public {
        Tick.Terms memory t = _terms(90_000e8);

        vm.startStateDiffRecording();
        vm.prank(alice);
        tick.stakeOn(t, true, 100e6);
        (, Access[] memory writesA) = _collect();

        vm.startStateDiffRecording();
        vm.prank(bob);
        tick.stakeOn(t, false, 100e6);
        (Access[] memory readsB,) = _collect();

        uint256 conflicts = _overlap(writesA, readsB);
        emit log_named_uint("stake A writes", writesA.length);
        emit log_named_uint("stake B reads", readsB.length);
        emit log_named_uint("RAW conflicts (B reads what A wrote)", conflicts);

        assertEq(conflicts, 0, "stakes must not depend on one another");
    }

    /// @notice A stake must never WRITE the oracle. If it did, every stake in the block
    ///         would contend on Pyth's price slot and the sharding would buy nothing.
    ///         This is the reason Tick reads the price instead of refreshing it.
    function test_stakeNeverWritesTheOracle() public {
        Tick.Terms memory t = _terms(90_000e8);

        vm.startStateDiffRecording();
        vm.prank(alice);
        tick.stakeOn(t, true, 100e6);
        (Access[] memory reads, Access[] memory writes) = _collect();

        uint256 pythWrites;
        uint256 pythReads;
        for (uint256 i; i < writes.length; ++i) {
            if (writes[i].account == address(pyth)) pythWrites++;
        }
        for (uint256 i; i < reads.length; ++i) {
            if (reads[i].account == address(pyth)) pythReads++;
        }

        emit log_named_uint("Pyth slots READ by a stake", pythReads);
        emit log_named_uint("Pyth slots WRITTEN by a stake", pythWrites);

        assertGt(pythReads, 0, "the stake does consult the oracle");
        assertEq(pythWrites, 0, "a stake must never write the oracle");
    }

    /// @notice THE NEGATIVE CONTROL, and the honest limit of the claim above. A price
    ///         refresh in the SAME block as a stake does conflict: the stake reads the
    ///         slot the refresh just wrote. Refresh in one block, stake in the next.
    ///         At 400ms that costs ~400ms; at 12s blocks it would cost 12s, which is
    ///         why the gate cannot be tight on a slow chain.
    function test_raw_refreshInTheSameBlockDoesConflict() public {
        Tick.Terms memory t = _terms(90_000e8);

        bytes[] memory update = new bytes[](1);
        update[0] = pyth.encode(BTC, 90_050e8, EXPO, block.timestamp);

        vm.startStateDiffRecording();
        vm.prank(keeper);
        pyth.updatePriceFeeds(update);
        (, Access[] memory writesRefresh) = _collect();

        vm.startStateDiffRecording();
        vm.prank(alice);
        tick.stakeOn(t, true, 100e6);
        (Access[] memory readsStake,) = _collect();

        uint256 conflicts = _overlap(writesRefresh, readsStake);
        emit log_named_uint("refresh writes", writesRefresh.length);
        emit log_named_uint("RAW conflicts (stake reads what the refresh wrote)", conflicts);

        assertGt(conflicts, 0, "a same-block refresh is expected to serialise stakes behind it");
    }

    /// @notice Two winning claims must not contend. An unsharded fee counter made every
    ///         winning claim in the system write one slot, including unrelated markets.
    function test_raw_twoClaimsDoNotShareASlot() public {
        Tick.Terms memory t = _terms(90_000e8);

        // alice and bob both on ABOVE so both win; the keeper funds the losing side.
        tkn.mint(keeper, 1_000e6);
        vm.prank(keeper);
        tkn.approve(address(tick), type(uint256).max);
        vm.prank(keeper);
        tick.deposit(500e6);

        vm.prank(alice);
        tick.stakeOn(t, true, 100e6);
        vm.prank(bob);
        tick.stakeOn(t, true, 100e6);
        vm.prank(keeper);
        tick.stakeOn(t, false, 100e6);

        bytes32 id = tick.marketId(t);
        vm.warp(t.closesAt);
        bytes[] memory u = new bytes[](1);
        u[0] = pyth.encodeWithPrev(t.feedId, 90_001e8, EXPO, t.closesAt, uint256(t.closesAt) - 1);
        tick.settleWithUpdate{value: 1}(t, u);

        vm.startStateDiffRecording();
        vm.prank(alice);
        tick.claim(id);
        (, Access[] memory writesA) = _collect();

        vm.startStateDiffRecording();
        vm.prank(bob);
        tick.claim(id);
        (Access[] memory readsB, Access[] memory writesB) = _collect();

        emit log_named_uint("claim A writes", writesA.length);
        emit log_named_uint("claim/claim shared WRITES", _overlap(writesA, writesB));
        emit log_named_uint("claim/claim RAW conflicts", _overlap(writesA, readsB));

        assertEq(_overlap(writesA, writesB), 0, "two claims must not write the same slot");
    }

    /// @notice Honest measurement of the dependency that is NOT removed.
    function test_shardCollisionsAreMeasuredNotClaimedAway() public {
        uint256 n = 30;
        address[] memory users = new address[](n);
        for (uint256 i; i < n; ++i) {
            users[i] = vm.addr(uint256(keccak256(abi.encode("participant", i))));
        }

        uint256 pairs;
        for (uint256 i; i < n; ++i) {
            for (uint256 j = i + 1; j < n; ++j) {
                if (uint256(uint160(users[i])) % tick.SHARDS() == uint256(uint160(users[j])) % tick.SHARDS()) {
                    pairs++;
                }
            }
        }

        emit log_named_uint("participants", n);
        emit log_named_uint("shards", tick.SHARDS());
        emit log_named_uint("same-shard pairs (these DO contend)", pairs);
        emit log_named_uint("total pairs", (n * (n - 1)) / 2);

        // Birthday paradox: ~C(30,2)/64 = 6.8 expected. A loose bound only, because the
        // purpose of this test is to publish the number rather than to hide it.
        assertLt(pairs, 30, "collisions should stay far below the pair count");
    }
}
