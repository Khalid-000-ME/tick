#!/usr/bin/env bash
# Run the end-to-end market test against a fresh local validator.
#
# The validator is started with two preloaded Pyth price accounts: one fresh enough to stake
# against, one published at the close to settle with. The window is set a little ahead of now, so
# the test waits for it rather than warping the clock.
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."

WORK="${TMPDIR:-/tmp}/tick-localnet"
rm -rf "$WORK" && mkdir -p "$WORK"

npx ts-node scripts/fixture.ts "$WORK"

solana-test-validator \
  --ledger "$WORK/ledger" \
  --reset --quiet \
  --bpf-program "$(solana address -k target/deploy/tick-keypair.json)" target/deploy/tick.so \
  --account "$(cat "$WORK/stake.pubkey")" "$WORK/stake.json" \
  --account "$(cat "$WORK/close.pubkey")" "$WORK/close.json" \
  > "$WORK/validator.log" 2>&1 &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null || true' EXIT

echo "waiting for the validator"
for _ in $(seq 1 60); do
  if solana --url http://127.0.0.1:8899 cluster-version > /dev/null 2>&1; then break; fi
  sleep 1
done

npx ts-node scripts/localtest.ts
