import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads contracts/.env into process.env without printing anything from it.
 *
 * Secrets live in exactly two files, both chmod 600 and gitignored:
 *   contracts/.env    DEPLOYER_PK, PYTH_API_KEY
 *   app/.env.local    OPERATOR_PK
 *
 * Nothing here is ever logged, and no secret may take a NEXT_PUBLIC_ prefix, which
 * would inline it into the browser bundle.
 */
/**
 * Walks up from this file looking for each env file, so the scripts work no matter which
 * directory they are invoked from. An earlier version used fixed relative paths and
 * silently found nothing, which surfaced as a confusing "PYTH_API_KEY is not set".
 */
function findUp(relative: string): string | undefined {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relative);
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      /* keep walking */
    }
    dir = resolve(dir, "..");
  }
  return undefined;
}

export function loadEnv(): void {
  for (const rel of ["contracts/.env", "app/.env.local", ".env.local"]) {
    const path = findUp(rel);
    if (!path) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (looked in contracts/.env and app/.env.local)`);
  return v;
}

/** For logs: proves which key is in use without revealing it. */
export function fingerprint(secret: string): string {
  let h = 0;
  for (let i = 0; i < secret.length; i++) h = (h * 31 + secret.charCodeAt(i)) | 0;
  return `len=${secret.length} fp=${(h >>> 0).toString(16).padStart(8, "0")}`;
}
