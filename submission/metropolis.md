# Metropolis submission — copy and paste

Every field below is final text. Character counts are inside the limits.

## Primary track

Social, Attention & Culture. Already selected, and it is the right one.

## Logo

`media/store/icon-512.png` — 512x512 PNG, well under 2 MB.

## Project name (5 / 120)

```
Tick
```

## Tagline (190 / 200)

```
Thirty-second prediction markets played in rooms with your friends, where the close-of-window burst of settlements and claims runs in parallel on Monad instead of queueing into a traffic jam
```

## Describe the problem, your solution, and what makes it useful (4504 / 8,000)

```
Prediction markets won the argument. People accept that a market forecasts better than a pundit, and billions have been staked on being right. But every one of them is slow and solitary. The quickest market anyone runs settles in five minutes. You pick a side, wait, and find out alone.

Meanwhile everything people actually enjoy about trading happens somewhere else. The group chat, the running score, the screenshot of the win. The product and the fun live in different apps, and when someone wants to show a win they leave, screenshot it, and post something nobody can verify.

Tick is a prediction market that settles every thirty seconds, built to be played with your friends.

HOW IT WORKS

Pick a market, call above or below from ten cents, and half a minute later it settles against a Pyth price with nobody refereeing the result. A market is its own terms: (feedId, strike, expo, closesAt) hashes to the market id, so there is no create-market transaction and no listing committee. Windows sit on a thirty-second grid and the strike is Pyth's price at window open, served identically to every client.

Winners split the losing pool pro rata, minus a 2% fee on profit. A one-sided market voids and refunds everyone. Settlement is permissionless and paid: anyone can settle a closed window with a signed Pyth update for that exact second, and the caller earns half the fee, capped at 2 USDC. Our own settler waits ten seconds after the close so an outside bot gets first shot at the bounty.

THE PART THAT MAKES IT A PRODUCT RATHER THAN AN INSTRUMENT

You open a room inside your group and everyone calls the same thirty seconds. A live scoreboard re-sorts after every window. Win, and Tick draws a card from your real on-chain record and posts it into the group chat or the public feed. The number on the card is read from the chain, so nobody can fake a win and nobody can quietly hide a loss.

The social layer is on chain too, not in a database of ours. Groups, rooms, members, avatars and chat live in contract storage. Feed posts keep their photo bytes in the event log, and the post records the one block it landed in, so a photo is recovered with a single contract read and a single-block log query. We run no database at all.

WHY THIS NEEDS MONAD

A thirty-second market only works if settlement, staking and every social write land in seconds and cost a fraction of a cent. At the close of a window, every settlement, claim and scoreboard write arrives at the same moment. On a serially executed chain that is a traffic jam, and the gas costs more than a ten-cent stake is worth, which is precisely why nobody has shipped a sub-minute market before.

Monad's parallel execution is what makes it possible. We built for it rather than hoping for it: the pools are sharded 64 ways so that two people staking the same window never write the same storage slot, and contracts/test/Concurrency.t.sol measures read-after-write conflicts directly and finds none between stakers. Cheap, fast finality is also what lets the entire social layer live on chain instead of in a server we would otherwise have to run.

WHAT IS USEFUL ABOUT IT

It gives a group a reason to be in the market together at the same moment, which no prediction market currently does. It turns a win into something portable and verifiable instead of an unfalsifiable screenshot, which is both the fun and the distribution. And it does all of that without asking anyone for a seed phrase: sign in with Google, a passkey, email or X, get an embedded wallet, and gas is abstracted behind a percentage bar you top up rather than a native token you have to find.

WHAT IS SHIPPED

Six contracts live on Monad testnet: the market, plus groups, rooms, chat, profiles, sports and a gas station. A Next.js app with a trading terminal, feed, groups, rooms, leaderboard and portfolio. An Envio HyperIndex for history, because the RPC caps getLogs at about a hundred blocks. A signed Android APK as a Trusted Web Activity. An MCP server, so an agent in Claude Code can read markets, stake, settle and claim in conversation.

LIMITATIONS WE WILL STATE OURSELVES

Testnet only: the USDC has no monetary value, so the product is complete end to end but the economics are untested. A one-sided window voids and refunds today, which is the one way a room can feel broken; a maker on every window is the fix and it is not built yet. And demand is inferred from behaviour rather than proven at scale, which is what the next few months are for.
```

## Who are your first users, and how will you reach them? (3192 / 8,000)

```
WHO

People who already trade socially in group chats. Trading Discords and Telegram groups, college friend groups, fantasy sports players. They are social by default, they already keep score informally, and they already screenshot their wins. They are not professional traders, and most of them would not describe themselves as crypto users.

We are deliberately not starting with the existing prediction-market audience. Those users are served, they are single-player by habit, and competing for them means competing on liquidity and resolution quality, which is where the incumbents are strongest. Our wedge is the group, not the forecaster.

WHAT WE BELIEVED, AND WHAT WE ARE TESTING

Our original assessment was that the enjoyable half of trading already lives in the group chat, and that prediction markets had captured the instrument while capturing none of the behaviour around it. We believed thirty seconds was the unlock, because it is short enough for a group to play a round together in real time rather than wait alone, and that it had not been built because the chain could not carry the close-of-window burst.

The thing we are actually testing is narrower: does a thirty-second window make a group play together, or does it just make a single player play faster? Everything else follows from that answer.

EVIDENCE SO FAR, STATED AS WHAT IT IS

On testnet, with no marketing and no incentives, six wallets have placed 38 stakes totalling $64.10 staked and $62.68 returned after settlement. The result cards were posted to the feed without us asking anyone to. That is early signal, not validation, and we will not dress it up as traction. What it does tell us is that the posting behaviour the whole distribution model depends on happens unprompted.

HOW WE REACH THEM

The loop is the channel. Every win produces a card that is read from the chain and designed to be posted, and every card carries the room it was won in. A group that plays recruits the next group, because the card lands where that group already talks.

Concretely, in order:

1. Seed one group at a time, not a thousand strangers. We run the product inside two real trading groups we already have access to, sit in the chat while they play, and collect qualitative feedback on the single question above.

2. Turn that into a short survey across the wider segment, to size how many people already keep informal scoreboards or screenshot wins, and what they would want staked.

3. Make the room worth running for the host. Private leagues, entry pots and a cut of the room, so the person who organises their friends has a reason to keep organising them. Group hosts are the distribution, so the product has to pay them.

4. Mobile as the front door. The Android build is already signed and shipped, because this is a product people use while sitting in a group chat on a phone, not at a desk.

WHAT WOULD CHANGE OUR MIND

If rooms get created but people call windows alone, or if cards get generated but not posted, then the social thesis is wrong and what we have built is a fast single-player market. We would know that from the first two groups, and we would rather find out from them than from a launch.
```

## Repository

```
https://github.com/Khalid-000-ME/tick
```

Must be public, or shared with metropolis@hackathon.monad.xyz.

## Product link

```
https://tick-predict.xyz
```

## Demo video

Upload `media/out/tick-demo-monad.mp4` (70s, ends on the Monad evidence card) to YouTube as unlisted, paste the link. Tick the box to let organizers show it publicly.

## Pitch video

Record from `submission/pitch-video-brief.md` with the assets in `media/pitch/`. Up to 2 minutes. Tick the box to let organizers show it publicly.

## Steps to try your product (1685 / 8,000)

```
No credentials needed, and nothing to install.

1. Open https://tick-predict.xyz
2. Sign in with Google, a passkey, email or X. There is no seed phrase and no extension.
3. A new account is funded automatically with testnet USDC, and gas is covered on first use, so there is no faucet trip.
4. Go to Markets, pick BTC/USD on the 30s window, and call Above or Below from ten cents. Wait out the window; it settles against Pyth and pays automatically.
5. Go to Groups, open the Sigma Traders group, and open the room inside it to see the live scoreboard re-sort as windows settle.
6. Go to Portfolio to see your record, then open your card and post it to the feed.

Everything runs on Monad testnet, so no real money is involved at any point.

If you would rather look around before signing in, the feed, the markets and any room are readable signed out.

ANDROID

The signed APK is at https://github.com/Khalid-000-ME/tick/tree/main/mobile/dist/tick.apk, package app.tick.mobile. It is a Trusted Web Activity over the same site, so it behaves identically.

VERIFYING IT ON CHAIN

Tick contract: 0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2 on Monad testnet, chain 10143. Explorer: https://testnet.monadscan.com

TickSocial (groups, rooms, chat): 0x26307B3c17A0a1e3Fb381c70D7F9584D933a3129
TickFeed (posts, photos, likes): 0x26608eDF8e677431fFDDda4d1630D6B99d383433

Settlement is permissionless: run `npm run settler` in app/ and your own bot can settle closed windows and collect half the fee. /settlers shows who has been winning the bounties.

If anything is unresponsive, it is the shared testnet RPC rate limit, which allows 25 requests a second across everyone. Reloading clears it.
```

## Bounty: Envio, Best Use of Envio (2917 / 8,000)

```
Envio is the entire read path of the app. Every screen that shows history reads from HyperIndex;
without it the product does not work.

WHY IT IS LOAD-BEARING

Monad testnet's RPC caps eth_getLogs at about 99 blocks and allows roughly 25 requests a second
across everybody, while Tick settles a window every thirty seconds and writes its whole social layer
on chain. Rebuilding a portfolio, a leaderboard or a feed from the RPC would be thousands of range
queries per page load: impossible inside the rate limit and unusably slow. HyperSync reads it in one
pass.

WHAT IS INDEXED (indexer/config.yaml, schema.graphql, src/handlers)

Four handlers over four contracts:

- Tick.ts: Staked, Settled, Claimed
- Social.ts: GroupCreated, GroupChanged, GroupJoined, RoomCreated, RoomJoined, GroupPosted, RoomPosted
- Feed.ts: Posted, Liked
- Profiles.ts: ProfileSet

The schema is eleven entities with @derivedFrom relations, not a flat event log. Market is a derived
entity assembled from three separate events: Staked builds its pools, Settled writes the outcome,
settle price, both pool totals, the settler address and the bounty paid, Claimed resolves payouts,
and it owns its stakes and claims through @derivedFrom. Group owns GroupMember and Message; Room
owns RoomMember. field_selection pulls transaction hashes alongside events so every position in the
UI links to the transaction that made it.

WHAT IT DRIVES, FEATURE BY FEATURE

- /portfolio and the record on every results card (app/lib/useIndexedPositions.ts)
- the global leaderboard and every room scoreboard, which re-sorts after each window settles
  (app/lib/server/standings.ts, polled every 3s by /api/room-board)
- the group and room graph, membership and chat (app/lib/useSocial.ts)
- the feed, including photographs (app/lib/useFeed.ts, app/lib/feed.ts)
- profiles and avatars (app/lib/profiles.ts)

THE PART WE THINK IS ORIGINAL

Feed posts keep their image bytes in the event log rather than on a server of ours, and each post
records the single block it landed in. The indexer stores those bytes, so /api/feed/image/[id]
serves a photograph straight out of the index, falling back to one contract read plus a
single-block log query if the index has not caught it yet. That is what lets this app run no
database and no object storage at all: Envio is the storage layer for a social product, not an
analytics sidecar.

DEPLOYMENT

Deployed on Envio Cloud, hosted dev tier. The endpoint changes on each deploy, so the app reads it
from NEXT_PUBLIC_INDEXER_URL rather than hardcoding it, and degrades to a shallow browser-side
fallback if it is unset, which is exactly the experience the indexer exists to avoid.

SEEING THE DATA FLOW

Open https://tick-predict.xyz/leaderboard or /portfolio: every row is an Envio query. Place a stake
and it appears in the portfolio once the indexer picks the event up. The clips in media/pitch show
this end to end.
```

Link:

```
https://github.com/Khalid-000-ME/tick/tree/main/indexer
```

## Bounty: Privy (2901 / 8,000)

```
Privy is the signing layer for every on-chain write in this app, not a sign-in button. Login is the
least of what we use it for.

WHAT IT POWERS BEYOND AUTHENTICATION

1. EMBEDDED WALLETS SIGN EVERY TRANSACTION. Staking on a window, settling a closed market, claiming
winnings, depositing, withdrawing, posting a card to the feed, creating and joining groups and
rooms, sending a chat message and setting a profile all go through the Privy embedded wallet. A user
signs a dozen transactions in a session without ever seeing a seed phrase, an extension or a native
token.

2. WALLET PROVISIONING WE DRIVE OURSELVES (app/components/WalletGuard.tsx). We hit a real failure:
new accounts were arriving signed in with no wallet at all, so there was no address, no name in the
header and nothing to stake with. We diagnosed it against Privy's API with our app secret and found
embedded_wallet_config.create_on_login set to off, with mode user-controlled-server-wallets-only.
Rather than block every new user on a dashboard setting, WalletGuard calls useCreateWallet once per
sign-in with no UI of its own, and is a no-op when the wallet already exists.

3. SERVER-SIDE WALLET OWNERSHIP GATING MONEY (app/lib/server/privyAuth.ts). Anything that hands out
funds cannot trust an address in a request body: anyone can post a thousand made-up addresses. The
browser sends its Privy access token; the server verifies the signature against Privy's published
JWKS, checks issuer and audience, and gets a user id. It then queries Privy for the wallets that
user actually owns and will only credit one of those. The welcome gift and the gas station are both
gated this way, so a person claims once however many wallets they create. This is Privy's API doing
authorisation of value transfer, not login.

4. WALLET SELECTION ACROSS TYPES (app/lib/pickWallet.ts). Prefers the embedded wallet and falls back
to one the user connected, so "use the wallet I already have" runs through the same code path as a
brand new embedded one, including the privy and privy-v2 client types.

5. GAS ABSTRACTION BUILT ON IT. Users never hold or think about MON. A percentage bar shows gas
remaining and a fill action tops it up through our GasStation contract, swapping internally, so the
only unit anyone sees is the stake currency. That is only possible because the embedded wallet is
ours to orchestrate rather than a third-party extension we have to ask.

WHY IT MATTERS FOR THIS PRODUCT

Tick is a thirty-second market played inside a group chat. The entire premise is that someone drops
an invite link and the group is playing within a minute. Privy is why the path from link to first
signed transaction contains no wallet step, for people who do not consider themselves crypto users.

WHERE TO SEE IT

Live at https://tick-predict.xyz: sign in and the embedded wallet is created, funded and signing
within about fifteen seconds.
```

Link:

```
https://github.com/Khalid-000-ME/tick/blob/main/app/lib/server/privyAuth.ts
```

## Optional promotion

Promo clip: upload `brag-output/brag.mp4` (21s, inside the 30s cap).

X profile: yours to fill.
