# Solana Mobile submission: what to paste where

Everything below is ready to copy. Three fields need you: the two email addresses, and the four URLs you
get after uploading the deck, the video and the APK.

**One thing to decide first.** Tick runs on Monad testnet. There is no Solana deployment yet, and the repo
is public, so a judge who opens it will see Solidity contracts on Monad. Every answer below is written so
it is true: it leads with the mobile product and the parallel-execution argument, and says a Solana
deployment is the next step. Do not change these to claim Solana is live.

---

## dApp Store listing

**App Name**
```
Tick
```

**Package Name**
```
app.tick.mobile
```

**Subtitle** (50 max, this is 44)
```
30-second markets you play with your group
```

**Description**
```
Tick turns a price call into a 30-second game you play with your friends.

Pick a market, call above or below from ten cents, and it settles half a minute later against a Pyth
price, with nobody refereeing the result. Start a room, invite your group, and everyone calls the same
30 seconds while a live scoreboard re-sorts after every window. Win, and Tick draws a card from your real
on-chain record, which you post to your feed or straight into the group chat. The number on the card is
read from the chain, so it cannot be faked.

Sign in with Google, a passkey, email or X. No seed phrase, no extension, and a little testnet USDC to
start with. Groups, rooms, chat, posts and results all live on chain.

Tick runs on a test network today: the USDC has no monetary value, and nothing you can spend elsewhere
changes hands.
```

**App Website**
```
https://tick-predict.xyz
```

**Terms of Use**
```
https://tick-predict.xyz/terms
```

**Privacy Policy**
```
https://tick-predict.xyz/privacy
```

**Support Email / Contact Email** — yours. The legal pages currently print
`support@tick-predict.xyz`; change that in `app/app/terms/page.tsx` and `app/app/privacy/page.tsx` to
whatever address you will actually read, or point it at your own mailbox.

**Your Solana Wallet** — the address you already pasted in the form. It only ties the listing to you.

**Art** (in `media/store/`)
- dApp Icon 512x512: `icon-512.png` (solid background, no transparency, as required)
- Banner 1200x600: `banner-1200x600.png` (wordmark and tagline left, the app right)
- Previews, portrait 1080x1920, upload 4 to 8: `01-feed.png`, `02-trade.png`, `03-room.png`, `04-chat.png`,
  `05-card.png`, `06-markets.png`. Each is a real 430x932 mobile capture, captioned, on the brand backdrop.
  The unbranded captures are in `media/store/raw/` if a plain screenshot is wanted instead.

**Language / Countries**: English (United States), all countries.

---

## Hackathon form

**Project title**
```
tick
```

**Prior funding from a VC or angel**: No.

**Built in the last 3 months**: Yes.

**Won a previous hackathon with this project**: N/A

**Major features or significant mobile development**
```
Tick was built mobile-first and ships as an installable Android app.

- The whole product is laid out for a phone: the feed, the trading screen with its live chart, the
  messenger-style group pages, the room arena and the card are each designed at phone width, not scaled
  down from a desktop layout.
- Android app: a Trusted Web Activity (package app.tick.mobile), signed, with Digital Asset Links
  verified against the site so it runs full screen with no browser chrome. It opens in Chrome rather than
  a WebView on purpose: Google blocks sign-in inside a WebView, and Chrome keeps Google sign-in, passkeys
  and wallet handoff working.
- Installable as a PWA as well, with a manifest, maskable icons and shortcuts to Feed, Groups and Markets.
- Onboarding with no seed phrase: Google, passkey, email or X through Privy, which creates an embedded
  wallet, plus a gas drip and a USDC-to-gas swap so a new user never has to hold a second token or learn
  what gas is.
- Social layer built for a phone: group chat, rooms, a live scoreboard that re-sorts as each window
  settles, and a share card with an Open Graph image so a result posted to X or a group unfurls as the
  card.
```

**SKR integration**
```
None. Tick has no SKR integration and does not claim one.
```

**Repository URL**
```
https://github.com/Khalid-000-ME/tick
```

**Deck URL** — the link you get after uploading `submission/pitch-deck` (see below).

**Demo video URL** — upload `media/out/tick-demo.mp4` to YouTube or Drive and paste the link.

**Android APK URL** — published as a GitHub release asset, paste this:

https://github.com/Khalid-000-ME/tick/releases/download/v1.0.0/tick-v1.0.0.apk

Release page: https://github.com/Khalid-000-ME/tick/releases/tag/v1.0.0

---

## If you are asked about Solana in judging

The honest version, which is also the strongest one:

- Tick is a latency product. A 30-second market only works if settlement, staking and the social writes
  all land in seconds and cost a fraction of a cent, which is exactly what a parallel-execution chain is
  for. The app already assumes that: stakes, settlement, chat, posts and group membership are all
  separate on-chain writes, placed in parallel rather than batched.
- It is built on Monad testnet today because that is where it was shipped during the build. Nothing in the
  product depends on the EVM beyond the contracts themselves: the markets, the social contracts and the
  feed are small and self-contained, and the client reads them through one adapter.
- The next step is a Solana deployment: the market and settlement programs in Anchor, the wallet flow
  through Mobile Wallet Adapter, and the same Privy sign-in, which already supports Solana wallets.

## Module fields (headline, tag, graphic)

**Headline** (50 max) — `Compete in groups. Flex your profits.` (37)
Alternates: `30-second markets you play with your friends` (43) · `Call 30 seconds. Race your crew. Flex the card.` (46)

**Tag** (12 max) — `30s markets` (11)
Alternates: `Predictions` (11) · `Flex proof` (10) · `30s` (3)

**Graphic 1200x1200** — `media/store/graphic-1200x1200.png`

---

# Hackathon form, round two

## What are you building, and who is it for? (1000)

Tick is a prediction market that settles every thirty seconds, built to be played with your friends.

You pick a market, call above or below from ten cents, and half a minute later it settles against a
Pyth price with nobody refereeing the result. The part that makes it ours is what sits around that:
you open a room inside your group, everyone calls the same thirty seconds, and a live scoreboard
re-sorts after every window. Win, and Tick draws a card from your real on-chain record and posts it
to the group chat or the public feed. The number on the card is read from the chain, so nobody can
fake a win and nobody can hide a loss.

It is for the people who already trade in group chats. Fantasy sports players, trading Discords,
college friends who screenshot their wins. That audience is social by default and there is no
prediction market built for it: the existing ones are single-player screens with month-long
questions. We built the version you play together, in real time, with proof worth posting.

Sign in with Google, a passkey, email or X. No seed phrase, no extension, no native token to buy.

## Why did you decide to build this, and why build it now? (1000)

Prediction markets won the argument. People accept that a market is a better forecast than a pundit,
and billions have been bet on being right. But every one of them is slow and solitary. The quickest
market anyone runs settles in five minutes. You pick a side, wait, and find out alone.

Meanwhile everything people actually enjoy about trading happens somewhere else: the group chat, the
running score, the screenshot of the win. The product and the fun live in different apps.

Thirty seconds is the hinge. It is short enough that a group can play a round together while sitting
in the same chat, which turns a market into a game instead of a wager you forget you placed. Nobody
had shipped it because the chain could not carry it: at the close of a window every settlement,
claim and scoreboard write arrives at once, and on a serial chain that is a traffic jam that costs
more in gas than the stake is worth.

Parallel execution is what changed. On a chain that executes independent accounts side by side, the
close-of-window burst fans out instead of queueing, and a ten-cent stake stays worth placing. That
is why this is buildable now and was not two years ago, and it is why we are moving to Solana.

## What technologies are you using or integrating with? (notable dev and AI tools)

On chain: Solidity with Foundry for the Monad contracts, and Rust with Anchor for the Solana
program. SPL Token for stakes. Pyth as the price oracle, pulled off chain for the charts and posted
on chain only just before a stake, with signed updates verified at settlement.

App: Next.js 16 with the App Router, React 19, TypeScript, viem for chain calls, lightweight-charts
for the terminal, motion for the interface. Privy for sign-in and embedded wallets, so a new user
never sees a seed phrase. Envio HyperIndex for history, because the RPC caps getLogs at about a
hundred blocks. Vercel for hosting. Playwright for end-to-end checks and for recording the demo.

Mobile: a Trusted Web Activity wrapper with androidbrowserhelper, signed and shipped as an APK.

AI tools: Claude Code wrote and reviewed most of this codebase alongside us, from the Solidity to
the Anchor port to the local validator test harness. We also expose Tick itself as an MCP server, so
an agent can read markets, stake, settle and claim in conversation.

## Which chains does your product use?

Solana, and Other: Monad.

## How does your product use these chains? (500)

Everything is on chain, including the social layer. The market contract holds the pools and settles
from a signed Pyth price. Groups, rooms, members, avatars and chat live in contract storage. Feed
posts keep their photo bytes in the event log, so a photo is recovered with one contract read and a
single-block log query. We run no database of our own.

Monad testnet is live today and is what the demo runs against: six contracts, with settlement
permissionless and paid, so an outside bot earns half the fee for settling a window.

The Solana program is the port of that market, written in Anchor and verified end to end on a local
validator. Each trader writes their own Position PDA, so the burst of settles and claims at the
close of a window touches a different account per trader and runs in parallel.

## What category best describes your product?

Social / SocialFi.

## Is your project a mobile-focused dApp?

Yes. The interface is built mobile-first and ships as a signed Android APK.

## Where is your team primarily based?

India. [Confirm.]

## Team Telegram contact

[@your_telegram]

## Did anyone not listed on the team do meaningful work? (600)

No. Khalid and Lakshmi Kanth built all of it.

Worth stating plainly: we used Claude Code heavily throughout, as an engineering tool rather than a
collaborator. Every design decision, every tradeoff and every line that shipped was ours to accept
or reject.

## Anything else judges should know?

Two things we would rather you hear from us than find out.

First, Tick runs on a test network. The USDC has no monetary value and nothing spendable changes
hands. The product is complete end to end, not the economics.

Second, on Solana specifically: the program is written and proven, not yet deployed. It compiles,
and a local validator run takes two traders through stake, settle and claim with the money
accounted for to the cent, including the outside settler's bounty. The devnet deploy is waiting on
faucet SOL, nothing else. We would rather tell you that than put an address in this form that does
not resolve.

The repository is public and the demo video is a single unbroken take against the live testnet.
