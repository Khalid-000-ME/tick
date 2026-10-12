// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickSocial — groups, rooms and their chat, on chain
///
/// @notice Who is playing with whom, what their group looks like, and what they said to each
///         other. A room's table was already trustless because every stake and claim is on
///         chain; keeping membership, the group's own face and the conversation here means
///         none of it rests on a server that could quietly edit the record.
///
///         A group is a standing crowd with a name and a picture. A room is a contest, and it
///         can sit inside a group or stand on its own behind its invite link, so sharing a
///         contest with four friends never means founding a community first. Both have a
///         chat, which only their members can post to.
///
///         Ids start at 1, so 0 means "no group" on a room that belongs to nobody. Only short
///         strings are stored: an avatar is a reference, never image bytes, exactly as in
///         TickProfiles. Nothing about money is written here; a table is always read back
///         from the market contracts.
contract TickSocial {
    struct Group {
        string name;
        /// @notice A reference: "gen:<style>:<seed>", an uploaded path, or an https URL.
        string avatar;
        address creator;
        uint64 createdAt;
    }

    struct Room {
        string name;
        address creator;
        /// @notice The group it belongs to, or 0 for a room that stands on its own.
        uint64 groupId;
        uint64 createdAt;
    }

    struct Post {
        address from;
        uint64 at;
        string text;
    }

    uint256 public constant MAX_NAME = 40;
    uint256 public constant MAX_AVATAR = 300;
    uint256 public constant MAX_TEXT = 280;

    Group[] private _groups;
    Room[] private _rooms;

    mapping(uint64 => address[]) private _groupMembers;
    mapping(uint64 => address[]) private _roomMembers;
    mapping(uint64 => uint64[]) private _groupRooms;
    mapping(address => uint64[]) private _groupsOf;
    mapping(address => uint64[]) private _roomsOf;

    /// @notice Chat, kept in storage rather than only in events, so a page can read the last
    ///         messages in one call. Monad's RPC answers getLogs over a short range of
    ///         blocks, which is no way to open a conversation.
    mapping(uint64 => Post[]) private _groupChat;
    mapping(uint64 => Post[]) private _roomChat;

    /// @notice Membership, the cheap way to ask.
    mapping(uint64 => mapping(address => bool)) public inGroup;
    mapping(uint64 => mapping(address => bool)) public inRoom;

    event GroupCreated(uint64 indexed id, address indexed creator, string name, string avatar);
    event GroupChanged(uint64 indexed id, string name, string avatar);
    event GroupJoined(uint64 indexed id, address indexed member);
    event RoomCreated(uint64 indexed id, uint64 indexed groupId, address indexed creator, string name);
    event RoomJoined(uint64 indexed id, address indexed member);
    event GroupPosted(uint64 indexed id, address indexed from, string text);
    event RoomPosted(uint64 indexed id, address indexed from, string text);

    error BadName();
    error BadAvatar();
    error BadText();
    error NoGroup();
    error NoRoom();
    error AlreadyIn();
    error NotMember();
    error NotCreator();

    /* ----------------------------------------------------------------- writing */

    function createGroup(string calldata name, string calldata avatar) external returns (uint64 id) {
        _checkName(name);
        _checkAvatar(avatar);
        _groups.push(Group({name: name, avatar: avatar, creator: msg.sender, createdAt: uint64(block.timestamp)}));
        id = uint64(_groups.length);
        emit GroupCreated(id, msg.sender, name, avatar);
        _addToGroup(id, msg.sender);
    }

    /// @notice The group's own name and face, changed by whoever started it.
    function setGroup(uint64 id, string calldata name, string calldata avatar) external {
        if (id == 0 || id > _groups.length) revert NoGroup();
        Group storage g = _groups[id - 1];
        if (msg.sender != g.creator) revert NotCreator();
        _checkName(name);
        _checkAvatar(avatar);
        g.name = name;
        g.avatar = avatar;
        emit GroupChanged(id, name, avatar);
    }

    function joinGroup(uint64 id) external {
        if (id == 0 || id > _groups.length) revert NoGroup();
        if (inGroup[id][msg.sender]) revert AlreadyIn();
        _addToGroup(id, msg.sender);
    }

    /// @param groupId 0 for a room that belongs to no group.
    function createRoom(string calldata name, uint64 groupId) external returns (uint64 id) {
        _checkName(name);
        if (groupId != 0 && groupId > _groups.length) revert NoGroup();
        _rooms.push(Room({name: name, creator: msg.sender, groupId: groupId, createdAt: uint64(block.timestamp)}));
        id = uint64(_rooms.length);
        if (groupId != 0) _groupRooms[groupId].push(id);
        emit RoomCreated(id, groupId, msg.sender, name);
        _addToRoom(id, msg.sender);
    }

    function joinRoom(uint64 id) external {
        if (id == 0 || id > _rooms.length) revert NoRoom();
        if (inRoom[id][msg.sender]) revert AlreadyIn();
        _addToRoom(id, msg.sender);
    }

    function postToGroup(uint64 id, string calldata text) external {
        if (id == 0 || id > _groups.length) revert NoGroup();
        if (!inGroup[id][msg.sender]) revert NotMember();
        _checkText(text);
        _groupChat[id].push(Post({from: msg.sender, at: uint64(block.timestamp), text: text}));
        emit GroupPosted(id, msg.sender, text);
    }

    function postToRoom(uint64 id, string calldata text) external {
        if (id == 0 || id > _rooms.length) revert NoRoom();
        if (!inRoom[id][msg.sender]) revert NotMember();
        _checkText(text);
        _roomChat[id].push(Post({from: msg.sender, at: uint64(block.timestamp), text: text}));
        emit RoomPosted(id, msg.sender, text);
    }

    /* ----------------------------------------------------------------- reading */

    function groupCount() external view returns (uint256) {
        return _groups.length;
    }

    function roomCount() external view returns (uint256) {
        return _rooms.length;
    }

    /// @dev Returns the record itself plus its counts: seven loose values do not fit the
    ///      stack, and a struct is what a caller wants anyway.
    function groupInfo(uint64 id)
        external
        view
        returns (Group memory group, uint256 members, uint256 rooms, uint256 messages)
    {
        if (id == 0 || id > _groups.length) revert NoGroup();
        return (_groups[id - 1], _groupMembers[id].length, _groupRooms[id].length, _groupChat[id].length);
    }

    function roomInfo(uint64 id)
        external
        view
        returns (Room memory room, uint256 members, uint256 messages)
    {
        if (id == 0 || id > _rooms.length) revert NoRoom();
        return (_rooms[id - 1], _roomMembers[id].length, _roomChat[id].length);
    }

    function groupMembers(uint64 id) external view returns (address[] memory) {
        return _groupMembers[id];
    }

    function roomMembers(uint64 id) external view returns (address[] memory) {
        return _roomMembers[id];
    }

    function roomsInGroup(uint64 id) external view returns (uint64[] memory) {
        return _groupRooms[id];
    }

    function groupsOf(address who) external view returns (uint64[] memory) {
        return _groupsOf[who];
    }

    function roomsOf(address who) external view returns (uint64[] memory) {
        return _roomsOf[who];
    }

    /// @notice The last `count` messages, oldest first, which is the order a chat is read in.
    function groupChat(uint64 id, uint256 count) external view returns (Post[] memory) {
        return _tail(_groupChat[id], count);
    }

    function roomChat(uint64 id, uint256 count) external view returns (Post[] memory) {
        return _tail(_roomChat[id], count);
    }

    /* ------------------------------------------------------------------ private */

    function _tail(Post[] storage all, uint256 count) private view returns (Post[] memory out) {
        uint256 n = all.length;
        if (count > n) count = n;
        out = new Post[](count);
        for (uint256 i = 0; i < count; i++) out[i] = all[n - count + i];
    }

    function _checkName(string calldata name) private pure {
        uint256 n = bytes(name).length;
        if (n == 0 || n > MAX_NAME) revert BadName();
    }

    function _checkAvatar(string calldata avatar) private pure {
        if (bytes(avatar).length > MAX_AVATAR) revert BadAvatar();
    }

    function _checkText(string calldata text) private pure {
        uint256 n = bytes(text).length;
        if (n == 0 || n > MAX_TEXT) revert BadText();
    }

    function _addToGroup(uint64 id, address who) private {
        inGroup[id][who] = true;
        _groupMembers[id].push(who);
        _groupsOf[who].push(id);
        emit GroupJoined(id, who);
    }

    function _addToRoom(uint64 id, address who) private {
        inRoom[id][who] = true;
        _roomMembers[id].push(who);
        _roomsOf[who].push(id);
        emit RoomJoined(id, who);
    }
}
