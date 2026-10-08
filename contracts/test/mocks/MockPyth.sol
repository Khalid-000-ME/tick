// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPyth} from "../../src/interfaces/IPyth.sol";

/// @notice Pyth stand-in whose publishTime the test controls, so the staleness gate can
///         be exercised at its exact boundary.
///
/// @dev Deliberately mirrors the real contract's behaviour on the two things Tick relies
///      on: getPriceUnsafe returns whatever is stored without complaint, and
///      getPriceNoOlderThan reverts StalePrice. Verified against the live Monad testnet
///      deployment, where getPriceNoOlderThan(BTC/USD, 5) reverts 0x19abf40e.
///
///      `updatePriceFeeds` writes ONE slot shared by every caller, exactly as the real
///      one does. The concurrency tests depend on that being faithful: it is the whole
///      reason Tick refreshes the price separately from staking.
contract MockPyth is IPyth {
    error StalePrice();
    error PriceFeedNotFound();
    error PriceFeedNotFoundWithinRange();

    mapping(bytes32 => Price) internal prices;
    mapping(bytes32 => bool) internal exists;
    uint256 public fee = 1;

    /// @dev Bumped by updatePriceFeeds so a shared write is observable even when the
    ///      price value itself is unchanged.
    uint256 public updateCount;

    function set(bytes32 id, int64 price, int32 expo, uint256 publishTime) external {
        prices[id] = Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
        exists[id] = true;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        if (!exists[id]) revert PriceFeedNotFound();
        return prices[id];
    }

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory) {
        if (!exists[id]) revert PriceFeedNotFound();
        Price memory p = prices[id];
        if (block.timestamp > p.publishTime + age) revert StalePrice();
        return p;
    }

    function priceFeedExists(bytes32 id) external view returns (bool) {
        return exists[id];
    }

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        return fee * updateData.length;
    }

    /// @dev Writes the price slot AND a counter, as the real contract writes its own
    ///      storage. Every refresher contends here; that is the point.
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        updateCount += 1;
        for (uint256 i; i < updateData.length; ++i) {
            (bytes32 id, int64 price, int32 expo, uint256 publishTime,) =
                abi.decode(updateData[i], (bytes32, int64, int32, uint256, uint256));
            prices[id] = Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
            exists[id] = true;
        }
    }

    /// @dev Mirrors the real "unique" call: verifies nothing was signed (the mock has no
    ///      signatures) but enforces prevPublishTime < min <= publishTime <= max, so only the
    ///      FIRST update at or after the close is accepted. Like the real one, writes NO storage.
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PriceFeed[] memory out) {
        out = new PriceFeed[](priceIds.length);
        for (uint256 k; k < priceIds.length; ++k) {
            bool found;
            for (uint256 i; i < updateData.length && !found; ++i) {
                (bytes32 id, int64 price, int32 expo, uint256 publishTime, uint256 prev) =
                    abi.decode(updateData[i], (bytes32, int64, int32, uint256, uint256));
                if (
                    id == priceIds[k] && publishTime >= minPublishTime && publishTime <= maxPublishTime
                        && prev < minPublishTime
                ) {
                    Price memory p = Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
                    out[k] = PriceFeed({id: id, price: p, emaPrice: p});
                    found = true;
                }
            }
            if (!found) revert PriceFeedNotFoundWithinRange();
        }
    }

    /// @notice Encodes an update with the given predecessor time (what makes it "first").
    function encodeWithPrev(bytes32 id, int64 price, int32 expo, uint256 publishTime, uint256 prev)
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(id, price, expo, publishTime, prev);
    }

    /// @notice Encodes an update whose predecessor is the previous second, i.e. a price that
    ///         is the first one at or after any time up to its own publishTime.
    function encode(bytes32 id, int64 price, int32 expo, uint256 publishTime) external pure returns (bytes memory) {
        return abi.encode(id, price, expo, publishTime, publishTime == 0 ? 0 : publishTime - 1);
    }
}
