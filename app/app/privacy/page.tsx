import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Tick | Privacy Policy" };

/** What the app actually collects, in the order someone would ask about it. */
export default function Privacy() {
  return (
    <main className="legal">
      <Link href="/" className="legal-back">← tick</Link>
      <h1>Privacy Policy</h1>
      <p className="legal-date">Last updated 13 October 2026</p>

      <h2>The short version</h2>
      <p>
        We collect as little as the app can work with. We do not sell anything about you, we run no advertising, and we do
        not use third-party analytics or tracking. Most of what Tick shows is public blockchain data that anyone can read.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Sign-in details.</strong> Privy handles sign-in and holds the email address, social account or passkey you use. We see your wallet address and whether a wallet belongs to your account. Privy&apos;s own policy covers what they hold.</li>
        <li><strong>Your wallet address.</strong> Used to show your balance, your positions and your card.</li>
        <li><strong>What you put on chain.</strong> Stakes, claims, your profile name and picture, group and room membership, chat messages and feed posts, including photos, are written to a public blockchain by you. They are permanent, public, and not ours to delete.</li>
        <li><strong>A profile photo you upload.</strong> Re-encoded and stored by us, served from a link that anyone with it can open.</li>
        <li><strong>Ordinary server logs</strong> from our hosting provider, including IP address, used to keep the service running and to limit abuse of the free testnet funds.</li>
      </ul>

      <h2>What we do not collect</h2>
      <p>
        No advertising identifiers, no behavioural profiles, no location, no contacts, and no private keys. Your embedded
        wallet&apos;s key is handled by Privy, not by us.
      </p>

      <h2>Who else is involved</h2>
      <p>
        Privy for sign-in and wallets, Pyth for prices, a public blockchain node and an indexer for chain data, and Vercel
        for hosting. Each sees only what it needs to do its job.
      </p>

      <h2>Keeping it</h2>
      <p>
        On-chain data is permanent by design and cannot be removed by us or by you. We keep uploaded photos and server logs
        only as long as they are useful for running the service.
      </p>

      <h2>Your choices</h2>
      <p>
        You can stop using the app and log out at any time, and you can ask us to remove a profile photo you uploaded.
        To ask about your data, write to <a href="mailto:support@tick-predict.xyz">support@tick-predict.xyz</a>. We cannot
        delete anything that is already on the blockchain.
      </p>

      <h2>Children</h2>
      <p>Tick is not intended for children, and we do not knowingly collect anything from them.</p>
    </main>
  );
}
