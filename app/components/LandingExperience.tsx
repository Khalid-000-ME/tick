"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CreditCard, CurrencyDollar, Fingerprint, GasPump, HandTap, Lightning } from "@phosphor-icons/react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Brand } from "@/components/Brand";
import DotGrid from "@/components/DotGrid";
import { TradeStory } from "@/components/TradeStory";

/* Why Tick, in six lines. Every claim here is either shipped or labelled as coming. */
const WHY = [
  {
    Icon: Lightning,
    title: "Faster than Polymarket.",
    copy: "Polymarket's quickest markets run five minutes. Tick's run thirty seconds, and the next one opens the moment one closes.",
    source: { label: "CoinMarketCap", href: "https://coinmarketcap.com/academy/article/polymarket-debuts-5-minute-bitcoin-prediction-markets-with-instant-settlement" },
  },
  { Icon: CurrencyDollar, title: "Dollars in, dollars out.", copy: "Every stake and every payout is in USDC, a dollar stablecoin. No volatile token to buy first, no price risk on your balance." },
  { Icon: CreditCard, title: "Pay with a card.", copy: "Stripe checkout lets you buy USDC with a card or bank transfer and start trading without ever opening an exchange.", tag: "Coming with mainnet" },
  { Icon: Fingerprint, title: "Sign in like any app.", copy: "Google, passkey, email or X. Your wallet is created for you: no seed phrase, no extension, nothing to install." },
  { Icon: GasPump, title: "Network fees, handled.", copy: "Fees are bought with USDC inside Tick, so there is never a second token to go and find." },
  { Icon: HandTap, title: "Start from ten cents.", copy: "Stakes from $0.10, one tap to place. Small enough to try, fast enough to want another." },
] as const;

const FIRST_TRADE = [
  ["Sign in", "With Google, a passkey or X. Done in seconds."],
  ["Add USDC", "Send it in, or pay by card once Stripe checkout is live."],
  ["Tap up or down", "Thirty seconds later, you know."],
] as const;

/* Where Tick goes from here. Plans, not shipped work: the "Now" column is the only one that
   describes what exists today, and every later item is phrased as intent. */
const ROADMAP = [
  {
    phase: "Now",
    title: "The product is live",
    items: ["Markets from 30 seconds to 5 minutes on crypto, stocks and sport", "Sign in with Google, passkey or X; one balance in USDC", "One-tap trading from $0.10, fees paid in USDC"],
  },
  {
    phase: "Next",
    title: "Real money, card checkout",
    items: ["Launch on Monad mainnet with real USDC", "Stripe card and bank checkout inside the app", "Independently audited contracts"],
  },
  {
    phase: "Then",
    title: "Every market, all week",
    items: ["Tokenized stocks that trade on weekends", "More leagues and in-play markets", "Leaderboard seasons with prizes"],
  },
  {
    phase: "Later",
    title: "Where people already are",
    items: ["Markets inside wallets and apps", "AI agents trading through MCP", "FX and commodities from Pyth"],
  },
] as const;

/* Revenue and valuation arithmetic, shown so a reader can redo it.
   The deployed contract takes 2% of profit and pays half of that to whoever settles the
   market, so the protocol keeps about 1% of profit. In a balanced market the losing pool
   is roughly half of everything staked, which puts protocol revenue near 0.5% of volume. */
const FEE_SHARE_OF_VOLUME = 0.005;
const ladder = [1_000_000, 10_000_000, 50_000_000];
const annual = (perDay: number) => perDay * FEE_SHARE_OF_VOLUME * 365;
const money = (n: number) => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  // Below $10M a rounded million hides the arithmetic: $1.83M must not read as $2M when a
  // reader is checking 0.5% x 365 themselves.
  if (n >= 10_000_000) return `$${Math.round(n / 1_000_000)}M`;
  // Rounded in whole ten-thousands first: toFixed alone turns $1,825,000 into $1.82M because
  // 1.825 is stored a hair under itself, while the arithmetic (and the pitch deck) says $1.83M.
  if (n >= 1_000_000) return `$${(Math.round(n / 10_000) / 100).toFixed(2)}M`;
  return `$${Math.round(n / 1000)}k`;
};

export function LandingExperience() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.34], [0, reduceMotion ? 0 : 90]);
  const heroScale = useTransform(scrollYProgress, [0, 0.3], [1, reduceMotion ? 1 : 1.07]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.32], [1, 0.3]);

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#how">How it works</a><a href="#why">Why Tick</a><a href="#market">Valuation</a><a href="#roadmap">Roadmap</a>
          <Link href="/markets" className="landing-nav-cta">Start free <ArrowUpRight weight="bold" /></Link>
        </nav>
      </header>
      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <motion.div className="landing-hero-media" style={{ y: heroY, scale: heroScale, opacity: heroOpacity }} aria-hidden="true">
            {/* Interactive dot field. It listens on the window, so the pointer moves it even
                over the headline and buttons; the canvas itself never takes clicks. Reduced
                motion is handled inside: no swell, no stretch, no shock, no intro. */}
            <DotGrid
              className="landing-dots"
              baseColor="#28301f"
              activeColor="#d8f35f"
              // No spreading circle while the page loads: the grid is simply there.
              intro={false}
              // No shockwave when the page is clicked; the dots only follow the pointer.
              clickShock={false}
              // Spacing from React Bits' "Dense" preset, for a tighter field.
              dotSize={3}
              gap={10}
              // Starts from React Bits' "Calm" preset, softened further so the pointer only
              // nudges the field: a weaker push, near-critical damping so dots glide back
              // without overshooting, a slower return, little stretching or swelling, and
              // less neighbour coupling so a nudge does not ripple across the grid.
              strength={0.2}
              bounce={0.1}
              tension={0.2}
              returnDuration={1.8}
              swell={0.2}
              stretch={0.05}
              glow={0.25}
              fade={0.5}
            />
          </motion.div>
          <div className="landing-hero-scrim" aria-hidden="true" />
          <motion.div className="landing-hero-content" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}>
            <h1 id="landing-title">Up or down?<br /><em>Thirty seconds to call it.</em></h1>
            <p className="landing-lede">
              Prediction markets ten times faster than Polymarket&apos;s, settled in dollars. Crypto, stocks
              and live sport, a new market every thirty seconds. Sign in with Google and make your first call in three taps.
            </p>
            <div className="landing-actions">
              <Link href="/markets" className="landing-primary">Browse live markets <ArrowUpRight weight="bold" /></Link>
              <a href="#how" className="landing-secondary">How it works <ArrowDown /></a>
            </div>
          </motion.div>
          <div className="landing-hero-index" aria-hidden="true"><span>PYTH / MONAD</span><strong>00:30</strong></div>
        </section>

        <TradeStory />

        <section className="landing-why" id="why">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}>
            <p>Why Tick</p><h2>Faster than the biggest name in prediction, and easier to start.</h2>
          </motion.div>
          <div className="why-grid">
            {WHY.map((w, index) => (
              <motion.article
                key={w.title}
                initial={reduceMotion ? false : { opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: (index % 3) * 0.08, duration: 0.5 }}
              >
                <div className="why-icon"><w.Icon weight="duotone" /></div>
                <h3>{w.title}</h3>
                <p>{w.copy}</p>
                {"tag" in w && <span className="why-tag">{w.tag}</span>}
                {"source" in w && <a className="why-source" href={w.source.href} target="_blank" rel="noreferrer">Source: {w.source.label}</a>}
              </motion.article>
            ))}
          </div>
          <div className="first-trade">
            <p className="first-trade-label">Your first trade</p>
            <ol>
              {FIRST_TRADE.map(([title, copy], index) => (
                <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><small>{copy}</small></div></li>
              ))}
            </ol>
            <Link href="/markets" className="landing-primary">Try it now <ArrowUpRight weight="bold" /></Link>
          </div>
        </section>

        <section className="landing-market" id="market">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}>
            <p>Future valuation</p><h2>A $180M business at 0.6% of a market that grew 10x in a year.</h2>
          </motion.div>

          <div className="market-stats">
            <div><strong>$50B</strong><span>Combined monthly volume on Kalshi and Polymarket, July 2026, up from under $5B in September 2025</span></div>
            <div><strong>80%</strong><span>Share of Kalshi&apos;s volume that is sports: short, repeatable events, not year-long questions</span></div>
            <div><strong>$22B</strong><span>Kalshi&apos;s valuation at its May 2026 Series F, on roughly $4B of annualised revenue</span></div>
          </div>

          <div className="landing-revenue">
            <h3>How Tick earns, and what that is worth</h3>
            <p className="revenue-intro">
              The deployed contract takes <strong>2% of profit</strong> and pays half of it to whoever settles the
              market, so the protocol keeps about 1% of profit, roughly <strong>0.5% of everything staked</strong>{" "}
              once pools are balanced. At the 5–14x revenue multiples Kalshi and Polymarket are being funded at, that
              compounds quickly.
            </p>
            <table className="revenue-table">
              <thead>
                <tr><th>Daily volume staked</th><th>Annual protocol revenue</th><th>Implied value at 10x</th></tr>
              </thead>
              <tbody>
                {ladder.map((perDay) => (
                  <tr key={perDay} className={perDay === 10_000_000 ? "is-target" : ""}>
                    <td>${perDay / 1_000_000}M / day</td>
                    <td>{money(annual(perDay))}</td>
                    <td>{money(annual(perDay) * 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="revenue-target">
              Our target is the middle row. <strong>$10M a day is about 0.6% of today&apos;s prediction-market
              volume</strong>, a ~$18M annual revenue business, which at the multiples above puts Tick near
              <strong> $180M</strong>. We are not trying to beat Kalshi at sports. We are taking the slice nobody
              can serve, because thirty-second settlement needs a chain that can take the write load.
            </p>
            <p className="landing-note">
              Volume, valuation and revenue figures are press reports, not filings, and the two platforms count
              volume differently (Kalshi reports contracts, Polymarket reports dollars), so combined totals are
              approximate. Revenue and valuation rows above are arithmetic from the deployed 2% fee assuming
              balanced pools, shown so the working can be checked. They are not a forecast.
              {" "}
              <a href="https://www.cnbc.com/2026/08/04/polymarket-seeks-fundraising-round-at-more-than-20-billion-valuation.html" target="_blank" rel="noreferrer">CNBC</a>,{" "}
              <a href="https://www.coindesk.com/business/2026/08/13/kalshi-in-talks-with-sequoia-wellington-for-usd750-million-fund-raise-at-usd40-billion-valuation" target="_blank" rel="noreferrer">CoinDesk</a>,{" "}
              <a href="https://coinlaw.io/prediction-market-statistics/" target="_blank" rel="noreferrer">coinlaw</a>.
            </p>
          </div>
        </section>

        <section className="landing-roadmap" id="roadmap">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}>
            <p>How we expand</p><h2>From the fastest market to every market, everywhere.</h2>
          </motion.div>
          <ol className="roadmap-track">
            {ROADMAP.map((step, index) => (
              <motion.li
                key={step.phase}
                className={index === 0 ? "is-now" : ""}
                initial={reduceMotion ? false : { opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: index * 0.1, duration: 0.55 }}
              >
                <span className="roadmap-phase">{step.phase}</span>
                <h3>{step.title}</h3>
                <ul>
                  {step.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </motion.li>
            ))}
          </ol>
        </section>

        <section className="landing-close">
          <p>Crypto. Equities. Sport.</p>
          <h2>One line.<br />Two sides.<br /><em>Thirty seconds.</em></h2>
          <Link href="/markets" className="landing-primary">Make your first call <ArrowUpRight weight="bold" /></Link>
        </section>
      </main>
      <footer className="landing-footer"><Brand /><span>Built on Monad</span><span>Testnet USDC. No real-money wagering.</span></footer>
    </div>
  );
}
