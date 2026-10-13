# Pitch video — plan, script and assets

Two minutes, landscape 1920x1080. They ask for three things: who you are, the problem you solve, and
why you are building it. They are judging how you think and communicate, so this is deliberately
plain. No music bed under the voice, no stock footage, no slogan at the end.

Everything you need is in this folder. Shoot the talking head, drop the b-roll and cards over it.

## How to shoot it

Phone on something steady, window light in front of you, plain wall behind. Record both of you
separately in one take each, then cut between. Do not read the script word for word, it is audible.
Read it twice, then say it in your own words.

If the edit feels bare, cut to b-roll a beat **before** the sentence that describes it, never after.

## The cut

| Time | On screen | Who | What is said |
|---|---|---|---|
| 0:00–0:04 | `cards/01-title.png` | — | hold silent, or start talking over it |
| 0:04–0:14 | Khalid to camera, `cards/02-khalid.png` as a lower third at 0:06 | Khalid | "I'm Khalid, this is Lakshmi Kanth, and we built Tick. Between us we've won several global web3 hackathons, and Lakshmi Kanth has shipped production fintech." |
| 0:14–0:24 | `cards/03-lakshmikanth.png` at 0:15, then back to camera | Lakshmi Kanth | "I handle the social layer and the app. Khalid handles the contracts and settlement. We've been building this one together for the whole hackathon." |
| 0:24–0:40 | `cards/04-problem.png` at 0:26, hold | Khalid | "Prediction markets already won the argument. Billions get staked on being right. But the fastest market anyone runs takes five minutes, and you play it alone, on a screen built for one person." |
| 0:40–0:52 | `broll/04-the-room.mp4` | Khalid | "Meanwhile everything people actually enjoy about trading, the group chat, the running score, the screenshot of the win, happens in a different app entirely." |
| 0:52–1:04 | `cards/05-answer.png`, then `broll/02-calling-a-window.mp4` at 0:56 | Lakshmi Kanth | "So Tick settles every thirty seconds, and you play it in a room with your friends. Everyone calls the same window, from ten cents, and a live board re-sorts after every one." |
| 1:04–1:16 | `broll/03-posting-the-card.mp4`, then `broll/05-the-card.mp4` at 1:10 | Lakshmi Kanth | "Win, and the app draws a card from your real on-chain record and drops it in the group chat. Nobody can fake a win and nobody can hide a loss, because the number comes off the chain." |
| 1:16–1:32 | `broll/06-the-board.mp4`, then to camera | Khalid | "Nobody shipped a sub-minute market before because at the close of a window every settlement and claim lands at once, and a serial chain can't carry that for a ten cent stake. Monad executes them in parallel. That's why this is buildable now." |
| 1:32–1:44 | `cards/06-honest.png`, hold | Lakshmi Kanth | "We'll be straight about where we are. It's testnet, so the economics are untested. Six wallets have placed 38 stakes with no marketing, and the cards got posted without us asking. That's early signal, not traction." |
| 1:44–1:56 | `broll/01-signup-to-stake.mp4` | Khalid | "What is real is the product. Sign in with an email, no seed phrase, and you're calling a thirty second window about fifteen seconds later. Six contracts live, an Android build shipped, the social layer on chain." |
| 1:56–2:00 | `cards/07-close.png` | both | "Come call thirty seconds with us." |

## Assets

### B-roll, landscape, the app in a phone, silent

| File | Length | Shows |
|---|---|---|
| `broll/01-signup-to-stake.mp4` | 34s | signing in and the wallet placing a stake |
| `broll/02-calling-a-window.mp4` | 26s | the confirm sheet, the stake landing, the pool moving |
| `broll/03-posting-the-card.mp4` | 22s | a card posted to the feed |
| `broll/04-the-room.mp4` | 20s | the room with the live window and the board |
| `broll/05-the-card.mp4` | 15s | the card itself, +$3.68, verified on chain |
| `broll/06-the-board.mp4` | 13s | the leaderboard |

All 1920x1080, 30fps, no audio, so you can lay them under the voice anywhere.

### Cards, 1920x1080

`01-title` · `02-khalid` · `03-lakshmikanth` · `04-problem` · `05-answer` · `06-honest` · `07-close`

Hold a card for at least three seconds. `04-problem`, `05-answer` and `06-honest` carry numbers, so
give those four or five.

### Also usable

`../pitch/stills/09-monad-proof.png` if you want the chain evidence on screen when Monad is
mentioned at 1:16. Every number on it was read live from the chain.

## Rules the script already follows

- Nothing claimed that is not in the submission. The only usage numbers are six wallets and 38 stakes.
- The limitations are said out loud, by you, before a judge has to find them.
- It ends on the next step, not a slogan.
- Nobody says "revolutionary", "seamless" or "we are excited to".
