# Privy integration feedback

Written for the Privy team, from integrating `@privy-io/react-auth` into Tick during the
Monad Metropolis hackathon (Oct 2026).

**Context:** Next.js 16.3.8 (App Router, Turbopack), React 19, `viem@2.57.3`, EVM-only,
targeting Monad testnet (chain 10143). We use email login + embedded EVM wallets, plus
injected-wallet connection. We do **not** use Solana, Farcaster, smart accounts, or
WalletConnect.

**Overall:** the integration itself was genuinely quick — the documented
`defaultChain`/`supportedChains` pattern worked first try with a `viem`-defined custom
chain, and `wallet.getEthereumProvider()` returning a real EIP-1193 provider meant it
dropped straight into our existing `viem` `custom()` transport with no adapter layer. The
four issues below are all about packaging and failure modes, not the API surface.

---

## 1. `npm install @privy-io/react-auth` fails on a clean project — HIGH friction

A plain install aborts:

```
npm error peerOptional ox@"^0.8.0" from permissionless@0.2.57
npm error   node_modules/permissionless
npm error     peerOptional permissionless@"^0.2.47" from @privy-io/react-auth@3.47.0
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
```

`--legacy-peer-deps` works. But the blocking conflict comes from `permissionless`, a
**`peerOptional`** dependency for smart accounts — a feature this app does not use and
never imports. An optional peer for an unused feature should not be able to fail the
install of the core SDK.

**Severity: high — and the workaround silently breaks the build.** This is the very first
command in the quickstart, and a developer's first experience of the SDK is an aborted
install naming three packages they've never heard of (`ox`, `permissionless`, nested
`viem`), none of which appear in the quickstart.

Worse, `--legacy-peer-deps` — the fix npm itself suggests — **produces an app that
compiles and then 500s at runtime**. Because legacy resolution skips peer installs,
`@stripe/stripe-js` never lands, and Privy's own fiat on-ramp screen imports it
transitively:

```
Module not found: Can't resolve '@stripe/stripe-js'
> 1 | import { loadStripe } from '@stripe/stripe-js';
  ./node_modules/@stripe/crypto/dist/stripe.esm.js
  ./node_modules/@privy-io/react-auth/dist/esm/FiatOnrampScreen-BAhYeiTI.mjs
  ./node_modules/@privy-io/react-auth/dist/esm/index-YiCw0Y_x.mjs
  ./app/providers.tsx
  ./app/layout.tsx
```

Note the import trace: it reaches `layout.tsx`, so **every route in the app dies**, not
just an on-ramp screen we never render. Our app has no fiat on-ramp, no Stripe
integration, and no intention of adding either; the dependency arrives purely because
`FiatOnrampScreen` is in the main entry point's import graph rather than behind a lazy
boundary.

The sequence a new developer hits is therefore: install fails → apply the suggested
workaround → app builds → app 500s with an error pointing at Stripe, which they never
asked for. Diagnosing that requires reading an import trace four levels deep into
`node_modules`.

Fixed by `npm install @stripe/stripe-js` explicitly, which is not mentioned anywhere we
could find.

**Suggestions:**
1. Relax the `permissionless` peer range so the plain install succeeds, which removes the
   need for `--legacy-peer-deps` and this entire failure chain.
2. Lazy-load `FiatOnrampScreen` so Stripe is not in the critical import path for apps
   that never show an on-ramp.
3. Failing both, list `@stripe/stripe-js` as a hard dependency rather than relying on
   peer resolution that the documented workaround disables.

---

## 2. A high-severity `ws` advisory, reachable only through the WalletConnect subtree

`npm audit --omit=dev` reports, in the production dependency path:

| Advisory | CVSS | CWE |
|---|---|---|
| [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) — `ws`: memory-exhaustion DoS from tiny fragments/chunks | **7.5** | CWE-400, CWE-770, CWE-1050 |
| [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) — `ws`: uninitialized memory disclosure | 4.4 | CWE-908 |

Vulnerable range: `ws >=8.0.0 <8.21.0`.

**To be fair to Privy: this is not Privy's own code, and Privy's own resolution is already
clean.** The actually-installed versions:

```
8.21.0   ws                                    <- top level, NOT vulnerable
8.18.3   @reown/appkit/ws                      <- vulnerable
8.18.3   @reown/appkit-utils/ws                <- vulnerable
8.18.3   @reown/appkit-controllers/ws          <- vulnerable
8.18.0   @wagmi/connectors/ws                  <- vulnerable
7.5.13   @walletconnect/jsonrpc-ws-connection  <- outside the advisory range
```

Every vulnerable copy sits under Reown AppKit / WalletConnect / wagmi-connectors, each of
which pins an **older `viem`** (`2.36.0`) that in turn pins old `ws`. The chain is:

```
@privy-io/react-auth@3.47.0
  └─ @walletconnect/ethereum-provider@2.22.4
       └─ @reown/appkit@1.8.9
            └─ @walletconnect/universal-provider@2.21.9
                 └─ @walletconnect/utils@2.21.9
                      └─ viem@2.36.0
                           └─ ws@8.18.3   ← vulnerable
```

**Real-world severity for us: low-to-moderate, but it should not be our judgment call.**
The vulnerable code is `ws`'s server/connection handling reached via WalletConnect's
websocket transport. We never enable WalletConnect, so we believe the path is unreachable
at runtime — but it is still installed, still in the tree, and still flagged by any CI
that runs `npm audit`, and "we think it's unreachable" is not something a team should have
to reason about to ship.

**The remediation npm offers is not usable:**

```json
"fixAvailable": { "name": "@privy-io/react-auth", "version": "3.6.1", "isSemVerMajor": true }
```

The only suggested fix is **downgrading Privy from 3.47.0 to 3.6.1** — 41 minor versions
back, flagged semver-major. `npm audit fix` (non-forced) changes nothing. So the options
are: ship with a flagged high-severity advisory, downgrade the SDK by a year, or hand-pin
transitive overrides. We chose to ship and document, rather than force-fix a dependency we
could not verify wouldn't break WalletConnect for other users of the same install.

**Suggestion:** bumping the `@walletconnect/ethereum-provider` / Reown AppKit range so the
nested `viem`/`ws` resolve to current versions would clear this for every downstream app at
once. Failing that, publishing a recommended `overrides` block would at least give teams a
sanctioned fix instead of each inventing one.

---

## 3. An invalid app ID takes down the entire route, with no actionable message

With a malformed `NEXT_PUBLIC_PRIVY_APP_ID`, the App Router returns **HTTP 500** for the
whole page tree:

```
⨯ Error: Cannot initialize the Privy provider with an invalid Privy app ID
    at ignore-listed frames {
  privyErrorCode: undefined,
  type: 'client_error',
  digest: '1147538638'
}
GET / 500
```

Two things make this worse than it needs to be:

1. **`PrivyProvider` throws during render.** In the App Router, a provider that throws
   while rendering takes down every route beneath it. A single mistyped env var in a
   preview deploy means a completely blank app, not a degraded login button.
2. **`privyErrorCode: undefined`** on an error whose entire purpose is to identify a
   specific misconfiguration. The message names the problem but gives no code to match
   against [the documented client error codes](https://docs.privy.io/basics/troubleshooting/error-handling/client-errors),
   and nothing points at *which* env var or *what* the expected format is.

**Severity: moderate.** Easy to diagnose once seen, but the failure is maximally loud
(whole app down) and the diagnostic is minimally helpful (no code, no expected format).

**Suggestion:** surface this as a recoverable state rather than a thrown error — an
`error`/`ready: false` on `usePrivy()` would let apps render a disabled login affordance
instead of nothing. At minimum, populate `privyErrorCode` and name the expected ID format
in the message.

We worked around it by guarding the provider ourselves — if the env var is absent we skip
`PrivyProvider` entirely and fall back to raw `window.ethereum`. That handles *missing*,
but not *malformed*, because malformed only fails inside the provider.

---

## 4. 534 packages for email login + an embedded EVM wallet

`npm install @privy-io/react-auth` added **594 packages**. The final `node_modules` holds
**534** top-level entries. Installed but unused by this app:

- `@solana/kit@5.5.1` and the whole `@solana/rpc-*` subtree (EVM-only app)
- `@walletconnect/ethereum-provider` + Reown AppKit (we use embedded + injected only)
- `permissionless` / smart-account machinery (no smart accounts)
- Farcaster and AGW connectors

There appears to be no documented way to opt out at install time — no subpath entry
points or optional-install flags that would let an EVM-only, embedded-wallet-only app
skip the Solana and WalletConnect trees. This is also the root cause of issues 1 and 2:
both the install failure and the `ws` advisory come from subtrees for features we never
touch.

**Severity: low on its own, but it compounds.** Bundle size we can measure and live with;
the install failure and the permanent audit finding are the real costs.

**Suggestion:** optional peer-dependency-driven connectors, or separate entry points
(`@privy-io/react-auth/evm`), would cut the install surface substantially for the large
number of apps that are single-ecosystem.

---

## What went well, specifically

Worth saying, because it's the majority of the experience:

- **Monad worked with zero special handling.** Passing our existing `viem` `defineChain`
  object as `defaultChain` + `supportedChains` was exactly what the docs said, and it
  worked first try on chain 10143. No RPC gymnastics, no "add network" prompt for a
  first-time embedded wallet.
- **`getEthereumProvider()` returning a genuine EIP-1193 provider** is the right
  abstraction. It let us write one wallet hook that backs onto either Privy or raw
  `window.ethereum` with an identical return shape, so no call site in the app needs to
  know which is active. That is a meaningfully better integration story than an SDK with
  its own bespoke transaction API.
- **`createOnLogin: "users-without-wallets"`** is exactly the right default. It let us
  honour a rule we care about — show the real address that actually signed — rather than
  pushing an embedded wallet onto someone who already has one.
- **The docs were accurate** where it counted. Every code shape we took from them matched
  the installed SDK, which is not a given at this pace of release.

---

## Reproduction

```bash
# Next.js 16.3.8, React 19, viem 2.57.3, pre-existing project
npm install @privy-io/react-auth          # fails: see issue 1
npm install @privy-io/react-auth --legacy-peer-deps   # succeeds
npm audit --omit=dev                      # see issue 2
# set NEXT_PUBLIC_PRIVY_APP_ID to a malformed value, then:
npx next dev                              # see issue 3: HTTP 500
```

Installed: `@privy-io/react-auth@3.47.0`.
