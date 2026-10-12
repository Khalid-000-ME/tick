// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickFeed} from "../src/TickFeed.sol";

/// The feed: what can be posted, what is kept, and that a photo is only ever in the log.
contract FeedTest is Test {
    TickFeed feed;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event Posted(uint64 indexed id, address indexed author, bytes image);

    function setUp() public {
        feed = new TickFeed();
    }

    function test_APostKeepsItsWordsAndWhereItsPhotoLives() public {
        bytes memory img = hex"52494646deadbeef";
        vm.roll(1234);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Posted(1, alice, img);
        uint64 id = feed.post("up 4 dollars in a minute", img, true);
        assertEq(id, 1);
        TickFeed.Post memory p = feed.postInfo(1);
        assertEq(p.author, alice);
        assertEq(p.caption, "up 4 dollars in a minute");
        assertEq(p.blockNumber, 1234);
        assertEq(p.imageBytes, img.length);
        assertTrue(p.card);
        assertEq(p.likes, 0);
        assertEq(feed.postsBy(alice).length, 1);
    }

    function test_AnImageNeverTouchesStorage() public {
        // Same caption, one with a 40KB photo and one without: the photo must add almost
        // nothing beyond its calldata and log, never the ~22k-per-word cost of storage.
        bytes memory img = new bytes(40_000);
        for (uint256 i = 0; i < img.length; i++) img[i] = bytes1(uint8(i % 251) + 1);
        uint256 g0 = gasleft();
        feed.post("x", "", false);
        uint256 plain = g0 - gasleft();
        uint256 g1 = gasleft();
        feed.post("x", img, false);
        uint256 withPhoto = g1 - gasleft();
        // 40KB in storage would be about 28 million gas. In a log it is under 1.2 million.
        assertLt(withPhoto - plain, 1_200_000);
    }

    function test_PostsNeedSomethingToShow() public {
        vm.expectRevert(TickFeed.Empty.selector);
        feed.post("", "", false);
        // A bare card is a post.
        feed.post("", "", true);
        assertEq(feed.postCount(), 1);
    }

    function test_RejectsTooLongCaptionsAndPhotos() public {
        vm.expectRevert(TickFeed.TooLong.selector);
        feed.post(string(new bytes(281)), "", false);
        vm.expectRevert(TickFeed.TooLong.selector);
        feed.post("x", new bytes(48_001), false);
        feed.post("x", new bytes(48_000), false);
    }

    function test_LikesAreOnePerAddressAndCanBeTakenBack() public {
        feed.post("hello", "", false);
        vm.prank(alice);
        feed.like(1);
        vm.prank(bob);
        feed.like(1);
        assertEq(feed.postInfo(1).likes, 2);
        assertTrue(feed.liked(1, alice));
        vm.prank(alice);
        feed.like(1);
        assertEq(feed.postInfo(1).likes, 1);
        assertFalse(feed.liked(1, alice));
        vm.expectRevert(TickFeed.NoPost.selector);
        feed.like(2);
        vm.expectRevert(TickFeed.NoPost.selector);
        feed.like(0);
    }

    function test_TheFeedIsNewestFirstAndPages() public {
        for (uint256 i = 0; i < 5; i++) feed.post(string(abi.encodePacked("p", bytes1(uint8(48 + i)))), "", false);
        (uint64[] memory ids, TickFeed.Post[] memory page) = feed.latest(2, 0);
        assertEq(ids.length, 2);
        assertEq(ids[0], 5);
        assertEq(ids[1], 4);
        assertEq(page[0].caption, "p4");

        (ids, page) = feed.latest(2, ids[1]);
        assertEq(ids[0], 3);
        assertEq(ids[1], 2);

        (ids, page) = feed.latest(10, 2);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);

        (ids,) = feed.latest(10, 1);
        assertEq(ids.length, 0);
    }

    function test_AnEmptyFeedIsEmptyNotAnError() public view {
        (uint64[] memory ids,) = feed.latest(10, 0);
        assertEq(ids.length, 0);
    }
}
