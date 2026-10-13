# Tick

**The world's first 30-second prediction market, played with your friends.**
Start a room, call the same thirty seconds as your crew, race a live scoreboard, and post the card that proves what you made. Every result is read from chain, so nobody can fake a win.

Live at **[tick-predict.xyz](https://tick-predict.xyz)** · Android APK in `mobile/dist/tick.apk`

## What it does

- **Call a window.** Will this price be higher thirty seconds from now? Stake **ABOVE** or **BELOW** from ten cents. Crypto, equities and sport.
- **Compete in a group.** Make a group, open rooms inside it, pick the market everyone calls, and watch a live scoreboard re-sort as each window settles.
- **Flex the proof.** A win draws a card from your real record, verified against the chain, and posts to the group chat or the public feed.
- **No seed phrase.** Sign in with Google, a passkey, email or X. Gas is abstracted: you top up a percentage bar, never a native token.

## How the market works

- **A market is its terms.** `(feedId, strike, expo, closesAt)` hashes to the market id, so there is no "create market" transaction. Windows sit on a 30-second grid and the strike for a window is Pyth's price at window open, served identically to every client by `/api/strike`.
- **Parimutuel.** Winners split the losing pool pro rata, minus a 2% fee on profit. A one-sided market voids and refunds everyone.
- **Settlement is permissionless and paid.** `settleWithUpdate` takes a signed Pyth update for the exact close second and has Pyth verify it, so a market settles correctly whenever someone gets round to it inside the settle window. The caller earns half the market's fee (capped at 2 USDC). The app's own settler waits 10 seconds after the close (`SETTLE_GRACE_S`) so an outside bot gets first shot at the bounty; `/settlers` shows who won.
- **No reporter, no dispute window.** The outcome is a comparison anyone can recompute.
- **Fresh-price cutoff.** A stake is only accepted while the on-chain price is within 10 seconds of fresh. This is the residual latency-arbitrage window, and it is on screen rather than hidden.
- **Pyth is a pull oracle,** so the chart reads Hermes off chain for free. An on-chain price update is posted only just before a stake, never on a timer.

## Why a parallel chain

A thirty-second market only works if settlement, staking and every social write land in seconds and cost a fraction of a cent. Serial execution cannot carry it: at the close of a window, every settlement, claim and scoreboard write arrives at once.

Tick is built for that. Pools are sharded 64 ways so stakers never touch the same slot, and `contracts/test/Concurrency.t.sol` measures read-after-write conflicts directly and finds none between stakers. The same design is what makes the Solana port natural: independent accounts per shard, per room and per post, so the whole close-of-window burst is parallelisable.

## Deployments

**Monad testnet (chain 10143)** — live, this is what the app runs against today.

| | |
|---|---|
| Tick | `0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2` |
| TickSocial (groups, rooms, chat) | `0x26307B3c17A0a1e3Fb381c70D7F9584D933a3129` |
| TickFeed (posts, photos, likes) | `0x26608eDF8e677431fFDDda4d1630D6B99d383433` |
| TickProfiles | `0xaD241b9D273462F6DBf67D74c8aDa2B907D91c59` |
| TickSports | `0x26f9cDA88c70bd3D5b005a91AF754a5fc5aF0cE3` |
| GasStation | `0x1FAE6A8F254505480678D80835E19ECB8236490A` |
| Stake token | Circle USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals) |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| Feeds | BTC/USD, ETH/USD, SOL/USD, TSLA |

Explorer: [testnet.monadscan.com](https://testnet.monadscan.com)

**Solana devnet** — in progress. The market and social programs are being ported now; addresses land in this table as each one deploys, and no claim of a live Solana deployment is made until they do.

## Pieces

| Path | What it is |
|---|---|
| `contracts/` | Foundry project: `Tick.sol`, `TickSocial.sol`, `TickFeed.sol`, `TickProfiles.sol`, `TickSports.sol`, `GasStation.sol`, plus tests for staking, settlement, solvency fuzzing, concurrency and the settler bounty |
| `app/` | Next.js 16 app: feed, groups, rooms, trading terminal, leaderboard, `/portfolio`, `/fund`, and API routes for strike, live price, price posting, settlement and standings |
| `indexer/` | Envio HyperIndex over the market and social events. The RPC caps `getLogs` at about 100 blocks, so history is read from this index |
| `mobile/` | Android wrapper (Trusted Web Activity, package `app.tick.mobile`) and the signed release APK |
| `media/` | Demo video, launch video and the dApp Store art |
| `submission/` | Hackathon and dApp Store answers, and the pitch deck PDF |

### On-chain social

Groups, rooms, members, avatars and chat live in `TickSocial` storage. Feed posts keep their photo bytes in the event log and the post records the block it landed in, so a photo is recovered with one contract read and one single-block log query. Nothing social is held in a database of ours.

Sign-in is Privy (Google, passkey, email or X, with an embedded wallet). Wins are credited to the Tick balance automatically; voided stakes are refunded from the Portfolio page.

## Licence, tools and attribution

MIT, in `LICENSE`. The code is ours and is public.

**AI tools.** Claude Code was used throughout this build, as an engineering tool: writing and
reviewing Solidity, the Anchor port, the app, and the test harnesses, alongside us. Every design
decision and every line that shipped was ours to accept or reject.

**External code and services.** Pyth Network for prices, pulled from Hermes off chain and verified
on chain at settlement. Privy for sign-in and embedded wallets. Envio HyperIndex for history.
OpenZeppelin and Foundry's `forge-std` under `contracts/lib/`, vendored as submodules and not our
work. TradingView's lightweight-charts for the terminal. androidbrowserhelper for the Android
wrapper. Team and sport logos are used nominatively to identify the market being traded.

**Build window.** This project was built during the hackathon period. The commit history in this
repository covers the whole of it.

## Envio: the whole read path

Monad testnet's RPC caps `eth_getLogs` at about 99 blocks and allows roughly 25 requests a second
across everyone, while Tick settles a window every thirty seconds and writes its social layer on
chain. Rebuilding a portfolio, a leaderboard or a feed from the RPC would mean thousands of range
queries per page load. HyperIndex reads it in one pass, and every screen in the app that shows
history is reading from it.

`indexer/` holds `config.yaml`, `schema.graphql` and four handlers over four contracts:

| Handler | Events | Drives |
|---|---|---|
| `src/handlers/Tick.ts` | `Staked`, `Settled`, `Claimed` | portfolio, leaderboard, room scoreboards, settler bounties |
| `src/handlers/Social.ts` | `GroupCreated`, `GroupChanged`, `GroupJoined`, `RoomCreated`, `RoomJoined`, `GroupPosted`, `RoomPosted` | the group and room graph, and chat |
| `src/handlers/Feed.ts` | `Posted`, `Liked` | the feed, including the photo bytes themselves |
| `src/handlers/Profiles.ts` | `ProfileSet` | usernames, display names, avatars |

The schema is eleven entities with `@derivedFrom` relations, not a flat event log: `Market` carries
the settled outcome, both pool totals, the settler and the bounty, and owns its `stakes` and
`claims`. `field_selection` pulls transaction hashes alongside events so every position links to its
transaction.

The part worth looking at is the photo path. Feed posts keep their image bytes in the event log
rather than on a server of ours, and each post records the single block it landed in, so
`app/api/feed/image/[id]` serves a photo out of the index with the chain as a fallback. That is why
this app runs no database and no object storage at all.

Consumed in `app/lib/useIndexedPositions.ts`, `app/lib/server/standings.ts`, `app/lib/useSocial.ts`,
`app/lib/useFeed.ts`, `app/lib/feed.ts` and `app/lib/profiles.ts`.

## Privy: wallets, not just login

Privy is the signing layer for every on-chain write in the app, not a sign-in button.

- **Embedded wallets sign everything.** Staking, settling, claiming, depositing, withdrawing,
  posting to the feed, creating and joining groups and rooms, sending a chat message and setting a
  profile all go through the embedded wallet. No extension, no seed phrase, no native token.
- **Wallet provisioning we drive ourselves** (`app/components/WalletGuard.tsx`). Our Privy app has
  `embedded_wallet_config.create_on_login` off, which left newer accounts signed in with no wallet
  and nothing to stake with. WalletGuard calls `useCreateWallet` once per sign-in, with no UI, and
  is a no-op when the wallet already exists.
- **Server-side ownership checks on anything that hands out money**
  (`app/lib/server/privyAuth.ts`). The browser sends its Privy access token; the server verifies it
  against Privy's JWKS, issuer and audience, then asks Privy which wallets that user owns and will
  only credit one of those. An address in a request body proves nothing, so the welcome gift and the
  gas station are gated on the Privy user id, which means one claim per person however many wallets
  they make.
- **Wallet selection** (`app/lib/pickWallet.ts`). Prefers the embedded wallet, falls back to one the
  user connected, so "sign in with the wallet I already have" works through the same path.
- **Gas abstraction on top of it.** Users never hold MON. A percentage bar shows gas left and a fill
  action tops it up through `GasStation`, swapping internally, so the only unit anyone sees is the
  stake currency.

## Trade from Claude Code (MCP)

`.mcp.json` registers a `tick` MCP server, so Claude Code can trade Tick in conversation:

| Tool | What it does |
|---|---|
| `tick_markets` | Live Pyth price, current window, strike, pools and price freshness for every market |
| `tick_wallet` | The demo wallet's MON, USDC and Tick balances |
| `tick_stake` | Stakes ABOVE or BELOW; does one-time setup and refreshes the on-chain price if needed |
| `tick_settle` | Settles closed markets with Pyth's signed close price and collects the bounty |
| `tick_collect` | Claims wins and refunds into the Tick balance |
| `tick_positions`, `tick_withdraw` | History and record; move USDC back to the wallet |

It signs with a dedicated testnet key, `TICK_MCP_PK` in `app/.env.local`, and caps one stake at `TICK_MCP_MAX_STAKE` (default 25 USDC). Run `npm install` in `app/`, then approve the `tick` server when Claude Code asks.

## Run it

```bash
# contracts
cd contracts && forge test

# app (needs app/.env.local, see below)
cd app && npm install && npm run dev

# indexer (Docker for local dev, or deploy `indexer/` on Envio Cloud)
cd indexer && npm install && npm run codegen && npm run dev

# android (needs the keystore; see mobile/README)
cd mobile && ./gradlew assembleRelease
```

`app/.env.local` (names only; never commit values, never add a `NEXT_PUBLIC_` prefix to the secrets):

| Variable | Notes |
|---|---|
| `OPERATOR_PK` | Server-only. Pays gas for price posts and settlement; testnet key only |
| `ATTESTOR_PK` | Server-only. Signs sports result attestations |
| `PYTH_API_KEY` | Server-only. Hermes requires a bearer token |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public by design |
| `PRIVY_APP_SECRET` | Server-only |
| `NEXT_PUBLIC_INDEXER_URL` | Envio GraphQL endpoint; public. Unset, history falls back to this browser |

A new wallet with no MON is sent 0.2 MON automatically on its first stake (`/api/gas`, rate-limited and capped per day, testnet only). Otherwise fund a wallet with MON at faucet.monad.xyz and USDC at faucet.circle.com (choose Monad Testnet).

## Proven on chain

- `app/scripts/bounty-e2e.ts`: two stakers, an outside settler holding only MON. The settler earned exactly half the 2% fee in USDC, and payouts plus fee plus bounty accounted for the whole stake.
- `app/scripts/browser-flow.ts`: replays the UI's exact approve, deposit, stake, settle, claim path from a cold wallet.
- `app/scripts/settler.ts`: a standalone bot that discovers closed markets from `Staked` events and settles them.
- `app/scripts/standings-check.ts`: rebuilds every trader's realised profit from `Settled` events and checks it against what the app shows.

## Limits worth knowing

- Testnet only. Card purchases of USDC are not offered; they would need a mainnet and a payments provider that permits wagering.
- Stakes are refused if the on-chain price is stale. That is the cutoff working, not a fault. TSLA only moves while US markets are open.
- The fee-recipient, feed listing and admin keys cannot influence any outcome.
