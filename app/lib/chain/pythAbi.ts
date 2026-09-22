/**
 * Minimal Pyth ABI, hand-written rather than generated because Pyth is a third-party
 * deployment we read and refresh but do not build.
 *
 * Verified against the live Monad testnet contract 0x2880aB155794e7179c9eE2e38200202908C17B43:
 *   getPriceNoOlderThan(BTC/USD, 5)     -> reverts 0x19abf40e (StalePrice)
 *   getPriceNoOlderThan(BTC/USD, huge)  -> (price, conf, expo, publishTime)
 *   singleUpdateFeeInWei()              -> 1
 *   priceFeedExists(Equity.US.AAPL/USD) -> true
 */
export const PythAbi = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPriceNoOlderThan",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "age", type: "uint256" },
    ],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "priceFeedExists",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
  {
    type: "function",
    name: "updatePriceFeeds",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
] as const;
