// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GasStation} from "../src/GasStation.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract GasStationTest is Test {
    GasStation g;
    TestUSD usd;
    address admin = address(0xAD);
    address treasury = address(0x7E);
    address alice = address(0xA1);

    // 1 USDC -> 0.5 MON; at most 5 USDC per fill.
    uint256 constant RATE = 0.5 ether;
    uint256 constant MAX = 5e6;

    function setUp() public {
        usd = new TestUSD();
        g = new GasStation(IERC20(address(usd)), admin, treasury, RATE, MAX);
        vm.deal(address(g), 10 ether);
        usd.seed(alice, 100e6);
        vm.prank(alice);
        usd.approve(address(g), type(uint256).max);
    }

    function test_fillSwapsAtomically() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 out = g.fill(2e6, 0);
        assertEq(out, 1 ether);
        assertEq(alice.balance - before, 1 ether, "MON arrives");
        assertEq(usd.balanceOf(treasury), 2e6, "USDC goes to the treasury");
        assertEq(address(g).balance, 9 ether);
    }

    function test_quoteMatchesFill() public {
        uint256 q = g.quote(0.1e6);
        assertEq(q, 0.05 ether);
        vm.prank(alice);
        assertEq(g.fill(0.1e6, q), 0.05 ether);
    }

    function test_slippageProtectsTheQuote() public {
        uint256 quoted = g.quote(1e6);
        vm.prank(admin);
        g.setRate(0.1 ether, MAX);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GasStation.Slippage.selector, 0.1 ether, quoted));
        g.fill(1e6, quoted);
    }

    function test_capsAndZero() public {
        vm.startPrank(alice);
        vm.expectRevert(GasStation.BadAmount.selector);
        g.fill(0, 0);
        vm.expectRevert(GasStation.BadAmount.selector);
        g.fill(MAX + 1, 0);
        vm.stopPrank();
    }

    function test_reserveTooLowRevertsAndTakesNothing() public {
        vm.prank(admin);
        g.withdrawMon(address(g).balance - 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GasStation.ReserveTooLow.selector, 0.1 ether, 2 ether));
        g.fill(4e6, 0);
        assertEq(usd.balanceOf(alice), 100e6, "no USDC taken");
    }

    function test_onlyAdminSetsRate() public {
        vm.prank(alice);
        vm.expectRevert(GasStation.NotAdmin.selector);
        g.setRate(1 ether, MAX);
    }

    function testFuzz_neverPaysMoreThanQuoted(uint64 amt) public {
        uint256 a = bound(uint256(amt), 1, MAX);
        uint256 q = g.quote(a);
        uint256 before = alice.balance;
        vm.prank(alice);
        g.fill(a, 0);
        assertEq(alice.balance - before, q);
    }
}
