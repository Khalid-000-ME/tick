# Pitch video brief — Tick

Paste this whole file into Claude to produce the pitch: script, shot list, on-screen text and slides.
Everything below is true and checkable. Do not invent numbers, users, or quotes.

## What to make

A two-minute pitch video for a hackathon jury. Not a product demo, which we already have. The jury
is judging how we think and how we communicate: who we built for, what we believed about them, what
we have learned, and what we are honest about not knowing yet.

Tone: plain, direct, unhyped. Two founders talking to camera, cutting to the product. No stock
footage, no music swell, no slogans we cannot back up.

## The team

- **Khalid**, co-founder, CEO. Multiple global web3 hackathon wins. Contracts, settlement, terminal.
- **Lakshmi Kanth**, co-founder, CTO. Fintech engineering, payments and risk. Social layer and app.

## The product, in one line

Tick is a prediction market that settles every thirty seconds, built to be played with your friends.

How it works: pick a market, call above or below from ten cents, and half a minute later it settles
against a Pyth price with nobody refereeing the result. You open a room inside your group, everyone
calls the same thirty seconds, a live scoreboard re-sorts after every window, and a win draws a card
from your real on-chain record that posts into the group chat.

## The segment, stated explicitly

The jury has told us the segment choice is ours, and that they will assess **what our original
assessment was and how we plan to address it**. So the video must say all three parts out loud.

**Who:** people who already trade socially in group chats. Trading Discords, college friend groups,
fantasy sports players. Not professional traders, and not people who identify as crypto users.

**Our original assessment:** we believed the fun of trading already lives in the group chat, and
that prediction markets had captured the instrument but none of the social behaviour around it. We
believed thirty seconds was the unlock, because it is short enough for a group to play a round
together in real time rather than wait alone.

**How we are addressing it:** we built the room, the live scoreboard, and the verifiable card, and
we put the social layer on chain so a win cannot be faked. The next step is putting it in front of
one real group, not a thousand strangers.

## Traction, framed the way the jury asked

Traction here means evidence from the target segment, qualitative first, quantitative after. State
what we have and what we do not.

**What we have, and it is small:** on testnet, with no marketing and no incentives, six wallets
placed 38 stakes totalling $64.10 staked and $62.68 returned after settlement. The result cards got
posted to the feed without us asking, which is the behaviour the product depends on.

**What we are doing next, say it as a plan with a date:** running the product with two real trading
groups and collecting qualitative feedback on one question, whether the thirty-second window makes
them play together or makes them play alone, then turning that into a short survey across the wider
segment to size how many people already screenshot their wins.

Do not call six wallets validation. Call it early signal, and say what would change our mind.

## Limitations, said plainly

The jury explicitly values honesty about limitations. Include these:

- **Testnet only.** The USDC has no monetary value. The product is complete end to end, the
  economics are not tested.
- **Demand is inferred, not proven.** We have behavioural evidence and market evidence, not users at
  scale.
- **A one-sided window voids and refunds today.** If everyone in a room calls the same side, there
  is nothing to pay out from. A maker on every window is the fix and it is not built yet.
- **Solana is written, not deployed.** The Anchor program compiles and passes an end-to-end local
  validator run; the devnet deploy is pending.

## What is actually shipped, for the product cutaways

- Six contracts live on Monad testnet, chain 10143. Market, groups, rooms, chat, profiles, sports,
  gas station. Tick contract `0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2`.
- Settlement is permissionless and paid: an outside bot earns half the 2% fee for settling a window.
  A real settled window from the chain: pools $1.00 above and $3.00 below, settled 11 seconds after
  close, $0.01 bounty paid to the settler.
- The social layer is on chain. Groups, rooms, members, avatars and chat live in contract storage;
  feed posts keep their photo bytes in the event log. We run no database.
- A signed Android APK, shipped as a Trusted Web Activity.
- Live at tick-predict.xyz. Repo public, MIT licensed. AI tooling disclosed in the README.

## Structure, two minutes

| Time | Who | Beat |
|---|---|---|
| 0:00–0:15 | Khalid | Who we are and the record. Multiple global web3 hackathon wins, production fintech. |
| 0:15–0:45 | Lakshmi Kanth | What Tick is, over product footage. Room, thirty seconds, scoreboard, card. |
| 0:45–1:10 | Khalid | The segment and our original assessment. Why thirty seconds, why a parallel chain made it possible now. |
| 1:10–1:35 | Lakshmi Kanth | What is shipped, and the early signal. Six wallets, 38 stakes, cards posted unprompted. Name it as early signal. |
| 1:35–1:50 | Khalid | The limitations, said without flinching. Testnet, demand inferred, one-sided windows void. |
| 1:50–2:00 | Both | What we do next and why we are the people to do it. |

## What Claude should produce

1. A word-for-word script with the timings above, written for speaking aloud, in our voice: short
   sentences, no marketing register, contractions fine.
2. A shot list saying for each beat whether it is talking head or product footage, and which screen.
3. On-screen text, sparing: the numbers only, never a sentence we are already saying.
4. A teleprompter version with the beats broken into breathable lines.
5. One alternative opening, fifteen seconds, in case the first feels stiff.

Assets available: `media/out/tick-demo-monad.mp4` for product footage, `media/store/` for stills,
`submission/tick-pitch-deck.pdf` for the visual language (dark, acid green `#d8f35f`, Geist).

## Rules for the script

- Never claim a user number we do not have. The only numbers are the ones in this file.
- Never say "revolutionary", "seamless", "game-changing", or "we are excited to".
- Say "early signal", not "traction", for the 38 stakes.
- Every claim about the product must be something a judge can check in the repo or at tick-predict.xyz.
- End on the next step, not on a slogan.
