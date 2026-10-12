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
        uint64 id = social.createGroup("Night shift", "gen:beam:1");
        assertEq(id, 1);
        assertTrue(social.inGroup(id, alice));
        (TickSocial.Group memory g, uint256 members, uint256 rooms,) = social.groupInfo(id);
        assertEq(g.name, "Night shift");
        assertEq(g.avatar, "gen:beam:1");
        assertEq(g.creator, alice);
        assertEq(members, 1);
        assertEq(rooms, 0);
        assertEq(social.groupsOf(alice).length, 1);
    }

    function test_JoiningAGroupIsOnceOnly() public {
        vm.prank(alice);
        uint64 id = social.createGroup("Night shift", "gen:beam:1");
        vm.prank(bob);
        social.joinGroup(id);
        (, uint256 members,,) = social.groupInfo(id);
        assertEq(members, 2);
        assertEq(social.groupMembers(id)[1], bob);
        vm.prank(bob);
        vm.expectRevert(TickSocial.AlreadyIn.selector);
        social.joinGroup(id);
    }

    function test_ARoomCanStandOnItsOwn() public {
        vm.prank(alice);
        uint64 room = social.createRoom("Friday flash", 0);
        (TickSocial.Room memory r, uint256 members,) = social.roomInfo(room);
        assertEq(r.name, "Friday flash");
        assertEq(r.groupId, 0);
        assertEq(members, 1);
        assertEq(social.roomsOf(alice)[0], room);
    }

    function test_ARoomInsideAGroupIsListedThere() public {
        vm.startPrank(alice);
        uint64 group = social.createGroup("Night shift", "gen:beam:1");
        uint64 room = social.createRoom("Friday flash", group);
        vm.stopPrank();
        assertEq(social.roomsInGroup(group).length, 1);
        assertEq(social.roomsInGroup(group)[0], room);
        (,, uint256 rooms,) = social.groupInfo(group);
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
        social.createGroup("", "");
        vm.expectRevert(TickSocial.BadName.selector);
        social.createRoom("", 0);
        string memory long = "123456789012345678901234567890123456789012";
        vm.expectRevert(TickSocial.BadName.selector);
        social.createGroup(long, "");
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

    function test_OnlyMembersCanPostAndTheChatReadsOldestFirst() public {
        vm.prank(alice);
        uint64 group = social.createGroup("Night shift", "");
        vm.prank(bob);
        vm.expectRevert(TickSocial.NotMember.selector);
        social.postToGroup(group, "hello?");

        vm.startPrank(alice);
        social.postToGroup(group, "first");
        social.postToGroup(group, "second");
        vm.stopPrank();
        vm.prank(bob);
        social.joinGroup(group);
        vm.prank(bob);
        social.postToGroup(group, "third");

        TickSocial.Post[] memory all = social.groupChat(group, 10);
        assertEq(all.length, 3);
        assertEq(all[0].text, "first");
        assertEq(all[2].text, "third");
        assertEq(all[2].from, bob);

        // Asking for two gives the two most recent, still oldest first.
        TickSocial.Post[] memory last = social.groupChat(group, 2);
        assertEq(last.length, 2);
        assertEq(last[0].text, "second");
        assertEq(last[1].text, "third");

        (,,, uint256 messages) = social.groupInfo(group);
        assertEq(messages, 3);
    }

    function test_RoomChatIsSeparateAndMembersOnly() public {
        vm.prank(alice);
        uint64 room = social.createRoom("Friday flash", 0);
        vm.prank(bob);
        vm.expectRevert(TickSocial.NotMember.selector);
        social.postToRoom(room, "let me in");
        vm.prank(alice);
        social.postToRoom(room, "ready");
        assertEq(social.roomChat(room, 10).length, 1);
        assertEq(social.groupChat(1, 10).length, 0);
    }

    function test_RejectsEmptyOrOverlongMessages() public {
        vm.startPrank(alice);
        uint64 group = social.createGroup("Night shift", "");
        vm.expectRevert(TickSocial.BadText.selector);
        social.postToGroup(group, "");
        string memory long = new string(281);
        vm.expectRevert(TickSocial.BadText.selector);
        social.postToGroup(group, long);
        vm.stopPrank();
    }

    function test_OnlyTheCreatorChangesTheGroupsNameAndPicture() public {
        vm.prank(alice);
        uint64 group = social.createGroup("Night shift", "gen:beam:1");
        vm.prank(bob);
        vm.expectRevert(TickSocial.NotCreator.selector);
        social.setGroup(group, "Hijacked", "");
        vm.prank(alice);
        social.setGroup(group, "Day shift", "/api/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        (TickSocial.Group memory g,,,) = social.groupInfo(group);
        assertEq(g.name, "Day shift");
        assertEq(g.avatar, "/api/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    }

    function test_RejectsAnAvatarReferenceThatIsTooLong() public {
        string memory long = new string(301);
        vm.expectRevert(TickSocial.BadAvatar.selector);
        social.createGroup("Night shift", long);
    }

    function test_CountsGrowWithEachOne() public {
        vm.startPrank(alice);
        social.createGroup("One", "");
        social.createGroup("Two", "");
        social.createRoom("Room", 0);
        vm.stopPrank();
        assertEq(social.groupCount(), 2);
        assertEq(social.roomCount(), 1);
    }
}
