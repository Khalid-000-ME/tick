// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title TickSports — parimutuel markets on real-world events, settled by a signed result
///
/// @notice Deliberately a SEPARATE contract from Tick, not a mode inside it.
///
///         Tick settles a price market by having Pyth verify a signed price on chain, so
///         nobody — including us — can choose the outcome. No sports result is published
///         that way. The scoreboards that carry one (ESPN and friends) hand out plain
///         JSON with no signature, so SOMETHING has to attest it, and here that something
///         is a named key.
///
///         That is a materially weaker promise, and keeping it in its own contract is the
///         point: a reader can see exactly which markets carry a referee and which do not,
///         and Tick's price markets keep their property untouched. `attestor` is public
///         and every settlement emits the signature it accepted, so an attestation can be
///         checked against the public scoreboard by anyone, after the fact, forever.
///
///         What the attestor CANNOT do: move anyone's money, settle a market twice, settle
///         before kickoff, or stop a stale market being voided and refunded by a stranger.
///         Its whole power is choosing between HOME, AWAY and VOID, and being seen doing it.
///
/// @dev Pools are sharded exactly as in Tick, for the same reason: two stakers on the same
///      side must not write the same slot, or Monad re-executes them.
contract TickSports {
    uint256 public constant SHARDS = 64;

    uint8 public constant UNRESOLVED = 0;
    uint8 public constant HOME = 1;
    uint8 public constant AWAY = 2;
    uint8 public constant VOID = 3;

    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice A market IS its terms, as in Tick: there is no creation transaction.
    /// @param eventId keccak256 of the provider and its event id, e.g. ("espn", "401772..").
    /// @param closesAt Staking closes here — kickoff. Settlement may come any time after.
    struct Terms {
        bytes32 eventId;
        uint64 closesAt;
    }

    struct Settlement {
        uint8 outcome;
        uint64 resolvedAt;
        uint16 feeBps;
        uint128 totalHome;
        uint128 totalAway;
    }

    IERC20 public immutable token;
    address public immutable admin;
    /// @notice The key whose signature settles a market. Public on purpose.
    address public attestor;
    address public feeRecipient;
    uint16 public immutable feeBps;
    uint16 public immutable settleBountyBps;
    uint256 public immutable maxSettleBounty;
    /// @notice After this long unsettled, anyone may void the market and refund everyone.
    uint256 public immutable settleWindow;

    mapping(bytes32 => mapping(uint256 => uint256)) public poolHome;
    mapping(bytes32 => mapping(uint256 => uint256)) public poolAway;
    mapping(bytes32 => mapping(address => uint256)) public stakeOf;
    mapping(bytes32 => Settlement) public settlements;
    mapping(address => uint256) public deposits;
    mapping(address => mapping(uint256 => uint256)) public feesShard;

    event AttestorChanged(address attestor);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Staked(
        bytes32 indexed marketId, address indexed user, bool home, uint256 amount, bytes32 eventId, uint64 closesAt
    );
    /// @dev Carries the signature that settled it, so the attestation stays auditable
    ///      against the public scoreboard long after the fact.
    event Settled(
        bytes32 indexed marketId,
        uint8 outcome,
        uint256 totalHome,
        uint256 totalAway,
        address indexed settler,
        uint256 bounty,
        bytes signature
    );
    event Claimed(bytes32 indexed marketId, address indexed user, uint256 payout);

    error NotAdmin();
    error NotOpen();
    error NotClosed();
    error AlreadySettled();
    error NotSettled();
    error SettleWindowOpen();
    error ZeroAmount();
    error InsufficientDeposit();
    error NothingStaked();
    error BadOutcome();
    error BadAttestation();
    error FeeTooHigh();
    error BountyShareTooHigh();
    error PoolOverflow();

    constructor(
        IERC20 _token,
        address _admin,
        address _attestor,
        uint16 _feeBps,
        uint16 _settleBountyBps,
        uint256 _maxSettleBounty,
        uint256 _settleWindow
    ) {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (_settleBountyBps > 5_000) revert BountyShareTooHigh();
        token = _token;
        admin = _admin;
        attestor = _attestor;
        feeRecipient = _admin;
        feeBps = _feeBps;
        settleBountyBps = _settleBountyBps;
        maxSettleBounty = _maxSettleBounty;
        settleWindow = _settleWindow;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice Rotating the attestor cannot touch a market that already settled.
    function setAttestor(address next) external onlyAdmin {
        attestor = next;
        emit AttestorChanged(next);
    }

    function setFeeRecipient(address next) external onlyAdmin {
        feeRecipient = next;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        deposits[msg.sender] += amount;
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        require(ok, "transferFrom failed");
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        uint256 bal = deposits[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > bal) revert InsufficientDeposit();
        deposits[msg.sender] = bal - amount;
        bool ok = token.transfer(msg.sender, amount);
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function marketId(Terms memory t) public pure returns (bytes32) {
        return keccak256(abi.encode(t.eventId, t.closesAt));
    }

    function stakeOn(Terms calldata t, bool home, uint128 amount) external returns (bytes32 id) {
        if (amount == 0) revert ZeroAmount();
        id = marketId(t);
        if (settlements[id].outcome != UNRESOLVED) revert AlreadySettled();
        // Kickoff is exclusive: once the event starts, the market is shut.
        if (block.timestamp >= t.closesAt) revert NotOpen();

        uint256 bal = deposits[msg.sender];
        if (amount > bal) revert InsufficientDeposit();
        unchecked {
            deposits[msg.sender] = bal - amount;
        }

        uint256 shard = _shardOf(msg.sender);
        if (home) {
            poolHome[id][shard] += amount;
            stakeOf[id][msg.sender] += uint256(amount) << 128;
        } else {
            poolAway[id][shard] += amount;
            stakeOf[id][msg.sender] += amount;
        }

        emit Staked(id, msg.sender, home, amount, t.eventId, t.closesAt);
    }

    /// @notice The digest the attestor signs. Public so anyone can rebuild and check it.
    /// @dev Binds chain and contract so a signature cannot be replayed onto another
    ///      deployment of this same code.
    function attestationDigest(Terms memory t, uint8 outcome) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), marketId(t), outcome));
    }

    /// @notice Settle from the attestor's signed result. Permissionless to SUBMIT: anyone
    ///         holding the signature can land it and take the bounty. The attestor decides
    ///         the outcome; it does not decide who profits from posting it.
    function settleAttested(Terms calldata t, uint8 outcome, bytes calldata signature)
        external
        returns (uint8)
    {
        if (outcome != HOME && outcome != AWAY && outcome != VOID) revert BadOutcome();
        bytes32 id = marketId(t);
        Settlement storage s = settlements[id];
        if (s.outcome != UNRESOLVED) revert AlreadySettled();
        if (block.timestamp < t.closesAt) revert NotClosed();

        bytes32 digest = attestationDigest(t, outcome);
        if (_recover(digest, signature) != attestor) revert BadAttestation();

        return _finalise(s, id, outcome, feeBps, signature);
    }

    /// @notice Nobody produced a result in time. Refund everyone. Open forever, to anyone,
    ///         so a silent attestor cannot strand a market.
    function voidStale(Terms calldata t) external {
        bytes32 id = marketId(t);
        Settlement storage s = settlements[id];
        if (s.outcome != UNRESOLVED) revert AlreadySettled();
        if (block.timestamp < uint256(t.closesAt) + settleWindow) revert SettleWindowOpen();
        _finalise(s, id, VOID, 0, "");
    }

    function _finalise(Settlement storage s, bytes32 id, uint8 outcome, uint16 fee, bytes memory signature)
        private
        returns (uint8)
    {
        uint256 th = _sumShards(poolHome[id]);
        uint256 ta = _sumShards(poolAway[id]);

        // A one-sided pool has no counterparty to win from. Refund everyone.
        if (outcome != VOID && (th == 0 || ta == 0)) outcome = VOID;
        if (th > type(uint128).max || ta > type(uint128).max) revert PoolOverflow();

        uint256 bounty;
        uint256 storedHome = th;
        uint256 storedAway = ta;
        if (outcome != VOID) {
            uint256 lose = outcome == HOME ? ta : th;
            bounty = (lose * fee / 10_000) * settleBountyBps / 10_000;
            if (bounty > maxSettleBounty) bounty = maxSettleBounty;
            if (bounty != 0) {
                fee = uint16((lose * fee - bounty * 10_000) / (lose - bounty));
                if (outcome == HOME) storedAway = ta - bounty;
                else storedHome = th - bounty;
                deposits[msg.sender] += bounty;
            }
        }

        s.totalHome = uint128(storedHome);
        s.totalAway = uint128(storedAway);
        s.outcome = outcome;
        s.resolvedAt = uint64(block.timestamp);
        s.feeBps = outcome == VOID ? 0 : fee;

        emit Settled(id, outcome, th, ta, msg.sender, bounty, signature);
        return outcome;
    }

    function claim(bytes32 id) external returns (uint256 payout) {
        Settlement storage s = settlements[id];
        uint8 outcome = s.outcome;
        if (outcome == UNRESOLVED) revert NotSettled();

        uint256 packed = stakeOf[id][msg.sender];
        if (packed == 0) revert NothingStaked();
        stakeOf[id][msg.sender] = 0;

        uint256 mineHome = packed >> 128;
        uint256 mineAway = packed & type(uint128).max;

        if (outcome == VOID) {
            payout = mineHome + mineAway;
        } else {
            (uint256 win, uint256 lose, uint256 mine) = outcome == HOME
                ? (uint256(s.totalHome), uint256(s.totalAway), mineHome)
                : (uint256(s.totalAway), uint256(s.totalHome), mineAway);

            if (mine != 0 && win != 0) {
                uint256 profit = (lose * mine) / win;
                uint256 fee = (profit * s.feeBps) / 10_000;
                if (fee != 0) feesShard[feeRecipient][_shardOf(msg.sender)] += fee;
                payout = mine + profit - fee;
            }
        }

        if (payout == 0) {
            emit Claimed(id, msg.sender, 0);
            return 0;
        }
        deposits[msg.sender] += payout;
        emit Claimed(id, msg.sender, payout);
    }

    function previewClaim(bytes32 id, address user) external view returns (uint256) {
        Settlement storage s = settlements[id];
        if (s.outcome == UNRESOLVED) return 0;
        uint256 packed = stakeOf[id][user];
        if (packed == 0) return 0;
        uint256 mineHome = packed >> 128;
        uint256 mineAway = packed & type(uint128).max;
        if (s.outcome == VOID) return mineHome + mineAway;

        (uint256 win, uint256 lose, uint256 mine) = s.outcome == HOME
            ? (uint256(s.totalHome), uint256(s.totalAway), mineHome)
            : (uint256(s.totalAway), uint256(s.totalHome), mineAway);
        if (mine == 0 || win == 0) return 0;
        uint256 profit = (lose * mine) / win;
        return mine + profit - ((profit * s.feeBps) / 10_000);
    }

    function pools(bytes32 id) external view returns (uint256 homeTotal, uint256 awayTotal) {
        homeTotal = _sumShards(poolHome[id]);
        awayTotal = _sumShards(poolAway[id]);
    }

    function collectFees(uint256[] calldata shards) external returns (uint256 amount) {
        mapping(uint256 => uint256) storage mine = feesShard[msg.sender];
        for (uint256 i; i < shards.length; ++i) {
            uint256 v = mine[shards[i]];
            if (v != 0) {
                mine[shards[i]] = 0;
                amount += v;
            }
        }
        if (amount != 0) deposits[msg.sender] += amount;
    }

    // ---------------------------------------------------------------- internals

    /// @dev ecrecover directly rather than a library: one dependency fewer, and the
    ///      malleability guard matters because a second valid signature for the same
    ///      digest would not change the outcome but would muddy the audit trail.
    function _recover(bytes32 digest, bytes memory signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 vs;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            vs := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (uint256(vs) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // Signed as an eth personal message, which is what a plain wallet signer produces.
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(prefixed, v, r, vs);
    }

    function _shardOf(address a) internal pure returns (uint256) {
        return uint256(uint160(a)) % SHARDS;
    }

    function _sumShards(mapping(uint256 => uint256) storage pool) internal view returns (uint256 total) {
        for (uint256 i; i < SHARDS; ++i) {
            total += pool[i];
        }
    }
}
