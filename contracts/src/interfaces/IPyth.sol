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

    /// @notice Verifies signed updates and returns the price of each requested id whose
    ///         publishTime lies in [minPublishTime, maxPublishTime]; reverts if any id has
    ///         none in range. Payable (getUpdateFee). Does NOT write Pyth's storage, so
    ///         using it contends with nobody. Verified live on Monad testnet: called with
    ///         a Hermes update for a past second it returned that second's BTC/USD price.
    function parsePriceFeedUpdates(
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
