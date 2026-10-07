# Tick

30-second price markets on Monad. Stake **ABOVE** or **BELOW** a strike; when the window closes, the contract reads Pyth and pays the winning side from the losing side. No reporter, no operator signature, no dispute window: the outcome is a comparison anyone can recompute.

## How it works

- **A market is its terms.** `(feedId, strike, expo, closesAt)` hashes to the market id, so there is no "create market" transaction. Windows sit on a 30-second grid and the strike for a window is Pyth's price at window open, served identically to every client by `/api/strike`.
- **Parimutuel.** Winners split the losing pool pro rata, minus a 2% fee on profit. A one-sided market voids and refunds everyone.
- **Settlement is permissionless and paid.** `settleWithUpdate` takes a signed Pyth update for the exact close second and has Pyth verify it, so a market settles correctly whenever someone gets round to it inside the settle window. The caller earns half the market's fee (capped at 2 USDC), so outside bots have a reason to do it. `app/scripts/settler.ts` is one.
- **Fresh-price cutoff.** A stake is only accepted while the on-chain price is within 10 seconds of fresh. This is the residual latency-arbitrage window, and it is on screen rather than hidden.
- **Built for Monad's parallelism.** Pools are sharded 64 ways. `contracts/test/Concurrency.t.sol` measures read-after-write conflicts directly and finds none between stakers.
- **Pyth is a pull oracle,** so the chart reads Hermes off chain for free. An on-chain price update is posted only just before a stake, never on a timer.

## Deployment (Monad testnet, chain 10143)

| | |
|---|---|
| Tick | `0x8F6a59d397499636f8ff2Ed367DE1a8484b1b0cf` |
| Stake token | Circle USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals) |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| Feeds | BTC/USD, ETH/USD, SOL/USD, TSLA |

## Pieces

| Path | What it is |
|---|---|
| `contracts/` | Foundry project: `Tick.sol`, 48 tests (staking, settlement, solvency fuzzing, concurrency, bounty), deploy scripts |
| `app/` | Next.js 16 app: trading terminal, `/portfolio`, `/fund`, API routes for strike, live price, price posting and settlement |
| `indexer/` | Envio HyperIndex over `Staked`, `Settled`, `Claimed`. The RPC caps `getLogs` at about 100 blocks, so wallet history is read from this index |

Sign-in is Privy (email or passkey, with an embedded wallet). Wins are credited to the Tick balance automatically; voided stakes are refunded from the Portfolio page.

## Run it

```bash
# contracts
cd contracts && forge test

# app (needs app/.env.local, see below)
cd app && npm install && npm run dev

# indexer (Docker for local dev, or deploy `indexer/` on Envio Cloud)
cd indexer && npm install && npm run codegen && npm run dev
```

`app/.env.local` (names only; never commit values, never add a `NEXT_PUBLIC_` prefix to the secrets):

| Variable | Notes |
|---|---|
| `OPERATOR_PK` | Server-only. Pays gas for price posts and settlement; testnet key only |
| `PYTH_API_KEY` | Server-only. Hermes requires a bearer token |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public by design |
| `PRIVY_APP_SECRET` | Server-only |
| `NEXT_PUBLIC_INDEXER_URL` | Envio GraphQL endpoint; public. Unset, history falls back to this browser |

Fund a wallet with MON at faucet.monad.xyz and USDC at faucet.circle.com (choose Monad Testnet).

## Proven on chain

- `app/scripts/bounty-e2e.ts`: two stakers, an outside settler holding only MON. The settler earned exactly half the 2% fee in USDC, and payouts plus fee plus bounty accounted for the whole stake.
- `app/scripts/browser-flow.ts`: replays the UI's exact approve, deposit, stake, settle, claim path from a cold wallet.
- `app/scripts/settler.ts`: a standalone bot that discovers closed markets from `Staked` events and settles them.

## Limits worth knowing

- Testnet only. Card purchases of USDC are not offered; they would need a mainnet and a payments provider that permits wagering.
- Stakes are refused if the on-chain price is stale. That is the cutoff working, not a fault. TSLA only moves while US markets are open.
- The fee-recipient, feed listing and admin keys cannot influence any outcome.
