import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Tick | Terms of Use" };

/** Plain terms for a testnet app. Short on purpose: anything longer would be padding nobody reads. */
export default function Terms() {
  return (
    <main className="legal">
      <Link href="/" className="legal-back">← tick</Link>
      <h1>Terms of Use</h1>
      <p className="legal-date">Last updated 13 October 2026</p>

      <h2>What Tick is</h2>
      <p>
        Tick is a prediction market that settles 30-second price windows, plus the groups, rooms and feed around it.
        It currently runs on a <strong>test network</strong>. The USDC used in the app is testnet USDC: it is handed out
        for free, cannot be bought or sold, and has no monetary value. Nothing in Tick is an investment, and no money
        you can spend elsewhere changes hands.
      </p>

      <h2>Who can use it</h2>
      <p>
        You must be old enough to enter a contract where you live, and you must not use Tick where prediction markets
        or similar contests are prohibited. You are responsible for knowing the rules that apply to you.
      </p>

      <h2>Your account and your wallet</h2>
      <p>
        You sign in through Privy, which creates or connects a wallet for you. You are responsible for your account and
        for anything done with it. We cannot reverse a transaction, recover a wallet, or undo a stake: once something is
        sent to the chain it is out of our hands.
      </p>

      <h2>What you post</h2>
      <p>
        Posts, photos, group names and chat messages are written to a public blockchain. They are permanent and visible
        to anyone, and we cannot delete them. Do not post anything you would mind being public forever, anything that is
        not yours to post, or anything unlawful. We may stop showing content in our own interface, but it remains on chain.
      </p>

      <h2>No guarantees</h2>
      <p>
        Tick is provided as it is, without warranty. It depends on third parties, including a price oracle, a blockchain
        network and a hosting provider, any of which can fail or be delayed. Markets can void and refund. We are not
        liable for losses arising from use of the app, to the extent the law allows.
      </p>

      <h2>Changes</h2>
      <p>
        We may change these terms as the product changes, and the date above will say when. If we launch on a main network
        with real funds, these terms will be replaced before that happens.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: <a href="mailto:support@tick-predict.app">support@tick-predict.app</a>.</p>
    </main>
  );
}
