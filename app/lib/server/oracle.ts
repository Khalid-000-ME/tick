import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PythAbi } from "@/lib/chain/pythAbi";
import { CONTRACTS, monadTestnet } from "@/lib/chain/config";
import { fetchPriceUpdate, type FeedSpec } from "@/lib/pyth";

/**
 * Posts signed Pyth prices on chain, paid by the operator key. Shared by the refresh
 * route (keeps the cutoff open) and the settle route (a settlement needs a price
 * published AFTER the close, so settle must be able to post one itself).
 *
 * SERVER ONLY: needs PYTH_API_KEY and a funded key.
 *
 * COST IS THE CONSTRAINT. Measured: ~176k gas for one feed, ~257k for four, at ~102 gwei
 * that is 0.018 and 0.026 MON per post. Monad charges the gas LIMIT, so a wallet holding
 * less than limit x price has the transaction rejected by the RPC with the unhelpful
 * "Missing or invalid parameters" — which is what an empty operator wallet looked like.
 * So the balance is checked first and reported in words.
 */
/**
 * Sized to the measured cost, because Monad charges the limit rather than gas used:
 * ~176k for one feed and ~257k for four, so base + per-feed with ~15% headroom.
 */
const gasLimitFor = (feedCount: number) => 170_000n + 35_000n * BigInt(feedCount);

export class OperatorUnfundedError extends Error {
  constructor(public have: bigint, public need: bigint, public address: string) {
    super(
      `The operator wallet ${address} is out of MON (has ${(Number(have) / 1e18).toFixed(4)}, ` +
        `needs about ${(Number(need) / 1e18).toFixed(4)} per price post). Fund it at faucet.monad.xyz.`
    );
  }
}

function operatorKey(): `0x${string}` {
  const key = process.env.OPERATOR_PK ?? process.env.DEPLOYER_PK;
  if (!key) throw new Error("OPERATOR_PK (or DEPLOYER_PK) is not set on the server");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

export const pub = createPublicClient({ chain: monadTestnet, transport: http() });

/**
 * Posts only what is worth paying for. Returns null — spending nothing — when Hermes has
 * nothing newer than what the chain already holds, which is the normal state for a US
 * equity outside market hours and for two clients asking at the same moment.
 */
export async function postPrices(feeds: readonly FeedSpec[]) {
  const account = privateKeyToAccount(operatorKey());
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });

  const update = await fetchPriceUpdate(feeds.map((f) => f.id));

  const stored = await Promise.all(
    feeds.map(
      (f) =>
        pub.readContract({ address: CONTRACTS.pyth, abi: PythAbi, functionName: "getPriceUnsafe", args: [f.id] }) as Promise<{
          publishTime: bigint;
        }>
    )
  );
  const newer = update.parsed.some((p, i) => {
    const idx = feeds.findIndex((f) => f.id.toLowerCase() === p.id.toLowerCase());
    return idx >= 0 && BigInt(p.publishTime) > stored[idx].publishTime;
  });
  if (!newer) return null;

  const gas = gasLimitFor(feeds.length);
  const [balance, gasPrice] = await Promise.all([pub.getBalance({ address: account.address }), pub.getGasPrice()]);
  const need = gas * gasPrice;
  if (balance < need) throw new OperatorUnfundedError(balance, need, account.address);

  const fee = (await pub.readContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "getUpdateFee",
    args: [update.updateData],
  })) as bigint;

  const hash = await wallet.writeContract({
    address: CONTRACTS.pyth,
    abi: PythAbi,
    functionName: "updatePriceFeeds",
    args: [update.updateData],
    value: fee,
    gas,
    account,
    chain: monadTestnet,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}
