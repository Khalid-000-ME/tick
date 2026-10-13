/**
 * The Monad evidence tail for the demo: contract, chain, a real settled window and the bounty the
 * outside settler earned, every number pulled live from the indexer and the RPC at render time.
 * Nothing here is typed in by hand, so it cannot drift from what the chain says.
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const APP = "/Users/khalid/Projects/colosseum/tick/app";
const env = readFileSync(`${APP}/.env.local`, "utf8");
const INDEXER = env.match(/^NEXT_PUBLIC_INDEXER_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const RPC = "https://testnet-rpc.monad.xyz";
const CONTRACT = "0x16B57356a482Fc5b307bB76D7dC8F5d76A6Be1b2";

const gql = (query) => fetch(INDEXER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
const rpc = (method, params) => fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());

const m = (await gql(`{ Market(limit:1, where:{settler:{_is_null:false}, bounty:{_gt:"0"}, totalAbove:{_gt:"0"}, totalBelow:{_gt:"0"}}, order_by:{settledAt:desc}) { id outcome settler bounty totalAbove totalBelow settledAt closesAt } }`)).data.Market[0];
const meta = (await gql(`{ chain_metadata { chain_id latest_processed_block } }`)).data.chain_metadata[0];
const head = parseInt((await rpc("eth_blockNumber", [])).result, 16);
const usdc = (s) => (Number(s) / 1e6).toFixed(2);
const short = (s) => `${s.slice(0, 10)}…${s.slice(-6)}`;

const rows = [
  ["Chain", `Monad testnet · ${meta.chain_id}`],
  ["Tick contract", short(CONTRACT)],
  ["Head block", head.toLocaleString("en-US")],
  ["Indexed to", Number(meta.latest_processed_block).toLocaleString("en-US")],
  ["Window settled", `${m.settledAt - m.closesAt}s after close`],
  ["Pools", `$${usdc(m.totalAbove)} above · $${usdc(m.totalBelow)} below`],
  ["Settler bounty", `$${usdc(m.bounty)} to ${short(m.settler)}`],
];

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;overflow:hidden;background:#080a07;
background-image:radial-gradient(ellipse 60% 70% at 50% 44%, #1e2d11 0%, #0c1109 56%, #070907 100%);
font-family:'Geist',sans-serif;color:#eef1e6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:54px}
h1{font-size:76px;font-weight:600;letter-spacing:-2.6px}
h1 em{font-style:normal;color:#d8f35f}
table{border-collapse:collapse;font-family:'Geist Mono',monospace;font-size:30px}
td{padding:17px 36px;border-bottom:1px solid #1d2619}
td:first-child{color:#8d9582;text-align:right}
td:last-child{color:#eef1e6}
.hi td:last-child{color:#d8f35f}
.f{font-family:'Geist Mono',monospace;font-size:24px;letter-spacing:3px;color:#79816d}
</style></head><body>
<h1>Settled on <em>Monad</em>, by anyone who turns up.</h1>
<table>${rows.map(([k, v], i) => `<tr class="${i >= 4 ? "hi" : ""}"><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
<p class="f">read live from the chain · tick-predict.xyz</p>
</body></html>`;

writeFileSync("/tmp/monad-proof.html", html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file:///tmp/monad-proof.html");
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
await p.screenshot({ path: "/Users/khalid/Projects/colosseum/tick/media/build/monad-proof.png" });
await b.close();
console.log(rows.map((r) => r.join(": ")).join("\n"));
