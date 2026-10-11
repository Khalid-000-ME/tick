# Tick runbook

What to watch after launch, where the money sits, and how to top it up.
Everything below is Monad testnet (chain 10143, RPC `https://testnet-rpc.monad.xyz`).

Commands assume `cast` (Foundry) and `DEPLOYER_PK` from `contracts/.env`:

```bash
cd contracts && set -a && . ./.env && set +a
export RPC=https://testnet-rpc.monad.xyz
```

---

## 1. The four wallets, and which one empties first

| What | Address | Pays for | Runs out when |
|---|---|---|---|
| **Operator / admin** | `0x1111d87736c9C90Bb9eAE83297BE83ae990699cE` | Starter gas for new users (0.2 MON each), settling sports markets, lending USDC in e2e scripts | ~40 new users per 8 MON |
| **Gas station** | `0x1FAE6A8F254505480678D80835E19ECB8236490A` | MON sold to users for USDC on the Fund page | 1 MON per USDC spent |
| **Attestor** | `0xB51246F1386163757FA98485A937833784C4d75F` | Nothing. It only signs results, never sends a transaction | Never needs funding |
| **Claude Code demo** | `0x5997a03fCEa3450d4E765076Db13e1A65E3e78D3` | Stakes placed through the MCP server during a demo | Needs MON **and** USDC before any demo |

Check all of them at once:

```bash
USDC=0x534b2f3A21130d7a60830c2Df862319e593943A3
for a in 0x1111d87736c9C90Bb9eAE83297BE83ae990699cE \
         0x1FAE6A8F254505480678D80835E19ECB8236490A \
         0x5997a03fCEa3450d4E765076Db13e1A65E3e78D3; do
  echo "$a  MON=$(cast balance $a --ether --rpc-url $RPC | cut -c1-6)  USDC=$(cast call $USDC 'balanceOf(address)(uint256)' $a --rpc-url $RPC | awk '{print $1/1e6}')"
done
```

### Topping up

**MON** comes free from <https://faucet.monad.xyz> (paste the address).
**USDC** comes free from <https://faucet.circle.com> (choose Monad Testnet).

```bash
# Gas station: a plain MON transfer. It has a payable receive(), nothing else needed.
cast send 0x1FAE6A8F254505480678D80835E19ECB8236490A \
  --value 10ether --rpc-url $RPC --private-key "$DEPLOYER_PK"

# Demo wallet: MON for gas, then USDC to stake with.
cast send 0x5997a03fCEa3450d4E765076Db13e1A65E3e78D3 \
  --value 1ether --rpc-url $RPC --private-key "$DEPLOYER_PK"
cast send $USDC 'transfer(address,uint256)' \
  0x5997a03fCEa3450d4E765076Db13e1A65E3e78D3 20000000 \
  --rpc-url $RPC --private-key "$DEPLOYER_PK"
```

### Gas station settings

Rate is **1 MON per 1 USDC**, capped at **5 USDC** per fill. Both are admin-only and take
effect immediately. `monPerUsdc` is in wei, `maxFill` in USDC units (1e6 = $1).

```bash
# Read what is live now
cast call 0x1FAE6A8F254505480678D80835E19ECB8236490A 'monPerUsdc()(uint256)' --rpc-url $RPC
cast call 0x1FAE6A8F254505480678D80835E19ECB8236490A 'maxFill()(uint256)'    --rpc-url $RPC

# Halve the rate to 0.5 MON per USDC, keep the $5 cap
cast send 0x1FAE6A8F254505480678D80835E19ECB8236490A 'setRate(uint256,uint256)' \
  500000000000000000 5000000 --rpc-url $RPC --private-key "$DEPLOYER_PK"

# Recover MON from the reserve (admin only)
cast send 0x1FAE6A8F254505480678D80835E19ECB8236490A 'withdrawMon(uint256)' \
  1000000000000000000 --rpc-url $RPC --private-key "$DEPLOYER_PK"
```

The USDC users pay goes to the **treasury**, which is currently the operator wallet. So
selling gas slowly converts the operator's MON into USDC. Watch the operator's MON, not
its USDC.

---

## 2. Daily checks

1. **Gas station reserve above ~2 MON.** Below that, fills start failing with
   "the platform gas reserve is low".
2. **Operator above ~2 MON.** Below that, new users get no starter gas and cannot place a
   first stake, and sports markets stop settling.
3. **Pyth key still working.** A dead key breaks every price market:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PYTH_API_KEY" \
     "https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
   ```
   `200` is healthy. `401` means the key is wrong or expired, `403` means the feed is not
   on the plan, and `429` means the rate limit is hit.
4. **Envio indexer reachable.** If it is down, the portfolio and ticker fall back to a
   ~40 second window of chain logs, which looks like "history disappeared".

---

## 3. Things that will bite in production

**Equities are closed most of the week.** Pyth publishes US equities only 9:30 to 16:00
New York, weekdays. Outside those hours TSLA and QQQ freeze, the contract refuses stakes
against a stale price, and the UI greys them out. This is correct behaviour, not a bug.
Tokenized equities would trade 24/7 (see section 4).

**In-play sports markets no longer need sticky sessions.** Scores are derived from ESPN's
play log rather than remembered in server memory, so any number of server instances agree
and settlement works however late it runs. Nothing to configure.

**These still keep state in memory**, which on serverless means each instance has its own
copy. None breaks correctness, they just get less effective as instances multiply:

| Where | Effect if split across instances |
|---|---|
| `/api/gas` rate limits | A user could get the 0.2 MON drip more than once |
| `/api/sports/activity` | The strip may show fewer recent stakes |
| `/api/news` cache | More requests to ESPN and Cointelegraph |

If the gas drip starts getting abused, that is the one to move to a shared store
(Upstash Redis through the Vercel marketplace is the quickest route).

**No automatic settler.** Price markets settle when someone opens their positions, and
anyone can settle later for the bounty. A cron hitting the settle route every minute makes
results land promptly and keeps the leaderboard current. **cron-job.org works for this**,
as does a Vercel cron. It solves *settlement*, not the memory question above.

---

## 4. Adding tokenized equities (TSLAX, NVDAX, …)

Pyth publishes 23 tokenized-equity feeds that trade 24/7, in two families: **xStocks**
(`Crypto.TSLAX/USD`, `NVDAX`, `AAPLX`, `SPYX`, `QQQX`, …) and **Ondo**
(`Crypto.TSLAON/USD`, …). All 23 currently return `403 Not entitled` on our key, so this
is an access question before it is a code question.

1. **Sign in to Pyth Terminal** at <https://pythdata.app>. This is where the API key and
   the plan live.
2. **Check the feed explorer** at <https://pythdata.app/explore> for the symbols you want,
   for example `Crypto.TSLAX/USD`. Note the feed id of each.
3. **Ask for them on your plan.** The docs give no self-serve toggle for restricted feeds,
   so email **data@dourolabs.xyz** with the exact symbols and ids, saying they are for a
   hackathon project on Monad testnet. The Telegram channel
   <https://t.me/Pyth_Network> is faster for a yes/no.
4. **Confirm access** once they reply:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PYTH_API_KEY" \
     "https://hermes.pyth.network/v2/updates/price/latest?ids[]=<FEED_ID>"
   ```
   `200` means it is live.
5. **Then the code side**, which is small and needs no redeploy:
   - add the feeds to `FEEDS` in `app/lib/pyth.ts` (id, symbol, expo, kind)
   - list each on the contract, one transaction per feed:
     ```bash
     cast send 0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2 \
       'listFeed(bytes32,int64,uint32,uint32,uint16)' <FEED_ID> 1 30 20 200 \
       --rpc-url $RPC --private-key "$DEPLOYER_PK"
     ```
   - drop any feed you are replacing with `delistFeed(bytes32)`
   - add the logo to `app/public/asset-icons/`

Because they are a different instrument from the exchange-listed stock, the UI should say
"tokenized TSLA", not "TSLA".

---

## 5. Contract addresses

| Contract | Address |
|---|---|
| Tick (price markets) | `0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2` |
| TickSports | `0x26f9cDA88c70bd3D5b005a91AF754a5fc5aF0cE3` |
| TickProfiles | `0xaD241b9D273462F6DBf67D74c8aDa2B907D91c59` |
| GasStation | `0x1FAE6A8F254505480678D80835E19ECB8236490A` |
| USDC (Circle) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

Explorer: <https://testnet.monadscan.com>

---

## 6. Secrets

Server-only, never prefixed `NEXT_PUBLIC_`, never committed:
`PYTH_API_KEY`, `OPERATOR_PK`, `ATTESTOR_PK`, `TICK_MCP_PK`, `PRIVY_APP_SECRET`,
`DEPLOYER_PK`.

Public by design: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_INDEXER_URL`.

All keys here are testnet-only and hold nothing of value. If one leaks, rotate it and move
the balances; do not reuse any of them on mainnet.
