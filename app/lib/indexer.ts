/**
 * The Envio indexer, as a fast first read with the chain as the answer of record.
 *
 * One GraphQL request replaces several contract calls, and it does not count against the
 * node's request limit (25 a second, shared by everyone, which is what produced rate-limit
 * errors in the browser). But an indexer trails the chain by a few seconds and the hosted one
 * may predate a contract, so every caller keeps its chain read and uses this only when it
 * answers. `gql` returns null for anything short of a clean answer, and a schema the
 * deployment does not have yet is remembered for a minute rather than asked about on every
 * poll.
 *
 * Reads of what you just did yourself (a post, a new group) skip this on purpose: the chain
 * has it already, and a few seconds of "where did it go" is the worst thing a feed can do.
 */
const URL_ = process.env.NEXT_PUBLIC_INDEXER_URL;
const DEFAULT_MS = 3500;
const RETRY_AFTER_MS = 60_000;

let unsupportedUntil = 0;

export const indexerConfigured = Boolean(URL_);

export async function gql<T>(query: string, variables: Record<string, unknown> = {}, timeoutMs = DEFAULT_MS): Promise<T | null> {
  if (!URL_ || Date.now() < unsupportedUntil) return null;
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) {
      // A field this deployment does not have is not a transient fault: stop asking for a while.
      if (json.errors.some((e) => /field|not found|unknown|validation/i.test(e.message ?? ""))) unsupportedUntil = Date.now() + RETRY_AFTER_MS;
      return null;
    }
    return json.data ?? null;
  } catch {
    return null;
  }
}
