# Tick indexer (Envio HyperIndex)

Indexes `Staked`, `Settled` and `Claimed` from the Tick contract on Monad testnet (chain 10143) through HyperSync, and serves them over GraphQL. The app's Portfolio page reads a wallet's full history from it.

```bash
npm install
npm run codegen   # regenerate types after editing config.yaml or schema.graphql
npm run typecheck
npm run dev       # needs Docker; GraphQL at http://localhost:8080, Hasura console password: testing
```

Hosted: deploy this folder from GitHub on Envio Cloud (root directory `indexer`), then set
`NEXT_PUBLIC_INDEXER_URL` in `app/.env.local` to the endpoint it gives you. The URL is public by design.

If Tick is redeployed, update `address` and `start_block` in `config.yaml` and `abis/Tick.json`.
