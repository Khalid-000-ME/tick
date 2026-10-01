"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, ClockCountdown, Fingerprint, ShieldCheck } from "@phosphor-icons/react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Brand } from "@/components/Brand";

/* A plotted line for the proof panel, crossing the strike mid-way so the ABOVE/BELOW
   split the panel illustrates is actually visible. Illustrative, not live data — the
   live chart lives in the terminal, where it plots prices actually read from Pyth. */
const PROOF_PATH =
  "M 0 318 L 44 300 L 88 326 L 132 288 L 176 302 L 220 254 L 264 268 L 308 232 L 352 246 L 396 214 L 440 228 L 468 204 L 496 196";

const principles = [
  [ClockCountdown, "Thirty seconds, exactly.", "A fresh price market opens on a fixed grid. The terms are the market. Nothing waits for an operator to create it."],
  [Fingerprint, "The cutoff is visible.", "A stake lands only while the onchain Pyth price is fresh. Cross the ten-second margin and the contract refuses it."],
  [ShieldCheck, "Anyone can settle.", "Settlement compares public Pyth data with the strike. There is no reporter, referee, or admin deciding the outcome."],
] as const;

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
          <a href="#mechanism">Mechanism</a><a href="#proof">Proof</a>
          <Link href="/trade" className="landing-nav-cta">Open market <ArrowUpRight weight="bold" /></Link>
        </nav>
      </header>
      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <motion.div className="landing-hero-media" style={{ y: heroY, scale: heroScale, opacity: heroOpacity }} aria-hidden="true">
            <div className="landing-hero-orb" />
          </motion.div>
          <div className="landing-hero-scrim" aria-hidden="true" />
          <motion.div className="landing-hero-content" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}>
            <p className="landing-kicker"><span /> Live on Monad testnet</p>
            <h1 id="landing-title">The market moves.<br /><em>You have thirty seconds.</em></h1>
            <p className="landing-lede">Take a side on the next price window. Public Pyth data closes it. No referee gets a vote.</p>
            <div className="landing-actions">
              <Link href="/trade" className="landing-primary">Enter the live market <ArrowUpRight weight="bold" /></Link>
              <a href="#mechanism" className="landing-secondary">See the mechanism <ArrowDown /></a>
            </div>
          </motion.div>
          <div className="landing-hero-index" aria-hidden="true"><span>PYTH / MONAD</span><strong>00:30</strong></div>
        </section>
        <section className="landing-signal" aria-label="Protocol facts">
          <span><i /> Price freshness enforced onchain</span><span>10s measured acceptance margin</span><span>6 verified Pyth feeds</span><span>Test points only</span>
        </section>
        <section className="landing-mechanism" id="mechanism">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }}>
            <p>The integrity layer</p><h2>Fast enough to feel live.<br />Strict enough to say no.</h2>
          </motion.div>
          <div className="landing-principles">
            {principles.map(([Icon, title, copy], index) => (
              <motion.article key={title} initial={reduceMotion ? false : { opacity: 0, y: 34 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ delay: index * 0.09, duration: 0.55 }}>
                <div className="landing-principle-icon"><Icon weight="duotone" /></div><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p>
              </motion.article>
            ))}
          </div>
        </section>
        <section className="landing-proof" id="proof">
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
            <p className="landing-proof-label">What the judge can verify</p><h2>The refusal is part of the product.</h2>
            <p>Watch the onchain price age cross the measured margin. A late stake does not get quietly accepted or manually reviewed. It reverts with the exact reason.</p>
            <dl><div><dt>Price source</dt><dd>Pyth on Monad</dd></div><div><dt>Outcome path</dt><dd>Permissionless</dd></div><div><dt>Shared writes between steady-state stakes</dt><dd>0 measured</dd></div></dl>
            <Link href="/trade" className="landing-text-cta">Open the market terminal <ArrowUpRight /></Link>
          </motion.div>
        </section>
        <section className="landing-close"><p>BTC. ETH. SOL. AAPL. TSLA. MSFT.</p><h2>One line.<br />Two sides.<br /><em>Thirty seconds.</em></h2><Link href="/trade" className="landing-primary">Make your call <ArrowUpRight weight="bold" /></Link></section>
      </main>
      <footer className="landing-footer"><Brand /><span>Built for Monad Metropolis</span><span>Testnet points. No real-money wagering.</span></footer>
    </div>
  );
}
