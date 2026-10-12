/**
 * The pointer you see in the demo.
 *
 * A real recording of a mouse looks jittery and the native cursor is not captured by the video, so the
 * demo draws its own: it fades in only when it is about to do something, glides to the target with a
 * blur that grows with its speed (the motion blur), presses, and fades out again. Everything here runs
 * inside the page, so it is captured by the same video as the app.
 */
window.__demo = (() => {
  const css = `
    #dc { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483647; pointer-events: none;
          opacity: 0; transform: translate3d(-100px,-100px,0); will-change: transform, filter;
          transition: opacity .22s ease, filter .14s linear; }
    #dc svg { display: block; filter: drop-shadow(0 4px 8px rgba(0,0,0,.45)); }
    #dc .ring { position: absolute; left: 2px; top: 2px; width: 26px; height: 26px; border-radius: 50%;
                border: 2px solid #d8f35f; opacity: 0; transform: scale(.3); }
    #dc.press .ring { animation: dcr .45s ease-out; }
    @keyframes dcr { 0% { opacity: .9; transform: scale(.3) } 100% { opacity: 0; transform: scale(2.4) } }
    /* The dev server's floating badge is not part of the product. */
    nextjs-portal, [data-nextjs-dev-tools-button], #__next-build-watcher { display: none !important; }
  `;
  const el = document.createElement("div");
  el.id = "dc";
  el.innerHTML = `<span class="ring"></span><svg viewBox="0 0 24 24" width="30" height="30">
    <path d="M4 2 L4 19 L8.5 14.6 L11.6 21.4 L14.4 20.2 L11.3 13.5 L17.6 13.5 Z" fill="#10120f" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  // This runs before the first paint, so there is no document to attach to yet.
  function attach() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    document.body.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();

  let x = -100, y = -100;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Glide to a point. The blur is tied to how far it travels, which is what reads as motion blur. */
  async function move(tx, ty, ms = 700) {
    const dist = Math.hypot(tx - x, ty - y);
    const blur = Math.min(5, Math.max(0, (dist / ms) * 2.6));
    el.style.transition = `transform ${ms}ms cubic-bezier(.33,0,.15,1), opacity .22s ease, filter .14s linear`;
    el.style.filter = `blur(${blur.toFixed(2)}px)`;
    el.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    x = tx; y = ty;
    await wait(ms * 0.62);
    el.style.filter = "blur(0px)";
    await wait(ms * 0.42);
  }

  const show = async () => { el.style.opacity = "1"; await wait(240); };
  const hide = async () => { el.style.opacity = "0"; await wait(240); };

  async function press() {
    el.classList.remove("press");
    void el.offsetWidth;
    el.classList.add("press");
    el.style.transform = `translate3d(${x}px,${y}px,0) scale(.82)`;
    await wait(130);
    el.style.transform = `translate3d(${x}px,${y}px,0) scale(1)`;
    await wait(180);
  }

  /** Where the cursor should sit for an element: its centre, with the tip landing on it. */
  function point(sel, nth = 0) {
    const n = document.querySelectorAll(sel)[nth];
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2) - 4, y: Math.round(r.top + r.height / 2) - 4, el: n };
  }

  return {
    move, show, hide, press, point, wait,
    /** Come in, glide to the thing, press it, and leave. */
    async tap(sel, { nth = 0, ms = 700, click = true, leave = true } = {}) {
      const p = point(sel, nth);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await show();
      await move(p.x, p.y, ms);
      await press();
      if (click) p.el.click();
      if (leave) { await wait(160); await hide(); }
      return true;
    },
    /** A scroll the viewer can follow, with the cursor out of the way. */
    async scroll(to, ms = 1200) {
      const from = window.scrollY;
      const t0 = performance.now();
      return new Promise((done) => {
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          window.scrollTo(0, from + (to - from) * e);
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
  };
})();
