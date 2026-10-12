/** Small formatting helpers shared by the messenger panes. */

/** The time on a list row: a clock for today, a weekday this week, a date after that. */
export function listTime(at: number, now = Date.now()): string {
  const d = new Date(at * 1000);
  const days = Math.floor((startOfDay(now) - startOfDay(d.getTime())) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The label of a day divider inside a chat. */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at * 1000);
  const days = Math.floor((startOfDay(now) - startOfDay(d.getTime())) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export const clock = (at: number) => new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const dayKey = (at: number) => {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
