/**
 * The gas tank's arithmetic, without a browser or a chain: a trader sees a percentage and a
 * price in USDC, so both have to be right at the edges (empty, nearly full, capped by the
 * per-fill limit, capped by what they hold).
 */
import { FULL_TANK, STAKE_GAS, gasPercent, planFill, type Funds } from "../lib/funds";

const GAS_PRICE = 50_000_000_000n; // 50 gwei
const WEI_PER_USDC = 1_000_000_000_000_000_000n; // 1 USDC buys one of the chain's tokens
const FULL = BigInt(FULL_TANK) * STAKE_GAS * GAS_PRICE;
const station = { maxFill: 1_000_000n, gasPrice: GAS_PRICE, weiPerUsdc: WEI_PER_USDC };
const funds = (mon: bigint, usdc = 10_000_000n): Funds => ({ wallet: usdc, tick: 0n, sports: 0n, total: usdc, mon });

let failed = 0;
const is = (what: string, got: unknown, want: unknown) => {
  const show = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}` : x));
  const ok = show(got) === show(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${show(got)}${ok ? "" : ` (wanted ${show(want)})`}`);
};

is("empty tank reads 0%", gasPercent(0n, GAS_PRICE), 0);
is("dust reads 1%, never 0", gasPercent(1n, GAS_PRICE), 1);
is("half a tank reads 50%", gasPercent(FULL / 2n, GAS_PRICE), 50);
is("a full tank reads 100%", gasPercent(FULL, GAS_PRICE), 100);
is("more than full still reads 100%", gasPercent(FULL * 3n, GAS_PRICE), 100);

const empty = planFill(funds(0n), station)!;
is("filling from empty costs USDC", empty.units > 0n, true);
is("filling from empty reaches 100%", empty.percentAfter, 100);
is("filling from empty is priced in whole cents", empty.units % 10_000n, 0n);
is("a full tank has nothing to fill", planFill(funds(FULL), station), null);

const capped = planFill(funds(0n), { ...station, maxFill: 50_000n })!;
is("the per-fill limit caps the charge", capped.units, 50_000n);
is("a capped fill still moves the tank", capped.percentAfter > 0, true);

const poor = planFill(funds(0n, 30_000n), station)!;
is("someone with 3 cents is charged 3 cents", poor.units, 30_000n);
is("nothing to pay with means no fill offered", planFill(funds(0n, 0n), station), null);

console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
