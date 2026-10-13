# Pitch video assets

All 1080x1920, 30fps, h264 crf 18. Recorded signed in as **Marco Reyes** (`@marco`), a real wallet
with a real on-chain profile, group and room membership, and a real position history.

The session is not mocked. The app already supports a plain EIP-1193 wallet whenever
`NEXT_PUBLIC_PRIVY_APP_ID` is unset, so the recorder injects a provider backed by a real testnet key
and signs through it. **Every tap in the first three clips produced a transaction that exists on
Monad.** No bypass was added to the app, and none of this can reach production.

## The product being used — lead with these

| File | Length | What happens, start to finish |
|---|---|---|
| `clips/01-stake.mp4` | 38s | Picks $1, taps **Above**, the confirm sheet prices the order (*1 USDC ABOVE $83,163, closes in 11s*), taps **Stake ABOVE** → *Staking…* → *Staked 1 USDC ABOVE on BTC/USD. Settles when the window closes. Anyone can settle it.* The pool moves to 100% above and the position appears. Two real transactions: approve `0x6a8558b7…`, stake `0xba12aef2…`. |
| `clips/02-post-card.mp4` | 30s | Types a caption, taps **Post**, and the card lands in the feed under Marco's name, read from the chain. Transaction `0xc121bd83…`. |
| `clips/03-group-chat.mp4` | 24s | Types *"called that one, above by a hair"* in the Sigma Traders group and sends it. The message is written to contract storage. Transaction `0x0956c3c8…`. |

These are the clips that show the product in actual operation, which is what the rules ask for.

## The rest of the product, also being used

Every one of these has the pointer doing something: switching a tab, picking a stake size, opening a
group, copying a card link. Same capture and encode as the three above.

| File | Length | What happens |
|---|---|---|
| `clips/04-room.mp4` | 20s | the room everyone is calling: picks $0.5, the payout line updates, then the board |
| `clips/05-markets.mp4` | 18s | switches to **Sports**, real NFL fixtures, then back to crypto |
| `clips/06-portfolio.mp4` | 16s | filters to **Open**, with a refund waiting to be claimed |
| `clips/07-card.mp4` | 15s | a settled card, +$3.68, and **Copy link** to carry it out of the app |
| `clips/08-feed.mp4` | 18s | sorts by **Top**, then back to **Latest** |
| `clips/09-groups.mp4` | 15s | opens Sigma Traders and lands in the chat |
| `clips/10-leaderboard.mp4` | 13s | the board everyone is racing |
| `clips/11-landing.mp4` | 16s | the landing page and its scroll story |

## Stills

`stills/01-room` · `02-trade` · `03-card` · `04-portfolio` · `05-chat` · `06-feed` ·
`07-leaderboard` · `08-markets` at 1080x1920, plus `09-monad-proof.png` at 1920x1080.

`09-monad-proof.png` is the Monad shot: chain 10143, the Tick contract, head block, the block the
indexer has reached, and a real settled window paying a $0.01 bounty to the wallet that settled it.
Every number read live from the chain when it was rendered.

## About the activity on screen

The other traders, stakes and messages are real transactions on Monad testnet placed by wallets we
control, so the screens look like a product in use rather than an empty app. That is seeded demo
activity, not users, and it should never be presented as traction. The usage number in the
submission is the pre-seeded one: six wallets, 38 stakes.
