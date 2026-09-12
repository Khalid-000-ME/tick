// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TestUSD — settlement asset for Tick on Monad testnet
/// @notice A testnet ERC20 with an open faucet, so anyone joining a live session can
///         fund themselves without the operator handing out tokens by hand.
///         This is a *testnet asset*, not a stand-in for the product logic: every
///         pool, stake and payout in Tick moves real balances of this token on chain.
contract TestUSD {
    string public constant name = "Tick Test USD";
    string public constant symbol = "tUSD";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @dev Per-address faucet allotment and cooldown, so one person cannot drain it.
    uint256 public constant FAUCET_AMOUNT = 500e6;
    uint256 public constant FAUCET_COOLDOWN = 6 hours;
    mapping(address => uint256) public lastClaim;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FaucetClaimed(address indexed to, uint256 amount);

    error CooldownActive(uint256 availableAt);

    /// @notice Claim testnet tokens. Anyone, every FAUCET_COOLDOWN.
    function claim() external {
        uint256 next = lastClaim[msg.sender] + FAUCET_COOLDOWN;
        if (lastClaim[msg.sender] != 0 && block.timestamp < next) {
            revert CooldownActive(next);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Seed a participant directly — used by the operator when running a
    ///         live session so people are not waiting on a cooldown at the venue.
    function seed(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) private {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}
