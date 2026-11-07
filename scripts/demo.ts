// Scripted run of the whole 402 flow, no LLM needed.
// The "agent" here has no judgment at all: it pays every quote it gets.
// That is the point. Cubby's rules are the only thing standing between it and the vault.
//   npm run demo            (paid API must be running: npm run api)
//   npm run demo -- --slow  pauses between steps, for screen recording
import { Connection } from "@solana/web3.js";
import path from "path";
import { Offer, ROOT, agentPay, loadConfig, loadEnv, makeProgram, readKeypair, rpcUrl } from "../lib/cubby";

loadEnv();
const cfg = loadConfig();
const API = process.env.PAID_API_URL ?? "http://localhost:4021";
const slow = process.argv.includes("--slow");
const conn = new Connection(rpcUrl(cfg), "confirmed");
const agentKey = readKeypair(process.env.AGENT_KEYPAIR ?? path.join(ROOT, "keys", "agent.json"));
const program = makeProgram(conn, agentKey);

const say = (tag: string, msg: string) => console.log(`${tag.padEnd(8)} ${msg}`);
const pause = () => new Promise((r) => setTimeout(r, slow ? 1800 : 0));
const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

type Line = { endpoint: string; status: string; price: string; signature?: string; note?: string };
const receipt: Line[] = [];

async function report(entry: Record<string, unknown>) {
  await fetch(`${API}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

async function buy(endpoint: string, reason: string) {
  console.log("");
  say("GET", endpoint);
  const r = await fetch(API + endpoint);
  if (r.status !== 402) throw new Error(`${endpoint}: expected a 402 quote, got ${r.status}`);
  const offer = (await r.json()) as Offer;
  say("402", `${offer.title}: ${offer.price} USDC to ${offer.recipient.slice(0, 8)}...`);
  await pause();

  say("PAYING", `${offer.price} USDC, reason on-chain: "${reason}"`);
  const result = await agentPay(conn, program, cfg, agentKey, offer, reason);
  await report({
    endpoint,
    decision: "pay",
    status: result.status,
    price: offer.price,
    recipient: offer.recipient,
    reason,
    blockedBecause: result.status === "BLOCKED" ? result.reason : undefined,
    signature: result.signature,
  });

  if (result.status === "BLOCKED") {
    say("BLOCKED", `${result.reason}`);
    say("", tx(result.signature));
    // Try to pass the blocked tx off as payment anyway. The API should refuse it.
    const retry = await fetch(API + endpoint, { headers: { "X-Payment": result.signature } });
    const body = (await retry.json()) as { problem?: string };
    say("API", `${retry.status}: ${body.problem ?? "served?!"}`);
    receipt.push({ endpoint, status: "BLOCKED", price: offer.price, signature: result.signature, note: result.reason });
    await pause();
    return;
  }

  say("PAID", tx(result.signature));
  await pause();
  const got = await fetch(API + endpoint, { headers: { "X-Payment": result.signature } });
  const body = (await got.json()) as { data?: unknown; problem?: string };
  if (got.status !== 200) {
    say("REFUSED", `${got.status}: ${body.problem}`);
    receipt.push({ endpoint, status: "PAID, NOT SERVED", price: offer.price, signature: result.signature, note: body.problem });
    return;
  }
  say("GOT", JSON.stringify(body.data));

  // Same signature twice should not buy the data twice.
  const replay = await fetch(API + endpoint, { headers: { "X-Payment": result.signature } });
  const rb = (await replay.json()) as { problem?: string };
  say("REPLAY", `${replay.status}: ${rb.problem ?? "served again?!"}`);
  receipt.push({ endpoint, status: "PAID", price: offer.price, signature: result.signature });
  await pause();
}

async function main() {
  say("AGENT", agentKey.publicKey.toBase58());
  say("CUBBY", cfg.cubby);
  const catalog = (await (await fetch(`${API}/catalog`)).json()) as { path: string; price: string }[];
  say("CATALOG", catalog.map((c) => `${c.path} ${c.price}`).join(", "));
  await pause();

  await buy("/market", "SOL price for the briefing, 0.10 is fair");
  await buy("/news", "Latest Solana headlines for the briefing");
  // Looks like the same market data at the same price, but the payout address was swapped.
  await buy("/rogue", "Market data mirror, same price as usual");
  // Same data at 50x the price. A gullible agent pays; the per-payment cap says no.
  await buy("/rogue?mode=price", "Premium market data");

  console.log("\nRECEIPT");
  for (const l of receipt) {
    console.log(
      `  ${l.status.padEnd(8)} ${l.price.padStart(5)} USDC  ${l.endpoint.padEnd(18)} ${l.note ?? ""}`.trimEnd()
    );
    if (l.signature) console.log(`           ${tx(l.signature)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
