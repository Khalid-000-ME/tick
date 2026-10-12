# Tick indexer (Envio HyperIndex)

Indexes Monad testnet (chain 10143) through HyperSync and serves it over GraphQL:

- **Tick**: `Staked`, `Settled`, `Claimed`. The Portfolio page and the leaderboard read these.
- **TickProfiles**: `ProfileSet`, so names and pictures come in one request.
- **TickSocial**: groups, rooms, members and chat, with counts kept on each group and room.
- **TickFeed**: posts (with the photo's bytes, so photos are served without a node log query) and likes.

The app reads the indexer first and falls back to the chain for anything it does not answer, so
an older deployment of this indexer, or none at all, still works; it is just slower.

```bash
npm install
npm run codegen   # regenerate types after editing config.yaml or schema.graphql
npm run typecheck
npm run dev       # needs Docker; GraphQL at http://localhost:8080, Hasura console password: testing
```

Hosted: deploy this folder from GitHub on Envio Cloud (root directory `indexer`), then set
`NEXT_PUBLIC_INDEXER_URL` in `app/.env.local` to the endpoint it gives you. The URL is public by design.

If a contract is redeployed, update its `address` and `start_block` in `config.yaml` and its file in `abis/`.

Check the handlers without Docker or a token: `npx tsx test/replay.ts` replays the real events that are on the
chain through them, in memory, and `npx tsx test/likes.ts` checks a like being taken back.
