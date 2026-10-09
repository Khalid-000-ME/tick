/** Asks the app for starter MON when a wallet cannot cover its gas. Returns true if it arrived. */
export async function requestGas(address: `0x${string}`): Promise<boolean> {
  try {
    const res = await fetch("/api/gas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const body = (await res.json()) as { ok?: boolean; skipped?: boolean };
    return res.ok && body.ok === true && body.skipped !== true;
  } catch {
    return false;
  }
}
