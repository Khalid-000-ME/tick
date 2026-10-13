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

## Bounty: Envio, Best Use of Envio (3125 / 8,000)

```
Tick is a thirty-second prediction market played in group rooms, and the entire read path of the app runs on Envio HyperIndex. Not as an analytics add-on: without it the product does not work.

WHY WE NEEDED IT

Monad testnet's RPC caps eth_getLogs at roughly 99 blocks per query and allows about 25 requests per second shared across everybody. Tick settles a window every thirty seconds and writes its whole social layer on chain, so a single user's history can span hundreds of thousands of blocks. Reconstructing a portfolio, a leaderboard or a feed from the RPC would mean thousands of range queries per page load, which is both impossible inside the rate limit and unusably slow. HyperSync reads it in one pass instead.

WHAT WE INDEX

The indexer is in indexer/, four handlers covering four contracts:

- Tick (indexer/src/handlers/Tick.ts): Staked, Settled, Claimed. This builds the Market and Stake and Claim entities that drive the portfolio, the leaderboard, the room scoreboard and the settler bounty table. Settled carries the outcome, the settle price, both pool totals, the settler address and the bounty paid, which is what lets us show who settled each window and what they earned.
- TickProfiles: ProfileSet, for usernames, display names and avatars.
- TickSocial: GroupCreated, GroupChanged, GroupJoined, RoomCreated, RoomJoined, GroupPosted, RoomPosted. The whole group and room graph, including chat messages, lives in contract storage and is read back through Envio.
- TickFeed: Posted and Liked. Posted carries the photo bytes themselves in the event log, so the indexer is also how we serve images.

We use field_selection to pull transaction hashes alongside the events, so every stake in a user's history links straight to its transaction.

WHAT IT POWERS IN THE APP

- /portfolio and the record on every results card (app/lib/useIndexedPositions.ts)
- the global leaderboard and every room scoreboard, which re-sorts after each window settles (app/lib/server/standings.ts)
- the social graph: groups, rooms, membership and chat (app/lib/useSocial.ts)
- the feed, including photos (app/lib/useFeed.ts, app/lib/feed.ts)
- profiles and avatars (app/lib/profiles.ts)

The photo path is the one we are proudest of. Feed posts keep their image bytes in the event log rather than on a server of ours, and the post records the single block it landed in. The indexer stores those bytes, so /api/feed/image/[id] serves a photo from the index with the chain as a fallback: one contract read and one single-block log query if the index has not caught it yet. That means the app runs no database and no object storage at all, and Envio is what makes that practical rather than theoretical.

HONEST NOTE

We are on the hosted dev tier and have deployed three times, so the endpoint URL changes on each deploy and the app reads it from NEXT_PUBLIC_INDEXER_URL rather than hardcoding it. The app degrades rather than breaks if the endpoint is unset: history falls back to reading what it can from the browser, which is slower and shallower, and that fallback is exactly the experience we built the indexer to avoid.
```

Link:

```
https://github.com/Khalid-000-ME/tick/tree/main/indexer
```

## Bounty: Privy (3168 / 8,000)

```
Tick is for people who trade in group chats, most of whom do not consider themselves crypto users. The hard requirement was that someone could go from a link to a staked position without ever meeting a seed phrase, an extension or a faucet. Privy is what makes that true.

WHAT WE USE

- Sign-in with Google, a passkey, email or X, with an embedded wallet created for every account. No seed phrase at any point, no extension, nothing to install.
- Server-side token verification for anything that hands out money (app/lib/server/privyAuth.ts). The browser sends its Privy access token; the server verifies the signature against Privy's published JWKS, checks the issuer and the audience, and gets a user id. It then asks Privy which wallets that user actually owns and will only act on one of those. This matters because our welcome gift and gas station give away testnet funds, and an address in a request body proves nothing: anyone can post a thousand made-up addresses. Tying it to a verified Privy user id means a person can claim once no matter how many wallets they create.
- Embedded wallet signing for every on-chain action: stake, settle, claim, post to the feed, create a group, send a message.

WHAT WE BUILT AROUND IT

WalletGuard (app/components/WalletGuard.tsx). We hit a real problem in development: newer accounts were arriving signed in with no wallet at all, so there was no address, no name in the header and nothing to stake with. We diagnosed it by querying the Privy API with our app secret and found embedded_wallet_config.create_on_login set to off on our app, with mode user-controlled-server-wallets-only. Rather than block every new user until a dashboard setting changed, WalletGuard asks the client to create the wallet once per sign-in, with no UI of its own. It is harmless if the dashboard setting is turned back on, because the wallet already exists and nothing is requested. That was the single biggest onboarding fix in the project.

Onboarding (app/components/Onboarding.tsx). A skippable profile and preferences flow right after sign-up, shown as a modal whose contents change per phase, so a first-time user ends up with a username and an avatar instead of a hex address.

WelcomeGift (app/components/WelcomeGift.tsx). New accounts receive testnet USDC automatically, gated on the verified Privy user id described above.

Gas abstraction. Users never hold or think about the native token. A percentage bar shows gas remaining and a Fill gas action tops it up, swapping internally, so the only unit anyone sees is the stake currency.

WHY IT MATTERS FOR THIS PRODUCT SPECIFICALLY

A thirty-second market is worthless if onboarding takes five minutes. The entire premise is that a group can be playing together within a minute of someone dropping an invite link into their chat. Privy is the reason the path from link to first stake has no wallet step in it at all, and the reason we could put the invite link in a group chat and expect it to work for people who have never used a crypto app.

The app is live at https://tick-predict.xyz and signing in takes about fifteen seconds, which is the clearest demonstration we can offer.
```

Link:

```
https://github.com/Khalid-000-ME/tick/blob/main/app/lib/server/privyAuth.ts
```

## Optional promotion

Promo clip: upload `brag-output/brag.mp4` (21s, inside the 30s cap).

X profile: yours to fill.
