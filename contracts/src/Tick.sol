// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IPyth} from "./interfaces/IPyth.sol";

/// @title Tick — thirty-second parimutuel event contracts with a stale-price cutoff
///
/// @notice "Will BTC/USD be at or above $X when this window closes?" Windows are 30
///         seconds. Settlement reads Pyth. Nobody reports anything.
///
/// @dev FIVE DESIGN DECISIONS.
///
///      1. NO TRUSTED PARTY IN THE OUTCOME PATH. The terms of a market are
///         (feedId, strike, expo, closesAt) and the id is their hash, so the market is
///         entirely self-describing. Settlement compares a Pyth price to the strike.
///         There is no reporter, no operator signature, no bond and no dispute window,
///         because there is no judgement to make. The only trust assumptions are Pyth
///         for prices and the admin for which feeds and grids are listed — and the
///         admin cannot touch an outcome.
///
///      2. NOTHING IS CREATED. Terms arrive as calldata and are checked by recomputing
///         the id, so a market has no creation step and the first staker writes no
///         shared market slot. An earlier design created markets lazily from a signed
///         definition; that made the first staker write markets[id] while every other
///         stake in that block read it — four measured read-after-write conflicts, on
///         the busiest moment of a 30-second market. Here the problem does not exist.
///
///      3. THE STALE-PRICE CUTOFF. A stake is accepted only if the on-chain Pyth price
///         is younger than `acceptMargin`. This is the real defence, and the problem it
///         solves is real money: when the chain's price lags the outside world, anyone
///         who can see the true price first stakes into the gap and takes it from
///         everyone who staked earlier. Parimutuel makes that worse than a priced book,
///         because a late informed stake pays no price impact at all — it joins the
///         winning side at close and takes a pro-rata share of the losing pool for free.
///
///         WHY THIS NEEDS A FAST CHAIN, and what the number actually is. The gate can
///         never be tighter than how stale the price already is when a stake is included:
///         (age of the price when it reached the chain) + (time for the staker's own
///         transaction to land). Both were MEASURED on Monad testnet over a public RPC,
///         in app/scripts/measure-latency.ts:
///
///           submit -> receipt                      p50 2.0s, p95 2.2s, max 3.5s
///           on-chain price age 1 block after a
///             refresh                              min 2s, p50 3s, max 6s
///           => acceptMargin                        6 + 3 + 1 = 10s
///
///         A first version used 2s, which is BELOW Monad's own inclusion latency, so the
///         second stake of a pair reverted every time. The margin is an empirical quantity
///         set by the chain, not a preference.
///
///         HONEST BOUNDS, all three:
///           - ~10s is COMPARABLE TO the 5-10s acceptance delay sportsbooks already use.
///             It is not tighter than existing practice. What differs is that it is
///             enforced by the contract instead of applied at an operator's discretion,
///             and it is a published number instead of a private one.
///           - The comparison that does favour Monad is relative: the same arithmetic on a
///             12-second chain gives >= 24s, because inclusion alone costs one or two
///             blocks. Roughly 2-4x tighter, measured rather than asserted.
///           - It narrows the exposure window; it does not eliminate latency arbitrage,
///             and it trusts Pyth to publish honestly.
///
///         A keeper refreshing continuously lowers the first term and so permits a tighter
///         margin, at the cost of one transaction per refresh. Integrity here is a
///         recurring gas bill, which is only affordable on a cheap, fast chain.
///
///      4. SHARDED POOLS. Stakers on the same market write different slots.
///
///      5. SETTLEMENT PAYS FOR ITSELF. Settling is permissionless but costs real gas
///         (it sums every shard: ~1.2M gas measured on Monad, whose cold storage reads are
///         dearer than Ethereum's). If nothing paid the caller, nobody would call it and
///         the only party who would is whoever runs the product — a liveness dependency
///         on an operator. So the settler is paid a bounty out of the fee the market
///         already charges. It is carved out of the losing pool at settlement and the
///         fee rate on winners is lowered so their total deduction never exceeds the
///         published fee: nobody pays more, the fee is just split. A market whose fee
///         cannot cover a bounty pays none, and if nobody settles it voidStale refunds
///         everyone — failing safe rather than failing silent.
///
///         settleWithUpdate lets the settler supply Pyth's signed update for the close
///         itself. The price is then verified for the exact window [closesAt,
///         closesAt + tolerance] and nothing is written to Pyth, so a market can be
///         settled correctly at any time within settleWindow, not only in the seconds
///         after close, and without contending with anything.
///
///      CONCURRENCY, measured the way Monad actually behaves. Monad re-executes a
///      transaction when a slot it READ was WRITTEN by an earlier transaction in the
///      same block, so the quantity that matters is reads(txB) INTERSECT writes(txA),
///      not the overlap of two write sets. Diffing storage after the fact sees only
///      writes and is structurally blind to this.
///
///      Steady state, two stakers on one market:
///        stakeOn writes deposits[sender] (own), one pool shard, one stake slot.
///        claim   writes the stake slot (own), deposits (own), one fee shard.
///
///      Residual dependencies, which are real and are NOT removed:
///        a. Pyth's price slot. Stakes READ it; whoever refreshes it WRITES it. A stake
///           in the same block as a refresh re-executes. This is why Tick never calls
///           updatePriceFeeds on the staking path: if every stake refreshed the price,
///           every stake would contend and the sharding would buy nothing. Refresh in
///           one block, stake in the next.
///        b. Shard collisions. shard = address % SHARDS, so two stakers on the same side
///           collide with birthday-paradox probability: ~10 colliding pairs among 30
///           participants over 64 shards. Measured, never claimed away.
///        c. Claims in the settle block read totals that settlement just wrote.
contract Tick {
    // ---------------------------------------------------------------- constants

    /// @dev Pool shards per market. Higher = less contention, more gas to sum at
    ///      settlement (one cold SLOAD each). 64 is the tested default.
    uint256 public constant SHARDS = 64;

    uint8 public constant UNRESOLVED = 0;
    uint8 public constant ABOVE = 1;
    uint8 public constant BELOW = 2;
    uint8 public constant VOID = 3;

    uint256 public constant MAX_FEE_BPS = 500; // 5%

    // ---------------------------------------------------------------- types

    /// @notice A market, in full. Never stored: the id is the hash of these fields, so
    ///         supplying them and recomputing the id proves which market is meant.
    struct Terms {
        bytes32 feedId;
        /// @dev Strike in the feed's own units (see `expo`). Must sit on the feed's grid.
        int64 strike;
        /// @dev The feed exponent these terms assume. If Pyth ever reports a different
        ///      exponent the strike would silently change meaning, so the market voids.
        int32 expo;
        /// @dev Window close, which must sit on the feed's window grid.
        uint64 closesAt;
    }

    /// @notice Written once, at settlement.
    struct Settlement {
        // slot 0 — 8 + 64 + 64 + 16 = 152 bits
        uint8 outcome;
        uint64 resolvedAt;
        int64 settlePrice;
        /// @dev Captured here at settlement rather than read live at claim time. Two
        ///      reasons: claim then needs no extra storage lookup and no shared write,
        ///      and an admin cannot change the fee on a market that already settled.
        uint16 feeBps;
        // slot 1. The LOSING side is stored net of the settler's bounty, because this is
        // what payouts are computed from. The raw totals are in the Settled event.
        uint128 totalAbove;
        uint128 totalBelow;
    }

    /// @notice Which feeds are listed, and the grid their markets must sit on.
    /// @dev The grid is what keeps a permissionless market space from fragmenting.
    ///      Parimutuel needs both sides of one pool; if everyone invents their own
    ///      strike, every pool is one-sided and every market voids. Quantising strikes
    ///      and window closes makes independent participants converge on the same few
    ///      markets without anyone coordinating.
    struct FeedConfig {
        bool enabled;
        /// @dev Strikes must be an exact multiple of this, in feed units.
        int64 strikeStep;
        /// @dev Window closes must be an exact multiple of this, in seconds.
        uint32 windowSeconds;
        /// @dev Settlement price must be published within this many seconds after close.
        uint32 settleTolerance;
        uint16 feeBps;
    }

    // ---------------------------------------------------------------- storage

    IERC20 public immutable token;
    IPyth public immutable pyth;
    address public immutable admin;

    /// @notice How stale the on-chain price may be when a stake is accepted. THE residual
    ///         latency-arbitrage window, so it is a headline number rather than a tuning
    ///         knob. Immutable on purpose: it is the contract's security parameter, and an
    ///         admin who could widen it could reopen the window it exists to close.
    ///         Derived from measurement, not taste -- see the header.
    uint256 public immutable acceptMargin;

    /// @notice After this long past close with no settlement price, anyone may void.
    uint256 public immutable settleWindow;

    /// @notice Share of a market's fee paid to whoever settles it, in basis points of the
    ///         fee (not of the pool). Capped at half so the fee recipient always keeps some.
    uint16 public immutable settleBountyBps;

    /// @notice Absolute ceiling on one settlement bounty, in token units. Bounds what a
    ///         single large pool can pay out, so settling is worth doing but never a prize.
    uint256 public immutable maxSettleBounty;

    address public feeRecipient;

    mapping(bytes32 => FeedConfig) public feeds;
    mapping(bytes32 => Settlement) public settlements;

    /// @dev marketId => shard => amount. The hot path.
    mapping(bytes32 => mapping(uint256 => uint256)) public poolAbove;
    mapping(bytes32 => mapping(uint256 => uint256)) public poolBelow;

    /// @dev marketId => user => packed(above:128 | below:128). One slot per user/market.
    mapping(bytes32 => mapping(address => uint256)) public stakeOf;

    /// @dev Internal balance. Deposit once, then every stake is a single call.
    mapping(address => uint256) public deposits;

    /// @dev recipient => shard => fees, sharded by CLAIMANT. An unsharded
    ///      feesAccrued[recipient] made every winning claim in the system contend on one
    ///      slot, including claims on unrelated markets.
    mapping(address => mapping(uint256 => uint256)) public feesShard;

    // ---------------------------------------------------------------- events

    event FeedListed(bytes32 indexed feedId, int64 strikeStep, uint32 windowSeconds, uint16 feeBps);
    event FeedDelisted(bytes32 indexed feedId);
    event FeeRecipientChanged(address recipient);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    /// @dev Carries the market's terms, not just its id. The chain stores only the hash, so
    ///      without these an outside settler or indexer sees "someone staked in market
    ///      0x…" and cannot work out which feed, strike or close that was — and so cannot
    ///      settle it. Emitting them is what makes permissionless settlement discoverable.
    event Staked(
        bytes32 indexed marketId,
        address indexed user,
        bool above,
        uint256 amount,
        int64 priceAtStake,
        uint64 priceAge,
        bytes32 feedId,
        int64 strike,
        uint64 closesAt
    );
    /// @dev totalAbove/totalBelow are the RAW pool totals. The stored settlement carries the
    ///      losing side net of `bounty`, which is what payouts are computed from.
    event Settled(
        bytes32 indexed marketId,
        uint8 outcome,
        int64 settlePrice,
        uint256 totalAbove,
        uint256 totalBelow,
        address indexed settler,
        uint256 bounty
    );
    event Claimed(bytes32 indexed marketId, address indexed user, uint256 payout);

    // ---------------------------------------------------------------- errors

    error NotAdmin();
    error FeedNotListed(bytes32 feedId);
    error OffStrikeGrid(int64 strike, int64 step);
    error OffWindowGrid(uint64 closesAt, uint32 windowSeconds);
    error ExpoMismatch(int32 expected, int32 actual);
    error NotOpen();
    error AlreadySettled();
    error NotClosed();
    error PriceTooStale(uint256 publishTime, uint256 margin);
    error NoSettlementPrice(uint256 publishTime, uint64 closesAt);
    error SettleWindowOpen();
    error ZeroAmount();
    error InsufficientDeposit();
    error NothingStaked();
    error NotSettled();
    error FeeTooHigh();
    error BadGrid();
    error PoolOverflow();
    error BountyShareTooHigh();
    error InsufficientUpdateFee(uint256 sent, uint256 required);
    error RefundFailed();
    error BadUpdate();

    // ---------------------------------------------------------------- ctor

    constructor(
        IERC20 _token,
        IPyth _pyth,
        address _admin,
        uint256 _acceptMargin,
        uint256 _settleWindow,
        uint16 _settleBountyBps,
        uint256 _maxSettleBounty
    ) {
        if (_settleBountyBps > 5_000) revert BountyShareTooHigh();
        settleBountyBps = _settleBountyBps;
        maxSettleBounty = _maxSettleBounty;
        token = _token;
        pyth = _pyth;
        admin = _admin;
        acceptMargin = _acceptMargin;
        settleWindow = _settleWindow;
        feeRecipient = _admin;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------- admin

    /// @notice List a feed and fix the grid its markets sit on.
    /// @dev This is the admin's entire power. It cannot influence any outcome.
    function listFeed(
        bytes32 feedId,
        int64 strikeStep,
        uint32 windowSeconds,
        uint32 settleTolerance,
        uint16 feeBps
    ) external onlyAdmin {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (strikeStep <= 0 || windowSeconds == 0 || settleTolerance == 0) revert BadGrid();
        if (!pyth.priceFeedExists(feedId)) revert FeedNotListed(feedId);

        feeds[feedId] = FeedConfig({
            enabled: true,
            strikeStep: strikeStep,
            windowSeconds: windowSeconds,
            settleTolerance: settleTolerance,
            feeBps: feeBps
        });
        emit FeedListed(feedId, strikeStep, windowSeconds, feeBps);
    }

    function delistFeed(bytes32 feedId) external onlyAdmin {
        feeds[feedId].enabled = false;
        emit FeedDelisted(feedId);
    }

    /// @dev Open markets keep settling after a delist: delisting stops new stakes only.
    function setFeeRecipient(address next) external onlyAdmin {
        feeRecipient = next;
        emit FeeRecipientChanged(next);
    }

    // ---------------------------------------------------------------- balances

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        deposits[msg.sender] += amount;
        _pull(msg.sender, amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        uint256 bal = deposits[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > bal) revert InsufficientDeposit();
        deposits[msg.sender] = bal - amount;
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- market id

    /// @notice Markets are never registered. Their identity IS their terms.
    function marketId(Terms memory t) public pure returns (bytes32) {
        return keccak256(abi.encode(t.feedId, t.strike, t.expo, t.closesAt));
    }

    // ---------------------------------------------------------------- staking

    /// @notice Stake that the feed will close at or above (`above`) the strike, or below.
    ///
    /// @dev HOT PATH. Writes exactly three slots: deposits[sender], one pool shard, one
    ///      stake slot. Reads Pyth's price slot but never writes it — see the header for
    ///      why that distinction decides whether sharding is worth anything.
    function stakeOn(Terms calldata t, bool above, uint128 amount) external returns (bytes32 id) {
        if (amount == 0) revert ZeroAmount();

        FeedConfig memory cfg = feeds[t.feedId];
        if (!cfg.enabled) revert FeedNotListed(t.feedId);
        _requireOnGrid(t, cfg);

        id = marketId(t);
        if (settlements[id].outcome != UNRESOLVED) revert AlreadySettled();

        // closesAt is exclusive: the final second belongs to settlement, not to staking.
        if (block.timestamp >= t.closesAt) revert NotOpen();

        // THE CUTOFF. Stake against a price the chain has refreshed recently, or not at
        // all. Reverting rather than refunding is deliberate: a refundable late stake
        // still buys a free look at the outcome.
        IPyth.Price memory p = pyth.getPriceUnsafe(t.feedId);
        if (p.expo != t.expo) revert ExpoMismatch(t.expo, p.expo);
        if (block.timestamp > p.publishTime + acceptMargin) {
            revert PriceTooStale(p.publishTime, acceptMargin);
        }

        uint256 bal = deposits[msg.sender];
        if (amount > bal) revert InsufficientDeposit();
        deposits[msg.sender] = bal - amount;

        uint256 shard = _shardOf(msg.sender);
        if (above) {
            poolAbove[id][shard] += amount;
            stakeOf[id][msg.sender] += uint256(amount) << 128;
        } else {
            poolBelow[id][shard] += amount;
            stakeOf[id][msg.sender] += amount;
        }

        _emitStaked(t, id, above, amount, p.price, p.publishTime);
    }

    /// @dev Split out only to stay under the stack limit in stakeOn.
    function _emitStaked(Terms calldata t, bytes32 id, bool above, uint128 amount, int64 price, uint256 publishTime)
        private
    {
        emit Staked(
            id, msg.sender, above, amount, price, uint64(block.timestamp - publishTime), t.feedId, t.strike, t.closesAt
        );
    }

    /// @dev The grid is load-bearing, not cosmetic: see FeedConfig.
    function _requireOnGrid(Terms calldata t, FeedConfig memory cfg) private pure {
        if (t.strike % cfg.strikeStep != 0) revert OffStrikeGrid(t.strike, cfg.strikeStep);
        if (t.closesAt % cfg.windowSeconds != 0) revert OffWindowGrid(t.closesAt, cfg.windowSeconds);
    }

    // ---------------------------------------------------------------- settlement

    /// @notice Settle against the price Pyth has STORED on chain. Permissionless, and
    ///         there is nothing to trust: the outcome is a comparison anyone can recompute.
    ///
    /// @dev The stored price must have been published in [closesAt, closesAt + tolerance].
    ///      Pyth stores only its latest price, so this works only while a refresh from just
    ///      after the close is still the latest one. settleWithUpdate has no such limit.
    function settle(Terms calldata t) external returns (uint8 outcome) {
        (bytes32 id, Settlement storage s, uint16 feeBps, uint32 tolerance) = _beforeSettle(t);

        IPyth.Price memory p = pyth.getPriceUnsafe(t.feedId);
        if (p.expo != t.expo) return _finalise(s, id, VOID, 0, 0);
        if (p.publishTime < t.closesAt || p.publishTime > uint256(t.closesAt) + tolerance) {
            revert NoSettlementPrice(p.publishTime, t.closesAt);
        }

        outcome = p.price >= t.strike ? ABOVE : BELOW;
        return _finalise(s, id, outcome, p.price, feeBps);
    }

    /// @notice Settle by supplying Pyth's signed update for the close. Payable: the caller
    ///         pays Pyth's update fee (1 wei on Monad testnet); any excess is refunded.
    ///
    /// @dev Pyth verifies the signatures and that the price was published within
    ///      [closesAt, closesAt + tolerance], so the outcome is pinned to the exact close
    ///      no matter when this is called, up to settleWindow. Nothing is written to Pyth,
    ///      so this contends with no one. Fetch the update from Hermes at `closesAt`.
    function settleWithUpdate(Terms calldata t, bytes[] calldata updateData)
        external
        payable
        returns (uint8 outcome)
    {
        (bytes32 id, Settlement storage s, uint16 feeBps, uint32 tolerance) = _beforeSettle(t);

        (IPyth.Price memory p, uint256 fee) = _parseClosePrice(t, updateData, tolerance);

        if (p.expo != t.expo) {
            outcome = _finalise(s, id, VOID, 0, 0);
        } else {
            outcome = _finalise(s, id, p.price >= t.strike ? ABOVE : BELOW, p.price, feeBps);
        }

        // Last, after state is final, so a contract caller cannot re-enter a half-settled market.
        uint256 change = msg.value - fee;
        if (change != 0) {
            (bool ok,) = msg.sender.call{value: change}("");
            if (!ok) revert RefundFailed();
        }
    }

    function _beforeSettle(Terms calldata t)
        private
        view
        returns (bytes32 id, Settlement storage s, uint16 feeBps, uint32 tolerance)
    {
        id = marketId(t);
        s = settlements[id];
        if (s.outcome != UNRESOLVED) revert AlreadySettled();
        if (block.timestamp < t.closesAt) revert NotClosed();
        FeedConfig storage cfg = feeds[t.feedId];
        feeBps = cfg.feeBps;
        tolerance = cfg.settleTolerance == 0 ? uint32(settleWindow) : cfg.settleTolerance;
    }

    /// @dev Pays Pyth's fee and returns the price it verified inside [closesAt, closesAt +
    ///      tolerance]. Kept separate from settleWithUpdate to stay under the stack limit.
    function _parseClosePrice(Terms calldata t, bytes[] calldata updateData, uint32 tolerance)
        private
        returns (IPyth.Price memory p, uint256 fee)
    {
        fee = pyth.getUpdateFee(updateData);
        if (msg.value < fee) revert InsufficientUpdateFee(msg.value, fee);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = t.feedId;
        IPyth.PriceFeed[] memory out = pyth.parsePriceFeedUpdates{value: fee}(
            updateData, ids, t.closesAt, uint64(uint256(t.closesAt) + tolerance)
        );
        if (out.length != 1 || out[0].id != t.feedId) revert BadUpdate();
        p = out[0].price;
    }

    /// @notice Nobody settled in time. Refund everyone. Open forever.
    function voidStale(Terms calldata t) external {
        bytes32 id = marketId(t);
        Settlement storage s = settlements[id];
        if (s.outcome != UNRESOLVED) revert AlreadySettled();
        if (block.timestamp < uint256(t.closesAt) + settleWindow) revert SettleWindowOpen();
        // A void pays no fee, so the captured rate is zero.
        _finalise(s, id, VOID, 0, 0);
    }

    function _finalise(Settlement storage s, bytes32 id, uint8 outcome, int64 settlePrice, uint16 feeBps)
        private
        returns (uint8)
    {
        uint256 ta = _sumShards(poolAbove[id]);
        uint256 tb = _sumShards(poolBelow[id]);

        // A one-sided pool has no counterparty to win from. Refund everyone.
        if (outcome != VOID && (ta == 0 || tb == 0)) outcome = VOID;

        // Pools are sums of uint128 stakes across SHARDS slots, so a total can in
        // principle exceed uint128. Truncating would silently mis-price every payout.
        if (ta > type(uint128).max || tb > type(uint128).max) revert PoolOverflow();

        // The settler's bounty, carved from the losing pool BEFORE payouts are computed,
        // so solvency needs no new argument: payouts are bounded by win + (lose - bounty)
        // exactly as before, and the bounty is the part set aside. The fee charged to
        // winners is lowered so bounty + fee never exceeds lose * feeBps / 10_000.
        uint256 bounty;
        uint256 storedAbove = ta;
        uint256 storedBelow = tb;
        if (outcome != VOID) {
            uint256 lose = outcome == ABOVE ? tb : ta;
            bounty = (lose * feeBps / 10_000) * settleBountyBps / 10_000;
            if (bounty > maxSettleBounty) bounty = maxSettleBounty;
            if (bounty != 0) {
                feeBps = uint16((lose * feeBps - bounty * 10_000) / (lose - bounty));
                if (outcome == ABOVE) storedBelow = tb - bounty;
                else storedAbove = ta - bounty;
                deposits[msg.sender] += bounty;
            }
        }

        s.totalAbove = uint128(storedAbove);
        s.totalBelow = uint128(storedBelow);
        s.outcome = outcome;
        s.resolvedAt = uint64(block.timestamp);
        s.settlePrice = settlePrice;
        s.feeBps = outcome == VOID ? 0 : feeBps;

        emit Settled(id, outcome, settlePrice, ta, tb, msg.sender, bounty);
        return outcome;
    }

    // ---------------------------------------------------------------- claiming

    /// @notice Pro-rata parimutuel payout, credited to the internal balance so a winner
    ///         can stake the next window without an ERC20 transfer.
    function claim(bytes32 id) external returns (uint256 payout) {
        Settlement storage s = settlements[id];
        uint8 outcome = s.outcome;
        if (outcome == UNRESOLVED) revert NotSettled();

        uint256 packed = stakeOf[id][msg.sender];
        if (packed == 0) revert NothingStaked();
        stakeOf[id][msg.sender] = 0;

        uint256 mineAbove = packed >> 128;
        uint256 mineBelow = packed & type(uint128).max;

        if (outcome == VOID) {
            payout = mineAbove + mineBelow;
        } else {
            (uint256 win, uint256 lose, uint256 mine) = outcome == ABOVE
                ? (uint256(s.totalAbove), uint256(s.totalBelow), mineAbove)
                : (uint256(s.totalBelow), uint256(s.totalAbove), mineBelow);

            if (mine != 0 && win != 0) {
                // Integer division floors, so sum(payouts) <= pools. The remainder is
                // dust retained by the contract, never a shortfall for the last claimant.
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

    // ---------------------------------------------------------------- fees

    /// @notice Sweep accrued fees out of the given shards. Cold path.
    function collectFees(uint256[] calldata shards) external returns (uint256 amount) {
        mapping(uint256 => uint256) storage mine = feesShard[msg.sender];
        for (uint256 i; i < shards.length; ++i) {
            uint256 v = mine[shards[i]];
            if (v != 0) {
                mine[shards[i]] = 0;
                amount += v;
            }
        }
        if (amount == 0) revert ZeroAmount();
        deposits[msg.sender] += amount;
    }

    function feesAccrued(address who) external view returns (uint256 total) {
        mapping(uint256 => uint256) storage f = feesShard[who];
        for (uint256 i; i < SHARDS; ++i) {
            total += f[i];
        }
    }

    // ---------------------------------------------------------------- views

    /// @notice Live implied probability of ABOVE, in basis points. This is the price.
    function impliedAboveBps(bytes32 id) external view returns (uint256) {
        uint256 ta = _sumShards(poolAbove[id]);
        uint256 tb = _sumShards(poolBelow[id]);
        uint256 total = ta + tb;
        if (total == 0) return 5_000;
        return (ta * 10_000) / total;
    }

    function pools(bytes32 id) external view returns (uint256 aboveTotal, uint256 belowTotal) {
        aboveTotal = _sumShards(poolAbove[id]);
        belowTotal = _sumShards(poolBelow[id]);
    }

    function stakeSplit(bytes32 id, address user) external view returns (uint256 aboveAmt, uint256 belowAmt) {
        uint256 packed = stakeOf[id][user];
        aboveAmt = packed >> 128;
        belowAmt = packed & type(uint128).max;
    }

    /// @notice Whether a stake would be accepted right now, and why not. Lets the UI show
    ///         a live cutoff countdown instead of letting people submit doomed stakes.
    function cutoffStatus(bytes32 feedId)
        external
        view
        returns (bool ok, uint256 priceAge, uint256 margin, int64 price)
    {
        IPyth.Price memory p = pyth.getPriceUnsafe(feedId);
        priceAge = block.timestamp > p.publishTime ? block.timestamp - p.publishTime : 0;
        margin = acceptMargin;
        ok = priceAge <= acceptMargin;
        price = p.price;
    }

    /// @notice What this user would receive if they claimed now.
    function previewClaim(bytes32 id, address user) external view returns (uint256) {
        Settlement storage s = settlements[id];
        if (s.outcome == UNRESOLVED) return 0;

        uint256 packed = stakeOf[id][user];
        if (packed == 0) return 0;
        uint256 mineAbove = packed >> 128;
        uint256 mineBelow = packed & type(uint128).max;

        if (s.outcome == VOID) return mineAbove + mineBelow;

        (uint256 win, uint256 lose, uint256 mine) = s.outcome == ABOVE
            ? (uint256(s.totalAbove), uint256(s.totalBelow), mineAbove)
            : (uint256(s.totalBelow), uint256(s.totalAbove), mineBelow);

        if (mine == 0 || win == 0) return 0;
        uint256 profit = (lose * mine) / win;
        return mine + profit - ((profit * s.feeBps) / 10_000);
    }

    // ---------------------------------------------------------------- internals

    function _shardOf(address a) internal pure returns (uint256) {
        return uint256(uint160(a)) % SHARDS;
    }

    function _sumShards(mapping(uint256 => uint256) storage pool) internal view returns (uint256 total) {
        for (uint256 i; i < SHARDS; ++i) {
            total += pool[i];
        }
    }

    function _pull(address from, uint256 amount) private {
        bool ok = token.transferFrom(from, address(this), amount);
        require(ok, "transferFrom failed");
    }

    function _push(address to, uint256 amount) private {
        bool ok = token.transfer(to, amount);
        require(ok, "transfer failed");
    }
}
