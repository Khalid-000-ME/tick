#!/usr/bin/env bash
# Deploy the Tick program to Solana devnet.
#
# The build is already pinned (see README); this only builds, checks the wallet can cover rent,
# deploys, and writes the resulting address into deployed.json for the app to read.
set -euo pipefail

export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."

CLUSTER="${CLUSTER:-devnet}"
TOOLS="${TOOLS:-v1.58}"

echo "building (platform-tools $TOOLS)"
cargo-build-sbf --tools-version "$TOOLS"

SO="target/deploy/tick.so"
SIZE=$(wc -c < "$SO" | tr -d ' ')
PROGRAM_ID=$(solana address -k target/deploy/tick-keypair.json)
NEED=$(solana rent "$SIZE" | awk '/Rent-exempt minimum/ {print $3}')
HAVE=$(solana balance | awk '{print $1}')

echo "program   $PROGRAM_ID"
echo "size      $SIZE bytes"
echo "rent      $NEED SOL needed, $HAVE SOL held"

if awk -v h="$HAVE" -v n="$NEED" 'BEGIN { exit !(h < n + 0.3) }'; then
  echo
  echo "not enough SOL. Top up this address and run again:"
  solana address
  echo "  https://faucet.solana.com  (devnet, 2 SOL per request)"
  exit 1
fi

solana program deploy "$SO" \
  --program-id target/deploy/tick-keypair.json \
  --url "$CLUSTER"

python3 - "$PROGRAM_ID" "$CLUSTER" <<'PY'
import json, sys, datetime, pathlib
program_id, cluster = sys.argv[1], sys.argv[2]
p = pathlib.Path("deployed.json")
d = json.loads(p.read_text()) if p.exists() else {}
d.update({
    "cluster": cluster,
    "programId": program_id,
    "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
})
p.write_text(json.dumps(d, indent=2) + "\n")
print("wrote deployed.json")
PY
