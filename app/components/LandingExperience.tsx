"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, Fingerprint, IdentificationCard, Trophy, UsersThree } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Brand } from "@/components/Brand";
import DotGrid from "@/components/DotGrid";
import { RoomStory } from "@/components/RoomStory";
import { openAuth } from "@/lib/authSession";
import { useTickWallet } from "@/lib/useTickWallet";

/* The product in four lines, led by the card. Every claim here is shipped. */
/* The whole journey, in the order someone actually does it, written to them. Every line
   is true of the product today except the card checkout, which says it is coming. */
const STEPS = [
  {
    Icon: Fingerprint,
    kicker: "Takes seconds",
    title: "Sign up.",
    copy: "Google, a passkey, email or X. No seed phrase. Two testnet USDC on us.",
  },
  {
    Icon: UsersThree,
    kicker: "Better with a crew",
    title: "Start a room.",
    copy: "Name it, pick a market, send the link. Everyone in it calls the same thirty seconds, from ten cents.",
  },
  {
    Icon: Trophy,
    kicker: "A world first",
    title: "Race the scoreboard.",
    copy: "A live table re-sorts as each window settles on Pyth. Polymarket's quickest takes five minutes. Ours takes thirty seconds.",
    source: { label: "CoinMarketCap", href: "https://coinmarketcap.com/academy/article/polymarket-debuts-5-minute-bitcoin-prediction-markets-with-instant-settlement" },
  },
  {
    Icon: IdentificationCard,
    kicker: "The whole point",
    title: "Flex your profits.",
    copy: "Win, and Tick draws your card from your real record, verified on chain. Post it to your group or the feed.",
  },
] as const;

/**
 * The landing page's way in. Signed out it opens the sign-up dialog; signed in there is nothing to
 * sign up to, so it goes to the feed. (It used to open the dialog regardless, which for a signed-in
 * visitor drew nothing and froze the page.)
 */
function Cta({ signedIn, className, children, signedInLabel = "Open the feed" }: { signedIn: boolean; className: string; children: React.ReactNode; signedInLabel?: string }) {
  if (signedIn) return <Link href="/feed" className={className}>{signedInLabel} <ArrowUpRight weight="bold" /></Link>;
  return <button type="button" className={className} onClick={() => openAuth("signup")}>{children} <ArrowUpRight weight="bold" /></button>;
}

export function LandingExperience() {
  const { account } = useTickWallet();
  const signedIn = !!account;
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
            <Cta signedIn={signedIn} className="landing-nav-cta" signedInLabel="Open feed">Sign up</Cta>
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
            <span className="hero-logo" aria-hidden="true"><span className="brand-mark"><i /><i /><i /></span></span>
            <h1 id="landing-title">Compete in groups.<br /><em>Flex your profits.</em></h1>
            <p className="landing-lede">
              Start a room, call the same thirty seconds as your crew, and race a live scoreboard. Win, and Tick makes the card that proves it.
            </p>
            <div className="landing-actions">
              <Cta signedIn={signedIn} className="landing-primary">Start a room</Cta>
              <a href="#how" className="landing-secondary">Watch a round <ArrowDown /></a>
            </div>
          </motion.div>
          <p className="landing-claim">The <em>world&apos;s first</em> 30-second prediction market</p>
          <div className="landing-hero-index" aria-hidden="true"><strong>00:30</strong></div>
        </section>

        <RoomStory />

        <section className="landing-why" id="why">
          <motion.div className="landing-section-head" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}>
            <p>Why Tick</p><h2>Trading is better when your friends are keeping score.</h2>
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
                  {"source" in step && (
                    <a className="step-source" href={step.source.href} target="_blank" rel="noreferrer">Source: {step.source.label}</a>
                  )}
                </div>
              </motion.li>
            ))}
          </ol>
          <div className="steps-cta">
            <p>No application. No minimum. Bring whoever you like.</p>
            <Cta signedIn={signedIn} className="landing-primary" signedInLabel="Go to your groups">Start a room</Cta>
          </div>
        </section>

        <section className="landing-close">
          <p>The world&apos;s first 30-second markets. Crypto. Equities. Sport.</p>
          <h2>Compete in groups.<br />Win the room.<br /><em>Flex your profits.</em></h2>
          <Cta signedIn={signedIn} className="landing-primary">Start a room</Cta>
        </section>
      </main>
      <footer className="landing-footer"><Brand /></footer>
    </div>
  );
}
