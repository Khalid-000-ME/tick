// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickSocial — groups and rooms, on chain
///
/// @notice Who is playing with whom, kept where the results are. A room's table is already
///         trustless because every stake and claim is on chain; holding membership here
///         makes the other half checkable too, so nobody has to trust a server's list of
///         who was in a contest.
///
///         A group is a standing crowd. A room is a contest, and it can sit inside a group
///         or stand on its own behind its invite link, so sharing a room with four friends
///         never means founding a community first.
///
///         Ids start at 1, so 0 means "no group" on a room that belongs to nobody. Only
///         short names are stored; everything a room displays about money is read from the
///         market contracts, never written here.
contract TickSocial {
    struct Group {
        string name;
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

    uint256 public constant MAX_NAME = 40;

    Group[] private _groups;
    Room[] private _rooms;

    mapping(uint64 => address[]) private _groupMembers;
    mapping(uint64 => address[]) private _roomMembers;
    mapping(uint64 => uint64[]) private _groupRooms;
    mapping(address => uint64[]) private _groupsOf;
    mapping(address => uint64[]) private _roomsOf;

    /// @notice Membership, the cheap way to ask.
    mapping(uint64 => mapping(address => bool)) public inGroup;
    mapping(uint64 => mapping(address => bool)) public inRoom;

    event GroupCreated(uint64 indexed id, address indexed creator, string name);
    event GroupJoined(uint64 indexed id, address indexed member);
    event RoomCreated(uint64 indexed id, uint64 indexed groupId, address indexed creator, string name);
    event RoomJoined(uint64 indexed id, address indexed member);

    error BadName();
    error NoGroup();
    error NoRoom();
    error AlreadyIn();

    /* ----------------------------------------------------------------- writing */

    function createGroup(string calldata name) external returns (uint64 id) {
        _checkName(name);
        _groups.push(Group({name: name, creator: msg.sender, createdAt: uint64(block.timestamp)}));
        id = uint64(_groups.length);
        emit GroupCreated(id, msg.sender, name);
        _addToGroup(id, msg.sender);
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

    /* ----------------------------------------------------------------- reading */

    function groupCount() external view returns (uint256) {
        return _groups.length;
    }

    function roomCount() external view returns (uint256) {
        return _rooms.length;
    }

    function groupInfo(uint64 id)
        external
        view
        returns (string memory name, address creator, uint64 createdAt, uint256 members, uint256 rooms)
    {
        if (id == 0 || id > _groups.length) revert NoGroup();
        Group storage g = _groups[id - 1];
        return (g.name, g.creator, g.createdAt, _groupMembers[id].length, _groupRooms[id].length);
    }

    function roomInfo(uint64 id)
        external
        view
        returns (string memory name, address creator, uint64 groupId, uint64 createdAt, uint256 members)
    {
        if (id == 0 || id > _rooms.length) revert NoRoom();
        Room storage r = _rooms[id - 1];
        return (r.name, r.creator, r.groupId, r.createdAt, _roomMembers[id].length);
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

    /* ------------------------------------------------------------------ private */

    function _checkName(string calldata name) private pure {
        uint256 n = bytes(name).length;
        if (n == 0 || n > MAX_NAME) revert BadName();
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
