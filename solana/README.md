# Tick on Solana

The Monad market, ported to an Anchor program. Same rules, same numbers: 30-second windows, a
market named by its own terms, parimutuel payout, a 2% fee on profit, and a permissionless
settlement that pays the caller half the fee up to 2 USDC.

| | |
|---|---|
| Program | `programs/tick/src/lib.rs` |
| Pyth reader | `programs/tick/src/pyth.rs` |
| IDL | `idl/tick.json` |
| Program id | `5adXZ1k5eYzyzsnAEkHsEjTfQdg1QMv53H9Ltjj9vV2v` |
| Cluster | devnet |

## What carries over, and what changes

The EVM contract shards its pools 64 ways so that two people staking the same window do not write
the same storage slot. On Solana that sharding is unnecessary: each trader's stake lives in its own
`Position` PDA, seeded by `(market, owner)`, so the only shared writes in a window are the two pool
counters on the market account. At the close of a window the settles and claims fan out across one
account per trader, which is the parallelism the whole 30-second idea depends on.

Three instructions:

- `stake(terms, above, amount)` — the first staker opens the market, because `(feed_id, strike,
  expo, closes_at)` seeds its PDA. Refused if the posted Pyth price is more than 10 seconds old.
- `settle()` — anyone may call it once the window has closed, passing a Pyth update whose publish
  time is within 20 seconds of the close. One-sided or unsettled for 10 minutes, the market voids
  and everyone is refunded. The caller takes half the fee, capped at 2 USDC.
- `claim()` — stake back plus a pro rata share of what the losing side left after the fee, or a
  refund from a voided market.

## Reading Pyth without the SDK

`pyth-solana-receiver-sdk` pins its own Anchor and Solana versions, which pulls a second copy of
both into the build and does not resolve. `programs/tick/src/pyth.rs` does the same work directly:
it checks the account is owned by the Pyth receiver program
(`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`), carries the `PriceUpdateV2` discriminator, is
`Full` verified rather than partially signed, and describes the feed that was asked for. The layout
is copied from the SDK's own source, version 0.6.1.

## Build

The build toolchain is pinned, because the stock one is older than several crates in the dependency
graph:

```bash
cargo-build-sbf --tools-version v1.58
```

`platform-tools` v1.58 carries a Rust new enough for `edition2024` crates. Anchor's own
`anchor build` uses v1.46 (Rust 1.79) and fails on them. `Cargo.lock` additionally pins `blake3`,
`base64ct` and `anchor-lang` to versions that keep one copy of Anchor in the graph.

## Deploy

```bash
./scripts/deploy.sh
```

It builds, checks the wallet can cover rent (about 1.48 SOL for a 290 KB program), deploys, and
writes the address to `deployed.json`. Devnet SOL comes from https://faucet.solana.com; the CLI's
own `solana airdrop` is usually rate-limited.
