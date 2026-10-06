# Tick UX Flow

## Product principle

Tick should move a first-time visitor from understanding to participation without requiring them to learn oracle terminology, market creation, or contract architecture first.

The primary journey is:

```text
Understand the 30-second promise
  -> enter one live market
  -> select a familiar asset
  -> read price, strike, and remaining time
  -> choose ABOVE or BELOW
  -> select test-point stake
  -> connect or restore wallet
  -> complete one-time session funding
  -> submit stake
  -> observe cutoff, settlement, and claim
```

## 1. Landing

The landing page establishes three facts in the first viewport:

1. The market lasts thirty seconds.
2. Pyth data determines the outcome.
3. There is no trusted referee in the outcome path.

The primary action opens `/trade`. The visitor is not asked to connect a wallet before seeing the product.

## 2. Market entry

The market terminal defaults to BTC/USD because it trades continuously and remains demonstrable outside US equity hours.

The terminal presents:

- Asset selector in the top-left.
- Current price and movement.
- Pyth freshness.
- Thirty-second price chart.
- Horizontal strike line.
- Vertical close line.
- ABOVE and BELOW zones.
- Stake controls on the right.

The page avoids secondary dashboards, market cards, news, order books, and unrelated account analytics.

## 3. Asset selection

The selector groups assets into crypto and US equities.

Crypto:

- BTC/USD
- ETH/USD
- SOL/USD

Equities:

- AAPL
- TSLA
- MSFT

Every option uses the correct brand mark. Equity options explain that availability follows US market hours because stale prices are rejected by the contract.

Changing an asset updates the chart, current price, strike, pool ratio, and market question without navigating away.

## 4. Reading the market

The chart teaches the market visually:

- The strike line separates ABOVE from BELOW.
- The close line shows when the outcome becomes measurable.
- The moving trace shows the current relationship to strike.
- The countdown appears in both the global header and close-line annotation.
- The cutoff strip reports whether a stake would currently be accepted.

The user never has to translate YES and NO into price semantics. The actions always say ABOVE and BELOW.

## 5. Composing a position

The user:

1. Chooses ABOVE or BELOW.
2. Selects a quick amount or enters a custom amount.
3. Sees estimated return, fee policy, and settlement source.
4. Selects the primary action.

The displayed return is a pool-ratio estimate rather than guaranteed odds. Copy must state that the ratio can move until cutoff.

## 6. Wallet and session funding

If disconnected, the primary action opens Privy or the available EVM wallet.

If connected to the wrong network, the same action switches to Monad testnet.

A complete transaction implementation should then inspect:

- MON gas balance.
- TestUSD wallet balance.
- TestUSD allowance.
- Tick internal deposit.

Only the missing step should be shown:

```text
Need test points -> Claim test points
Need allowance   -> Approve once
Need deposit     -> Fund session
Ready            -> Submit stake
```

Returning users with a funded session skip setup and submit in one wallet confirmation.

## 7. Cutoff transition

The cutoff is a first-class state, not a disabled-button edge case.

Open state:

- Green status.
- Price age and maximum margin shown.
- Stake action enabled.

Closed state:

- Red status.
- Exact refusal reason shown.
- Stake action disabled for normal use.
- A judge-facing demonstration may attempt a clearly labelled late simulation or real reverted transaction.

The UI must decode `PriceTooStale` and explain when the price became too old relative to transaction inclusion.

## 8. Settlement

After the window closes:

- Trading controls collapse into an awaiting-settlement state.
- The chart freezes at close.
- A permissionless `Settle market` action becomes available.
- The settlement transaction sender is shown.
- Pyth settlement price and strike are displayed together.

The interface must never imply that an operator chooses the outcome.

## 9. Claim

After settlement:

- Winners see the exact previewed claim and a claim action.
- Losers see a zero result with a clear outcome explanation.
- VOID markets show the principal refund separately from winnings.
- The claim transaction links to Monadscan.
- Claimed value returns to the internal session balance for the next market.

## 10. Returning loop

After claim, the interface advances to the next aligned thirty-second window while preserving:

- Selected asset.
- Wallet session.
- Internal balance.
- Preferred stake amount.

The user should be able to move from one resolved window to the next without returning to the landing page or repeating setup.

## 11. Mobile behavior

On mobile:

- Chart appears first.
- Order ticket follows directly below it.
- Asset selector remains at the top of the chart.
- Stake action stays within thumb reach while active.
- No primary information requires horizontal scrolling.
- Hashes and methodology remain secondary disclosures.

## 12. Failure recovery

Every transaction state persists through refresh by transaction hash.

Required recoveries:

- Wallet rejection returns to composed order.
- RPC failure retains side and amount.
- Dropped or replaced transaction offers receipt lookup.
- Price becoming stale explains rejection without clearing the composed order.
- Insufficient internal balance takes the user directly to the missing funding step.
- Equity feed staleness outside market hours recommends a 24/7 crypto feed.

## 13. Judge flow

The three-minute judge path is:

1. Landing promise and generated motion visual.
2. Enter BTC/USD market.
3. Show asset selector and correct feed groups.
4. Explain strike and close lines.
5. Select a side and amount.
6. Watch the cutoff cross.
7. Show the exact late-stake refusal.
8. Show permissionless settlement.
9. Open contract and transaction evidence.

The user-facing flow leads with the market. Technical evidence appears exactly where it explains a visible behavior.
