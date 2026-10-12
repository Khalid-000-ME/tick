"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CurrencyDollar, Lightning, ShieldCheck } from "@phosphor-icons/react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Brand } from "@/components/Brand";
import DotGrid from "@/components/DotGrid";

/* A plotted line for the proof panel, crossing the strike mid-way so the ABOVE/BELOW
   split the panel illustrates is actually visible. Illustrative, not live data — the
   live chart lives in the terminal, where it plots prices actually read from Pyth. */
const PROOF_PATH =
  "M 0 318 L 44 300 L 88 326 L 132 288 L 176 302 L 220 254 L 264 268 L 308 232 L 352 246 L 396 214 L 440 228 L 468 204 L 496 196";

const steps = [
  [Lightning, "Pick a side.", "Bitcoin, Ether, Solana or Tesla. One tap on green or red and you are in. No order book, no slippage, no counterparty to find."],
  [CurrencyDollar, "Wait thirty seconds.", "The window closes. Whichever side was right splits the money the other side staked, in proportion to what each person put in."],
  [ShieldCheck, "Get paid automatically.", "Winnings land in your balance without you clicking anything. You can check the result against Pyth's own published price yourself."],
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
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
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
          <a href="#how">How it works</a><a href="#market">Market</a><a href="#trust">Trust</a>
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
              // React Bits' "Calm" preset, verbatim. Everything else stays at its default.
              strength={0.5}
              bounce={0.3}
              returnDuration={1.4}
              swell={0.4}
              stretch={0.2}
              glow={0.25}
              fade={0.5}
            />
          </motion.div>
          <div className="landing-hero-scrim" aria-hidden="true" />
          <motion.div className="landing-hero-content" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}>
            <p className="landing-kicker"><span /> Free to play · no deposit, no KYC</p>
            <h1 id="landing-title">Up or down?<br /><em>Thirty seconds to call it.</em></h1>
            <p className="landing-lede">
              Crypto, equities and live sport. Tap green or red. If you are right, you split what
              the other side staked. There is no house taking the other end of your bet and no one who can decide
              you lost.
            </p>
            <div className="landing-actions">
              <Link href="/markets" className="landing-primary">Browse live markets <ArrowUpRight weight="bold" /></Link>
              <a href="#how" className="landing-secondary">How it works <ArrowDown /></a>
            </div>
          </motion.div>
          <div className="landing-hero-index" aria-hidden="true"><span>PYTH / MONAD</span><strong>00:30</strong></div>
        </section>

        <section className="landing-signal" aria-label="At a glance">
          <span><i /> A new market every 30 seconds</span><span>2,880 windows a day, per asset</span><span>10 assets plus live sport</span><span>Free testnet USDC</span>
        </section>

        <section className="landing-mechanism" id="how">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }}>
            <p>How it works</p><h2>Three taps.<br />Thirty seconds.</h2>
          </motion.div>
          <div className="landing-principles">
            {steps.map(([Icon, title, copy], index) => (
              <motion.article key={title} initial={reduceMotion ? false : { opacity: 0, y: 34 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ delay: index * 0.09, duration: 0.55 }}>
                <div className="landing-principle-icon"><Icon weight="duotone" /></div><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="landing-market" id="market">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}>
            <p>The opportunity</p><h2>Prediction markets grew 10x in a year. The money went to the fastest ones.</h2>
          </motion.div>

          <div className="market-stats">
            <div><strong>$50B</strong><span>Combined monthly volume on Kalshi and Polymarket, July 2026, up from under $5B in September 2025</span></div>
            <div><strong>80%</strong><span>Share of Kalshi&apos;s volume that is sports: short, repeatable events, not year-long questions</span></div>
            <div><strong>$22B</strong><span>Kalshi&apos;s valuation at its May 2026 Series F, on roughly $4B of annualised revenue</span></div>
          </div>

          <div className="market-wedge">
            <h3>Our wedge is duration.</h3>
            <p>
              The volume already sits in fast, repeatable markets. But even a sports market needs a fixture list,
              a referee and hours of waiting. A crypto price resolves continuously, which means a market can open
              and settle every thirty seconds, forever, with no event calendar and nobody to adjudicate it.
            </p>
            <p>
              That is <strong>2,880 markets a day per asset</strong> instead of a handful a week. It turns
              prediction from something you check back on into something you do: the difference between a betting
              slip and a game.
            </p>
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

        <section className="landing-proof" id="trust">
          <motion.div className="landing-proof-visual" initial={reduceMotion ? false : { opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.35 }}>
            <div className="proof-window">
              <div className="proof-window-head"><span>BTC / USD</span><span>30s WINDOW</span></div>
              <svg viewBox="0 0 520 490" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="proofFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#d8f35f" stopOpacity="0.2" />
                    <stop offset="1" stopColor="#d8f35f" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="proof-fill" d={`${PROOF_PATH} L 520 490 L 0 490 Z`} />
                <path className="proof-stroke" d={PROOF_PATH} />
                <circle className="proof-dot" cx="496" cy="196" r="5" />
              </svg>
              <div className="proof-line"><span>STRIKE</span><strong>on the grid</strong></div>
              <div className="proof-cutoff"><span /> ACCEPTING WHILE THE PRICE IS FRESH</div>
            </div>
          </motion.div>
          <motion.div className="landing-proof-copy" initial={reduceMotion ? false : { opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.35 }}>
            <p className="landing-proof-label">Why you can trust the result</p><h2>Nobody can decide you lost.</h2>
            <p>
              The outcome is a comparison between Pyth&apos;s published price at the close and the strike. No reporter
              files it, no admin confirms it, and there is no dispute window, because there is no judgement to
              dispute. Every settled bet has a Verify button that recomputes the result from Pyth in your own
              browser, so you never have to take our word for it.
            </p>
            <dl>
              <div><dt>Price source</dt><dd>Pyth, read live</dd></div>
              <div><dt>Who settles</dt><dd>Anyone, for a fee share</dd></div>
              <div><dt>Payouts</dt><dd>Automatic, no claim step</dd></div>
            </dl>
            <Link href="/markets" className="landing-text-cta">Open the markets board <ArrowUpRight /></Link>
          </motion.div>
        </section>

        <section className="landing-close">
          <p>Crypto. Equities. Sport.</p>
          <h2>One line.<br />Two sides.<br /><em>Thirty seconds.</em></h2>
          <Link href="/markets" className="landing-primary">Make your call <ArrowUpRight weight="bold" /></Link>
        </section>
      </main>
      <footer className="landing-footer"><Brand /><span>Built on Monad</span><span>Testnet USDC. No real-money wagering.</span></footer>
    </div>
  );
}
