// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickSocial} from "../src/TickSocial.sol";

/// Groups and rooms: the membership a room's table is drawn from, so every edge matters.
contract SocialTest is Test {
    TickSocial social;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        social = new TickSocial();
    }

    function test_CreatingAGroupJoinsTheCreator() public {
        vm.prank(alice);
        uint64 id = social.createGroup("Night shift");
        assertEq(id, 1);
        assertTrue(social.inGroup(id, alice));
        (string memory name, address creator,, uint256 members, uint256 rooms) = social.groupInfo(id);
        assertEq(name, "Night shift");
        assertEq(creator, alice);
        assertEq(members, 1);
        assertEq(rooms, 0);
        assertEq(social.groupsOf(alice).length, 1);
    }

    function test_JoiningAGroupIsOnceOnly() public {
        vm.prank(alice);
        uint64 id = social.createGroup("Night shift");
        vm.prank(bob);
        social.joinGroup(id);
        (,,, uint256 members,) = social.groupInfo(id);
        assertEq(members, 2);
        assertEq(social.groupMembers(id)[1], bob);
        vm.prank(bob);
        vm.expectRevert(TickSocial.AlreadyIn.selector);
        social.joinGroup(id);
    }

    function test_ARoomCanStandOnItsOwn() public {
        vm.prank(alice);
        uint64 room = social.createRoom("Friday flash", 0);
        (string memory name,, uint64 groupId,, uint256 members) = social.roomInfo(room);
        assertEq(name, "Friday flash");
        assertEq(groupId, 0);
        assertEq(members, 1);
        assertEq(social.roomsOf(alice)[0], room);
    }

    function test_ARoomInsideAGroupIsListedThere() public {
        vm.startPrank(alice);
        uint64 group = social.createGroup("Night shift");
        uint64 room = social.createRoom("Friday flash", group);
        vm.stopPrank();
        assertEq(social.roomsInGroup(group).length, 1);
        assertEq(social.roomsInGroup(group)[0], room);
        (,,,, uint256 rooms) = social.groupInfo(group);
        assertEq(rooms, 1);
    }

    function test_JoiningARoomAddsOneMemberOnce() public {
        vm.prank(alice);
        uint64 room = social.createRoom("Friday flash", 0);
        vm.prank(bob);
        social.joinRoom(room);
        assertTrue(social.inRoom(room, bob));
        assertEq(social.roomMembers(room).length, 2);
        vm.prank(bob);
        vm.expectRevert(TickSocial.AlreadyIn.selector);
        social.joinRoom(room);
    }

    function test_RejectsNamesThatAreEmptyOrTooLong() public {
        vm.expectRevert(TickSocial.BadName.selector);
        social.createGroup("");
        vm.expectRevert(TickSocial.BadName.selector);
        social.createRoom("", 0);
        string memory long = "123456789012345678901234567890123456789012";
        vm.expectRevert(TickSocial.BadName.selector);
        social.createGroup(long);
    }

    function test_RejectsIdsThatDoNotExist() public {
        vm.expectRevert(TickSocial.NoGroup.selector);
        social.joinGroup(1);
        vm.expectRevert(TickSocial.NoRoom.selector);
        social.joinRoom(1);
        vm.expectRevert(TickSocial.NoGroup.selector);
        social.createRoom("Orphan", 7);
        vm.expectRevert(TickSocial.NoGroup.selector);
        social.groupInfo(0);
        vm.expectRevert(TickSocial.NoRoom.selector);
        social.roomInfo(0);
    }

    function test_CountsGrowWithEachOne() public {
        vm.startPrank(alice);
        social.createGroup("One");
        social.createGroup("Two");
        social.createRoom("Room", 0);
        vm.stopPrank();
        assertEq(social.groupCount(), 2);
        assertEq(social.roomCount(), 1);
    }
}
