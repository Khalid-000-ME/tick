# Tick — Frontend & UX Brief

Open-ended implementation notes for whoever builds the UI. This is not a spec to follow
literally — it's the context, constraints, and a menu of flows. Use design judgment on
top of it.

**What Tick actually is, in one line:** 30-second price markets on Monad, settled by
reading Pyth, where a stake is only accepted while the on-chain price is fresh. No
reporter, no operator, no admin in the outcome path — the thing to make the user *feel*
is that nobody is being trusted to referee this.

---

## 1. The real data model (ground everything in this)

Nothing below is speculative — it's the deployed contract's actual interface.

```solidity
// A market's identity IS its terms. There is no "create market" step.
struct Terms {
    bytes32 feedId;    // which Pyth feed
    int64   strike;    // price level, in the feed's own units
    int32   expo;       // feed exponent (e.g. -8 for crypto, -5 for equities)
    uint64  closesAt;   // window close, aligned to a 30s grid
}
// marketId = keccak256(abi.encode(feedId, strike, expo, closesAt))

struct Settlement {
    uint8   outcome;      // 0 unresolved, 1 ABOVE, 2 BELOW, 3 VOID
    uint64  resolvedAt;
    int64   settlePrice;
    uint16  feeBps;        // captured at settlement, can't change after
    uint128 totalAbove;
    uint128 totalBelow;
}
```

Six feeds are listed, verified live against Pyth on Monad testnet:

| Symbol | Kind | Trades | Strike step |
|---|---|---|---|
| BTC/USD, ETH/USD, SOL/USD | crypto | 24/7 | $100 / $10 / $1 |
| AAPL, TSLA, MSFT | equity | US market hours only (14:30–21:00 UTC, weekdays) | $1 |

**This asymmetry is a feature, not a bug, and the UI should say so.** Outside market
hours, equity stakes are correctly refused because the price has gone stale — not
because of a clock check, but because nobody can tell you the true price right now. That
*is* the product's integrity property, visible on an asset people recognize.

Key reads: `pools(id)`, `previewClaim(id, user)`, `cutoffStatus(feedId)` → `(ok, priceAge,
margin, price)`, `feesAccrued(address)`. Key writes: `deposit`, `stakeOn(terms, above,
amount)`, `settle(terms)` (permissionless), `claim(id)`.

**The acceptance margin is 10 seconds**, derived from measurement (submit→receipt p95
2.2s, on-chain price age after a refresh up to 6s), not a round number chosen for taste.
Whatever copy explains the cutoff should use the real number and, ideally, the real
measurement — "10s, measured against this chain's own inclusion latency" is a much
stronger claim than "fast."

---

## 2. The one thing the UI has to make someone feel

A judge should be able to:
1. Watch a countdown tick inside the acceptance window.
2. Watch it cross the line.
3. Try to stake anyway (or watch a staged "late stake" attempt) and see it **bounce with
   a reason**, not a generic error.
4. See that the transaction that settles the market could have come from anybody's
   wallet — not a "resolve" button that only an admin can press.

If the UI only does one thing well, it's #3. Nothing else in this product is as visceral.

---

## 3. Information architecture (suggested, not binding)

| Route | Purpose |
|---|---|
| `/` | One market, live, big. Not a dashboard — a single thing happening right now. |
| `/markets` | Grid of open/recent windows across all 6 feeds. |
| `/markets/[id]` | One market's full lifecycle: pools, countdown, cutoff state, settlement, claims. |
| `/evidence` | Contracts, explorer links, the three concurrency numbers (see §7), a link to the test suite. |
| *(optional)* `/activity` | A live feed of stakes/settles/claims across all markets — good for a "things are actually happening" ambient view during a demo. |

A single-market hero view and a `/markets` grid probably cover 90% of what a judge
clicks through in three minutes. Don't over-build IA for a 30-second-market product —
the depth should be in *one* market's lifecycle, not in navigation.

---

## 4. Onboarding: the actual decision to make

Today the app uses raw `window.ethereum` — it requires an installed extension wallet,
silently does nothing for anyone without one, and that's most of a recruited demo
audience.

### Option A — keep raw wallet-only
Simplest, zero new dependencies, already built (`lib/useWallet.ts`). Fails hard for
anyone without MetaMask/Rabby/etc. Fine if every demo participant is guaranteed to have
one; risky for a classroom/live-session audience.

### Option B — add Privy
Privy explicitly lists Monad as a supported chain and lets you configure a default chain
plus a list of supported chains for embedded wallets — no custom RPC gymnastics needed
beyond the standard EVM config. It gives:
- Email / social / passkey login → an embedded wallet, no extension required.
- The option to *still* let a wallet-having user connect their own wallet instead.
- A real sponsor bounty: **"Privy!" — $5,000, task-based**, in the Metropolis sponsor
  list. Low effort to claim relative to the prize, because the integration is exactly
  what the product already needs.

**Recommendation: do B.** The honboarding gap is real (recruited users without wallets),
the sponsor prize is close to free given the need already exists, and Privy's embedded
wallet still signs real transactions on Monad testnet — nothing about the "real
contracts, no mocks" constraint is compromised.

### Onboarding flow with Privy (suggested)

1. **Landing** — no login wall. A visitor can see live markets and pools immediately
   (read-only client already exists for this). Staking is the only gated action.
2. **"Stake" tap** → Privy modal: email or passkey. No seed phrase, no extension
   install, no "switch network" dialog for a first-time user — Privy's default chain
   setting makes a fresh embedded wallet start on Monad testnet already.
3. **First deposit** — the contract uses an internal balance (`deposit`/`withdraw`), so
   after one `approve` + `deposit`, every subsequent stake is a single transaction with
   no repeated approval. Make this explicit in copy: "one-time setup, then every stake
   is one tap."
4. **Faucet nudge** — a new embedded wallet has 0 MON. Either sponsor the first bit of
   gas server-side (a small relayer/paymaster top-up) or link straight to
   `faucet.monad.xyz` with the address pre-copied. This is the one step most likely to
   lose a first-time user; don't make them hunt for it.
5. **Returning user** — Privy persists the session; a second visit should skip straight
   to a funded, ready-to-stake state. This is also the detail that makes a second live
   session (returning wallets) look credible rather than staged.

### What NOT to do
Don't hide which wallet signed what. If Privy relays a transaction via an embedded
wallet, the UI should still show the real signer address and a real explorer link — the
project's whole pitch is "nobody has to be trusted," and a UI that obscures who actually
signed undermines that in a small but real way.

---

## 5. Core user flows

### 5.1 Staking flow
1. User sees a market: feed, strike, "closes in Xs," live pool split (ABOVE/BELOW as a
   bar, not just two numbers — this is the one thing worth making look alive).
2. **Cutoff indicator, always visible**: a small live readout of `cutoffStatus` —
   "price fresh, Xs ago" in green, or "price stale — staking closed" in red. This should
   update at least once a second near the boundary; it's the countdown from §2.
3. User picks a side and an amount. Before submitting, preview the pool-ratio payout if
   they're right (`previewClaim`-style math on the client, since the real pool changes
   with every stake — show it as "if you're the last stake," not a guarantee).
4. Submit. If it fails because the price just went stale, **do not show a generic
   revert**. Decode `PriceTooStale(publishTime, margin)` and say exactly that: "the price
   went stale 2s before your stake landed — it was correctly refused."
5. Confirmed stake joins the live pool view immediately (optimistic update), confirmed
   by the real event once it lands.

### 5.2 The cutoff demonstration (the money shot)
This deserves a dedicated, almost theatrical UI moment, separate from ordinary staking:
- A visible countdown to the next price refresh / margin boundary.
- A "try to stake now" button that's enabled right up to the edge and disabled the
  instant `cutoffStatus` flips.
- If you want a true "late stake" demo: have a second, unfunded or deliberately-delayed
  flow attempt a stake a few seconds past the boundary and show it bounce on-screen, with
  the decoded error and a link to the reverted transaction (or a clearly labeled
  simulation if you don't want to spend real gas on a guaranteed-fail tx).
- Label clearly which part is live and which, if any, is staged. The brief this project
  has followed throughout is: never claim a simulation is a live result.

### 5.3 Settlement flow
- As soon as `closesAt` passes, the UI should show "awaiting settlement" with a live
  `cutoffStatus`-style readout of whether a fresh-enough price exists yet to settle.
- **Crucial UX point:** let a user trigger settlement themselves, or show a "settle
  now" button available to anyone — because on-chain, it genuinely is permissionless.
  If a keeper usually does this first, the button should still exist and still work,
  because that's the proof. A market that only ever gets settled by one background
  process looks, to a skeptical judge, exactly like one with a hidden operator.
- Show the settlement transaction's sender prominently, and make a point of it NOT being
  the same address every time if your demo data supports that.

### 5.4 Claim flow
- `previewClaim` before claiming, so the number on the button matches the number that
  lands.
- Losing side should see "$0 — this side lost" rather than nothing, so the UI doesn't
  look broken for half the participants.
- VOID outcome (one-sided pool, or no settlement in time) should read as a full refund,
  explicitly labeled "refunded — not a payout," so void markets in a live demo don't
  read as a broken product.

### 5.5 Evidence / methodology page
This is the page a technical judge actually reads. Needs, at minimum:
- Contract addresses + explorer links (Tick, Pyth, TestUSD).
- The three real concurrency numbers, with the honest caveat that they're Foundry
  simulations, not a measurement of Monad's live scheduler (see §7 — do not let the UI
  overclaim this).
- A plain-language explanation of the cutoff and the 10-second margin, with the actual
  measured numbers behind it, not a vibe.
- Link to the test suite / repo.

---

## 6. States, errors, and copy rules

### States every market view needs
- No wallet connected (read-only, still shows live pools)
- Wallet connected, zero balance (nudge to deposit)
- Window open, cutoff open (can stake)
- Window open, cutoff closed/stale (cannot stake — explain why, don't just disable)
- Window closed, awaiting settlement
- Settled ABOVE / BELOW (winner's view vs loser's view differ)
- VOID (refund framing, not failure framing)
- One-sided pool mid-window (warn before it voids, don't surprise the staker after)

### Decoded errors, not generic ones
The contract's custom errors are specific and worth surfacing verbatim-ish:
`PriceTooStale`, `ExpoMismatch`, `OffStrikeGrid`, `OffWindowGrid`, `NotOpen`,
`AlreadySettled`, `NoSettlementPrice`, `SettleWindowOpen`. A generic "transaction failed"
anywhere a judge might click is a wasted opportunity to show the mechanism working.

### Copy rules (carried over from this project's existing discipline)
- Never say "trustless" — say what's actually true: "settlement is a comparison anyone
  can recompute from Pyth's public price."
- Never say the cutoff "eliminates" latency arbitrage — it narrows the window to a
  measured number of seconds.
- Never imply Pyth data is exclusive to this chain or this product.
- If a number is simulated/measured-in-Foundry rather than observed live on Monad, label
  it as such, every time it appears, not just the first time.
- "Points" / "tUSD" language, not "bets" or real-money framing — this is a testnet
  product.

---

## 7. The concurrency story, and how NOT to overclaim it in the UI

Measured, real results (Foundry simulation, `vm.startStateDiffRecording`):

| Scenario | Result |
|---|---|
| Two stakes, price already fresh | **0** read-after-write conflicts |
| A stake's reads/writes on Pyth's own storage | **5 reads, 0 writes** |
| A price refresh in the *same block* as a stake | **5** conflicts (this is the honest limit) |
| Two claims | **0** shared writes |
| 30 participants over 64 shards | **10** colliding pairs of 435 |

If this appears in the UI (and it should — it's the most defensible technical claim the
project has), present all five numbers together, including the negative control. A
page that shows only the zeros and omits the "5 conflicts when X happens" result reads,
to anyone who checks, as cherry-picked. The negative control is what makes the measurement
credible — don't bury it in a footnote.

---

## 8. Sponsor technology — what's worth integrating and why

Ranked by fit, not by prize size alone. Metropolis sponsor prizes stack on top of the
$30k track prize; judges mark down obvious bolt-ons, so pick ones that the product
already wants.

| Sponsor | Prize | Fit | Verdict |
|---|---|---|---|
| **Privy** | $5,000 | Solves a real onboarding gap (no-extension login via embedded wallet); Monad is an explicitly supported chain | **Do it** |
| **Chainlink CRE** | $3,000 | CRE workflows are exactly "trigger → fetch → compute → write," which is what the keeper script already does by hand. Migrating the keeper to a CRE workflow would mean the price refresh is run by a decentralized oracle network instead of one centralized key | **Worth attempting** if CRE supports writing to Monad; verify this before committing time — not yet confirmed |
| **Envio** | $1,000 | "Best Use of Envio" indexer. A market-history/activity feed (§3, `/activity`) is a natural indexer use case and is cheap to add once the contract is stable | **Easy secondary pick** |
| **Agora** | $10,000 | "Best Mobile Trading App on Monad" is a plausible fit if the frontend is built mobile-first from the start (not retrofitted). Their *other* bounty (cross-border payments) requires AUSD, which is mainnet-only and out of scope on testnet — don't chase that one | **Only if mobile-first is the real plan**, and only the trading-app bounty, not the AUSD one |
| **Perpl** | $5,000 + $3,000 | API + analytics/risk-tool bounty. Possible fit for the evidence/methodology page as a risk-analytics surface, but check what Perpl's API actually offers before committing | **Investigate, don't commit yet** |
| Kuru, Nansen, Dynamic, others | varies | Not an obvious fit for a settlement-mechanism product without real stretching | **Skip** |

**Recommended set: Privy (confirmed fit, real gap, low risk) + Envio (cheap, obvious
use) as the core two.** Treat CRE and Agora as stretch goals only if time remains after
the core product and the cutoff demo are airtight — a half-integrated sponsor SDK that
breaks the live demo is worse than not touching it.

---

## 9. What "looks real" vs "looks staged," carried over from this project's own traction notes

A live session looks credible when:
- participants are not all funded within the same two minutes from one faucet call
- stake sizes vary
- arrival times of stakes roughly follow real price movement, not an instructor's "go now"
- at least one participant is not someone who was recruited specifically for this
- a second session, on a different day, shows returning (not fresh) wallets

It looks staged when all wallets fund in one burst, everyone stakes once, and every pool
has suspiciously round numbers. The UI can't fix a staged session, but it also shouldn't
fight against a real one — avoid any "demo mode" toggle that fabricates pool numbers for
effect. If a pool genuinely has one person in it and voids, let it void on screen. That
honesty is worth more than a smoothed-over fake pool.
