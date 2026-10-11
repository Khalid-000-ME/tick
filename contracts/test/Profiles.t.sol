// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickProfiles} from "../src/TickProfiles.sol";

contract ProfilesTest is Test {
    TickProfiles p;
    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public {
        p = new TickProfiles();
    }

    function test_setAndRead() public {
        vm.prank(alice);
        p.setProfile("alice_1", "Alice", "gen:beam:42");
        (string memory u, string memory d, string memory a, uint64 at) = p.profileOf(alice);
        assertEq(u, "alice_1");
        assertEq(d, "Alice");
        assertEq(a, "gen:beam:42");
        assertEq(at, uint64(block.timestamp));
        assertEq(p.ownerOf(keccak256("alice_1")), alice);
    }

    function test_usernamesAreUnique() public {
        vm.prank(alice);
        p.setProfile("trader", "A", "");
        vm.prank(bob);
        vm.expectRevert(TickProfiles.UsernameTaken.selector);
        p.setProfile("trader", "B", "");
    }

    function test_renameReleasesTheOldName() public {
        vm.startPrank(alice);
        p.setProfile("first", "A", "");
        p.setProfile("second", "A", "");
        vm.stopPrank();
        assertEq(p.ownerOf(keccak256("first")), address(0));
        vm.prank(bob);
        p.setProfile("first", "B", "");
        assertEq(p.ownerOf(keccak256("first")), bob);
    }

    function test_updatingKeepsYourOwnName() public {
        vm.startPrank(alice);
        p.setProfile("same", "A", "");
        p.setProfile("same", "A2", "gen:pixel:1");
        vm.stopPrank();
        assertEq(p.ownerOf(keccak256("same")), alice);
        assertTrue(p.available("same", alice));
        assertFalse(p.available("same", bob));
    }

    function test_rejectsUppercaseSpacesAndBadLengths() public {
        vm.startPrank(alice);
        vm.expectRevert(TickProfiles.BadUsername.selector);
        p.setProfile("Alice", "A", "");
        vm.expectRevert(TickProfiles.BadUsername.selector);
        p.setProfile("al ice", "A", "");
        vm.expectRevert(TickProfiles.BadUsername.selector);
        p.setProfile("ab", "A", "");
        vm.expectRevert(TickProfiles.BadUsername.selector);
        p.setProfile("abcdefghijklmnopqrstu", "A", "");
        vm.stopPrank();
    }

    function test_rejectsOversizedFields() public {
        vm.startPrank(alice);
        vm.expectRevert(TickProfiles.TooLong.selector);
        p.setProfile("okname", "this display name is far longer than forty bytes", "");
        bytes memory big = new bytes(301);
        vm.expectRevert(TickProfiles.TooLong.selector);
        p.setProfile("okname", "A", string(big));
        vm.stopPrank();
    }

    function test_availability() public view {
        assertTrue(p.available("fresh_name", alice));
        assertFalse(p.available("No", alice));
        assertFalse(p.available("has-dash", alice));
    }
}
