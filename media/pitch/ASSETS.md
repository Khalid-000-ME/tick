# Pitch video assets — signed in

Everything here is the product **signed in as a real account**, not the logged-out tour. The
recordings use the app's existing non-Privy wallet path (`lib/useTickWallet.ts` falls back to
`lib/useWallet.ts` when `NEXT_PUBLIC_PRIVY_APP_ID` is unset), with a provider backed by a real
testnet key. No bypass was added to the app, and nothing here can reach production.

The account on screen is **Marco Reyes** (`@marco`), a real wallet with a real on-chain profile,
group membership, room membership and open positions.

## Clips, silent, for cutting under the script

| File | Length | Shows |
|---|---|---|
| `clips/01-room.mp4` | 11s | a room, signed in: ETH/USD 30s window, chart, crowd split, **Tap a side to stake 1 USDC** with the stake sizes |
| `clips/02-trade.mp4` | 10s | the trading terminal with a live window and the stake controls enabled |
| `clips/03-card.mp4` | 10s | a settled results card, +$3.68, 22 calls, #1 overall, verified on chain |
| `clips/04-portfolio.mp4` | 8s | Marco's portfolio: record, win rate, total staked, and his open positions |
| `clips/05-chat.mp4` | 9s | the group chat with cards posted into it, and the composer ready to write |
| `clips/06-feed.mp4` | 8s | the feed, signed in, composer active, groups and rooms in the sidebar |
| `clips/07-leaderboard.mp4` | 8s | the live leaderboard with Marco in it, marked YOU |
| `clips/08-markets.mp4` | 8s | the markets list, crypto and sport, every window length |
| `clips/09-landing.mp4` | 8s | the landing page, for a cold open |

Each clip has a visible cursor moving and tapping, so it reads as someone using the app.

## Stills, 1080x1920 portrait

`01-room` · `02-trade` · `03-card` · `04-portfolio` · `05-chat` · `06-feed` · `07-leaderboard` ·
`08-markets`, plus `09-monad-proof.png` (1920x1080).

## The Monad shot

`stills/09-monad-proof.png`. Every number on it was read live from the chain and the indexer when it
was rendered: chain 10143, the Tick contract, the head block, the block the indexer has reached, and
a real settled window with pools of $1.00 above and $3.00 below, settled 11 seconds after close,
paying a $0.01 bounty to the wallet that settled it.

## About the activity on screen

The traders, stakes, messages and leaderboard places are real transactions on Monad testnet, placed
by wallets we control, to make the screens look like a product in use rather than an empty app.
That is seeded demo activity, not users. Do not present it as traction. The only usage number worth
quoting is the one in the submission: six wallets, 38 stakes, before any of this was seeded.
