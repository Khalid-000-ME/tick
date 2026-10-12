// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickFeed — a social feed on chain: photos, captions and likes
///
/// @notice A post is a caption, an optional photo and a flag that says "show my results card
///         with this". The card itself is never stored: it is drawn from the author's real
///         record on the market contracts when the post is read, so a post cannot claim a
///         profit its author did not make.
///
///         The photo lives in the event, not in storage. Storage costs about 22,000 gas per
///         32 bytes, which makes a photo impossible; the same bytes in a log cost 8 gas each.
///         The post keeps the block it landed in, and a reader fetches the log for that one
///         block, which Monad's RPC allows even though it refuses wide log ranges. Nothing
///         about the photo is held by us or by any third party.
///
///         Ids start at 1. Likes are one per address and can be taken back.
contract TickFeed {
    struct Post {
        address author;
        uint64 at;
        uint32 likes;
        uint64 blockNumber;
        uint32 imageBytes;
        bool card;
        string caption;
    }

    /// @dev A photo is compressed in the browser first; this bound keeps one post well inside
    ///      a block's gas and a node's request size.
    uint256 public constant MAX_IMAGE = 48_000;
    uint256 public constant MAX_CAPTION = 280;

    Post[] private _posts;
    mapping(uint64 => mapping(address => bool)) public liked;
    mapping(address => uint64[]) private _postsBy;

    event Posted(uint64 indexed id, address indexed author, bytes image);
    event Liked(uint64 indexed id, address indexed by, bool on);

    error Empty();
    error TooLong();
    error NoPost();

    /// @param image A compressed photo, or empty for a post with no photo.
    /// @param card  Show the author's results card with the post.
    function post(string calldata caption, bytes calldata image, bool card) external returns (uint64 id) {
        if (bytes(caption).length > MAX_CAPTION || image.length > MAX_IMAGE) revert TooLong();
        // Something has to be there to read: words, a picture, or the card.
        if (bytes(caption).length == 0 && image.length == 0 && !card) revert Empty();

        _posts.push(
            Post({
                author: msg.sender,
                at: uint64(block.timestamp),
                likes: 0,
                blockNumber: uint64(block.number),
                imageBytes: uint32(image.length),
                card: card,
                caption: caption
            })
        );
        id = uint64(_posts.length);
        _postsBy[msg.sender].push(id);
        emit Posted(id, msg.sender, image);
    }

    /// @notice Like, or take the like back if it is already there.
    function like(uint64 id) external {
        if (id == 0 || id > _posts.length) revert NoPost();
        Post storage p = _posts[id - 1];
        bool on = !liked[id][msg.sender];
        liked[id][msg.sender] = on;
        if (on) p.likes += 1;
        else p.likes -= 1;
        emit Liked(id, msg.sender, on);
    }

    function postCount() external view returns (uint256) {
        return _posts.length;
    }

    function postInfo(uint64 id) external view returns (Post memory) {
        if (id == 0 || id > _posts.length) revert NoPost();
        return _posts[id - 1];
    }

    /// @notice A page of the feed, newest first.
    /// @param count  How many to return at most.
    /// @param before Only posts with an id below this; pass 0 for the very latest.
    /// @return ids   The id of each returned post, in the same order.
    /// @return page  The posts.
    function latest(uint256 count, uint64 before) external view returns (uint64[] memory ids, Post[] memory page) {
        uint256 top = before == 0 || before > _posts.length + 1 ? _posts.length : before - 1;
        uint256 n = count < top ? count : top;
        ids = new uint64[](n);
        page = new Post[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = top - i;
            ids[i] = uint64(id);
            page[i] = _posts[id - 1];
        }
    }

    function postsBy(address who) external view returns (uint64[] memory) {
        return _postsBy[who];
    }
}
