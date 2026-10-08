// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Pyth surface. Verified against the live Monad testnet deployment at
///         0x2880aB155794e7179c9eE2e38200202908C17B43 (chain 10143):
///         - getPriceNoOlderThan(BTC/USD, 5) reverts 0x19abf40e (StalePrice)
///         - getPriceNoOlderThan(BTC/USD, huge) returns (price, conf, expo, publishTime)
///         - getUpdateFee([]) returns 0; singleUpdateFeeInWei() returns 1
///         - priceFeedExists(Equity.US.AAPL/USD) returns true
interface IPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    /// @notice Latest stored price with NO staleness check. We validate publishTime
    ///         ourselves because the bound we need differs between staking and settling.
    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }

    /// @notice Like parsePriceFeedUpdates, but accepts ONLY the first update published at or
    ///         after minPublishTime: it requires prevPublishTime < minPublishTime <=
    ///         publishTime <= maxPublishTime. Without that, anyone settling could choose
    ///         the most favourable of the many signed prices inside the window. With it
    ///         there is exactly one acceptable price for a given close, so the outcome is
    ///         a fact anyone can recompute. Payable (getUpdateFee); writes no Pyth
    ///         storage. Verified live on Monad testnet with a Hermes update.
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PriceFeed[] memory priceFeeds);

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);

    /// @notice Reverts StalePrice() if the stored price is older than `age`.
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory);

    function priceFeedExists(bytes32 id) external view returns (bool);

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256);

    /// @notice Submits signed updates. Payable: costs getUpdateFee(updateData).
    /// @dev WRITES Pyth's storage. Every caller in the same block contends on the same
    ///      slot, so Tick never calls this on the staking path — see Tick's header.
    function updatePriceFeeds(bytes[] calldata updateData) external payable;
}
