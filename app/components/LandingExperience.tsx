"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CurrencyDollar, Fingerprint, HandTap, Lightning, Trophy } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Brand } from "@/components/Brand";
import DotGrid from "@/components/DotGrid";
import { TradeStory } from "@/components/TradeStory";

/* Why Tick, in six lines. Every claim here is either shipped or labelled as coming. */
/* The whole journey, in the order someone actually does it, written to them. Every line
   is true of the product today except the card checkout, which says it is coming. */
const STEPS = [
  {
    Icon: Fingerprint,
    kicker: "Takes seconds",
    title: "Sign in with Google.",
    copy: "Or a passkey, email or X. No seed phrase. No extension.",
  },
  {
    Icon: CurrencyDollar,
    kicker: "Stable, not volatile",
    title: "Add stablecoins.",
    copy: "Your balance is USDC, so a dollar stays a dollar. Fees come out of it too.",
    tag: "Card checkout coming",
  },
  {
    Icon: HandTap,
    kicker: "No bankroll needed",
    title: "Start with ten cents.",
    copy: "Risk almost nothing to find out if you are any good.",
  },
  {
    Icon: Lightning,
    kicker: "A world first",
    title: "Know in thirty seconds.",
    copy: "The first prediction market to settle in 30 seconds. Polymarket's quickest takes five minutes.",
    source: { label: "CoinMarketCap", href: "https://coinmarketcap.com/academy/article/polymarket-debuts-5-minute-bitcoin-prediction-markets-with-instant-settlement" },
  },
  {
    Icon: Trophy,
    kicker: "Nothing up front",
    title: "Keep what you win.",
    copy: "We take 2% of winnings. Nothing if you miss.",
  },
] as const;

export function LandingExperience() {
  const reduceMotion = useReducedMotion();
  const { scrollY, scrollYProgress } = useScroll();

  // The navbar is transparent while the hero is in focus and becomes a floating capsule once
  // the hero has scrolled away. The threshold is the hero's own height, so it holds at any
  // screen size; a little before the bottom edge, so the change lands as the hero leaves.
  const heroRef = useRef<HTMLElement>(null);
  const [capsule, setCapsule] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setCapsule(y > (heroRef.current?.offsetHeight ?? 700) - 90));
  const heroY = useTransform(scrollYProgress, [0, 0.34], [0, reduceMotion ? 0 : 90]);
  const heroScale = useTransform(scrollYProgress, [0, 0.3], [1, reduceMotion ? 1 : 1.07]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.32], [1, 0.3]);

  return (
    <div className="landing-shell">
      <header className={`landing-nav ${capsule ? "is-capsule" : ""}`}>
        <div className="landing-nav-bar">
          <Brand />
          <nav aria-label="Primary navigation">
            <a href="#how">How it works</a><a href="#why">Why Tick</a>
            <Link href="/markets" className="landing-nav-cta">Start free <ArrowUpRight weight="bold" /></Link>
          </nav>
        </div>
      </header>
      <main>
        <section ref={heroRef} className="landing-hero" aria-labelledby="landing-title">
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
            <p className="landing-badge">The world&apos;s first 30-second prediction market</p>
            <h1 id="landing-title">Up or down?<br /><em>Thirty seconds to call it.</em></h1>
            <p className="landing-lede">
              A record time, ten times faster than Polymarket. Paid in stablecoins.
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
            <p>Why Tick</p><h2>The fastest market on Earth. Your first call, in about a minute.</h2>
          </motion.div>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <motion.li
                key={step.title}
                initial={reduceMotion ? false : { opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5 }}
              >
                <div className="step-rail" aria-hidden="true">
                  <span className="step-num">{index + 1}</span>
                </div>
                <div className="step-body">
                  <p className="step-kicker"><step.Icon weight="duotone" /> {step.kicker}</p>
                  <h3>{step.title}</h3>
                  <p className="step-copy">{step.copy}</p>
                  {"tag" in step && <span className="step-tag">{step.tag}</span>}
                  {"source" in step && (
                    <a className="step-source" href={step.source.href} target="_blank" rel="noreferrer">Source: {step.source.label}</a>
                  )}
                </div>
              </motion.li>
            ))}
          </ol>
          <div className="steps-cta">
            <p>No application. No minimum.</p>
            <Link href="/markets" className="landing-primary">Make your first call <ArrowUpRight weight="bold" /></Link>
          </div>
        </section>

        <section className="landing-close">
          <p>The world&apos;s first 30-second markets. Crypto. Equities. Sport.</p>
          <h2>One line.<br />Two sides.<br /><em>Thirty seconds.</em></h2>
          <Link href="/markets" className="landing-primary">Make your first call <ArrowUpRight weight="bold" /></Link>
        </section>
      </main>
      <footer className="landing-footer"><Brand /></footer>
    </div>
  );
}
