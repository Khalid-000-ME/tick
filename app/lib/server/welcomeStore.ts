import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Who has already had their welcome USDC.
 *
 * A gift that can be claimed twice is a faucet that can be drained, so claims are written
 * down, by Privy user id and by wallet address. They are kept in memory and mirrored to
 * .data/welcome.json so they survive a restart on a normal server.
 *
 * LIMIT, stated plainly: a serverless host (Vercel) has no persistent disk, so there the file
 * is lost between cold starts and only the in-memory copy protects a single instance. For
 * a production launch this belongs in a shared store (Vercel KV or Upstash Redis); the three
 * functions below are the whole interface to swap.
 */
interface Claims {
  users: Record<string, number>;
  addresses: Record<string, number>;
  /** Claims per client, per UTC day: "<ip>|<yyyy-mm-dd>" to a count. */
  ips: Record<string, number>;
  /** USDC units handed out per UTC day. */
  days: Record<string, number>;
}

const FILE = path.join(process.cwd(), ".data", "welcome.json");
let loaded: Claims | null = null;

async function load(): Promise<Claims> {
  if (loaded) return loaded;
  try {
    loaded = JSON.parse(await fs.readFile(FILE, "utf8")) as Claims;
  } catch {
    loaded = { users: {}, addresses: {}, ips: {}, days: {} };
  }
  return loaded;
}

async function save(c: Claims) {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(c), "utf8");
  } catch {
    /* read-only filesystem: the in-memory copy still holds for this instance */
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export async function hasClaimed(did: string, address: string): Promise<boolean> {
  const c = await load();
  return did in c.users || address.toLowerCase() in c.addresses;
}

export async function usageToday(ip: string): Promise<{ ipCount: number; dayUnits: number }> {
  const c = await load();
  return { ipCount: c.ips[`${ip}|${today()}`] ?? 0, dayUnits: c.days[today()] ?? 0 };
}

export async function recordClaim(did: string, address: string, ip: string, units: number) {
  const c = await load();
  const d = today();
  c.users[did] = Date.now();
  c.addresses[address.toLowerCase()] = Date.now();
  c.ips[`${ip}|${d}`] = (c.ips[`${ip}|${d}`] ?? 0) + 1;
  c.days[d] = (c.days[d] ?? 0) + units;
  await save(c);
}

/** Undo a claim whose transfer failed, so a user is never locked out by our error. */
export async function forgetClaim(did: string, address: string, ip: string, units: number) {
  const c = await load();
  const d = today();
  delete c.users[did];
  delete c.addresses[address.toLowerCase()];
  c.ips[`${ip}|${d}`] = Math.max(0, (c.ips[`${ip}|${d}`] ?? 1) - 1);
  c.days[d] = Math.max(0, (c.days[d] ?? units) - units);
  await save(c);
}
