/**
 * When an equity market can be traded.
 *
 * Pyth publishes US equities only while the exchange is open (9:30 to 16:00 New York,
 * weekdays). Outside that the last price freezes, the contract's freshness cutoff refuses
 * every stake against it, and a tester who taps a side just sees a refusal. So the
 * terminal treats a stale equity price as a closed market and says when it reopens.
 *
 * Whether a market is closed is decided by the price itself (no fresh publish for two
 * minutes), which also covers holidays and halts. The schedule below only names the next
 * session for the message; it does not know holidays, so on one it is a day early.
 */
export const STALE_AFTER_S = 120;

export function isFrozen(publishTime: number | null | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  return publishTime == null || now - publishTime > STALE_AFTER_S;
}

/** Parts of a timestamp in New York time. */
function nyParts(ms: number) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;

/** "today 9:30 ET", "Mon 9:30 ET": the next regular session open after `ms`. */
export function nextOpenLabel(ms = Date.now()): string {
  const now = nyParts(ms);
  const weekday = (w: string) => w !== "Sat" && w !== "Sun";
  if (weekday(now.weekday) && now.minutes < OPEN) return "today 9:30 ET";
  // Walk forward a day at a time until a weekday.
  for (let d = 1; d <= 7; d++) {
    const day = nyParts(ms + d * 86_400_000).weekday;
    if (weekday(day)) return `${d === 1 ? "tomorrow" : day} 9:30 ET`;
  }
  return "the next session";
}

/** True during regular hours on a weekday (holidays aside). */
export function inSession(ms = Date.now()): boolean {
  const now = nyParts(ms);
  return now.weekday !== "Sat" && now.weekday !== "Sun" && now.minutes >= OPEN && now.minutes < CLOSE;
}
