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
- Banner 1200x600: `banner-1200x600.png` (middle kept clear, the icon sits over it)
- Previews, portrait 9:16, upload 4 to 8: `01-feed.png`, `02-trade.png`, `03-room.png`, `04-groups.png`,
  `05-card.png`, `06-markets.png`

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

**Android APK URL** — `mobile/dist/tick.apk`. It needs a direct download link: a GitHub release asset is
the simplest (`gh release create v1.0 mobile/dist/tick.apk`), or Drive with link sharing on.

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
