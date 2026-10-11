// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TickProfiles — usernames, display names and avatars for Tick traders
///
/// @notice A profile lives on chain so a username is unique by construction, needs no
///         server or database, and can be shown anywhere an address appears (the
///         leaderboard, a settlement, a trade on the ticker) by reading one view.
///
///         It holds only short strings. The avatar is a reference, never image bytes:
///         either a generated avatar ("gen:<style>:<seed>") or an https URL. Storing images
///         on chain would cost far more than they are worth.
contract TickProfiles {
    struct Profile {
        string username;
        string displayName;
        string avatar;
        uint64 updatedAt;
    }

    uint256 public constant MIN_USERNAME = 3;
    uint256 public constant MAX_USERNAME = 20;
    uint256 public constant MAX_DISPLAY = 40;
    uint256 public constant MAX_AVATAR = 300;

    mapping(address => Profile) private _profiles;
    /// @notice keccak256(username) => who holds it.
    mapping(bytes32 => address) public ownerOf;

    event ProfileSet(address indexed user, string username, string displayName, string avatar);

    error BadUsername();
    error UsernameTaken();
    error TooLong();

    /// @notice Set or update your profile. Usernames are 3 to 20 characters of lowercase
    ///         a-z, 0-9 and underscore, so "Alice" and "alice" cannot both exist. Renaming
    ///         releases the old name for anyone to take.
    function setProfile(string calldata username, string calldata displayName, string calldata avatar) external {
        bytes calldata u = bytes(username);
        if (u.length < MIN_USERNAME || u.length > MAX_USERNAME) revert BadUsername();
        for (uint256 i; i < u.length; ++i) {
            bytes1 c = u[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) revert BadUsername();
        }
        if (bytes(displayName).length > MAX_DISPLAY || bytes(avatar).length > MAX_AVATAR) revert TooLong();

        bytes32 key = keccak256(u);
        address holder = ownerOf[key];
        if (holder != address(0) && holder != msg.sender) revert UsernameTaken();

        bytes memory old = bytes(_profiles[msg.sender].username);
        if (old.length != 0) {
            bytes32 oldKey = keccak256(old);
            if (oldKey != key) delete ownerOf[oldKey];
        }

        ownerOf[key] = msg.sender;
        _profiles[msg.sender] = Profile(username, displayName, avatar, uint64(block.timestamp));
        emit ProfileSet(msg.sender, username, displayName, avatar);
    }

    function profileOf(address user)
        external
        view
        returns (string memory username, string memory displayName, string memory avatar, uint64 updatedAt)
    {
        Profile storage p = _profiles[user];
        return (p.username, p.displayName, p.avatar, p.updatedAt);
    }

    /// @notice True when `username` is valid and free, or already yours.
    function available(string calldata username, address forUser) external view returns (bool) {
        bytes calldata u = bytes(username);
        if (u.length < MIN_USERNAME || u.length > MAX_USERNAME) return false;
        for (uint256 i; i < u.length; ++i) {
            bytes1 c = u[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f)) return false;
        }
        address holder = ownerOf[keccak256(u)];
        return holder == address(0) || holder == forUser;
    }
}
