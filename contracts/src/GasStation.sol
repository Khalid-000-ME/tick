// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title GasStation — swap a little USDC for the MON that pays for transactions
///
/// @notice Tick runs on USDC, but every transaction is paid in MON. Asking a new trader to
///         find a second token is where onboarding stalls, so the platform keeps a MON
///         reserve here and sells it for USDC at a published rate, in one transaction: the
///         USDC moves to the treasury and the MON comes back atomically, or neither does.
///
///         No server is involved and nothing can be redeemed twice: the swap is the
///         transaction. The rate is set by the admin and quoted by `quote`; `minMonOut`
///         protects a trader from a rate change between seeing the quote and filling.
contract GasStation {
    IERC20 public immutable usdc;
    address public immutable admin;
    address public treasury;

    /// @notice MON (in wei) given per 1 USDC (1e6 units).
    uint256 public monPerUsdc;
    /// @notice Largest single fill, in USDC units. Keeps the reserve from draining in one go.
    uint256 public maxFill;

    event Filled(address indexed user, uint256 usdcIn, uint256 monOut);
    event RateSet(uint256 monPerUsdc, uint256 maxFill);

    error NotAdmin();
    error BadAmount();
    error Slippage(uint256 out, uint256 minOut);
    error ReserveTooLow(uint256 have, uint256 need);
    error PayoutFailed();

    constructor(IERC20 _usdc, address _admin, address _treasury, uint256 _monPerUsdc, uint256 _maxFill) {
        usdc = _usdc;
        admin = _admin;
        treasury = _treasury;
        monPerUsdc = _monPerUsdc;
        maxFill = _maxFill;
        emit RateSet(_monPerUsdc, _maxFill);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice MON (wei) a fill of `usdcAmount` (1e6 = 1 USDC) returns right now.
    function quote(uint256 usdcAmount) public view returns (uint256) {
        return (usdcAmount * monPerUsdc) / 1e6;
    }

    /// @notice Pay `usdcAmount` USDC (approved to this contract), receive MON in the same
    ///         transaction.
    function fill(uint256 usdcAmount, uint256 minMonOut) external returns (uint256 out) {
        if (usdcAmount == 0 || usdcAmount > maxFill) revert BadAmount();
        out = quote(usdcAmount);
        if (out < minMonOut) revert Slippage(out, minMonOut);
        if (address(this).balance < out) revert ReserveTooLow(address(this).balance, out);

        bool ok = usdc.transferFrom(msg.sender, treasury, usdcAmount);
        require(ok, "transferFrom failed");
        // Last, after the USDC has moved, so a contract caller cannot re-enter half-paid.
        (bool sent,) = msg.sender.call{value: out}("");
        if (!sent) revert PayoutFailed();
        emit Filled(msg.sender, usdcAmount, out);
    }

    function setRate(uint256 _monPerUsdc, uint256 _maxFill) external onlyAdmin {
        monPerUsdc = _monPerUsdc;
        maxFill = _maxFill;
        emit RateSet(_monPerUsdc, _maxFill);
    }

    function setTreasury(address next) external onlyAdmin {
        treasury = next;
    }

    function withdrawMon(uint256 amount) external onlyAdmin {
        (bool ok,) = admin.call{value: amount}("");
        if (!ok) revert PayoutFailed();
    }

    /// @notice The platform tops up the reserve by sending MON here.
    receive() external payable {}
}
