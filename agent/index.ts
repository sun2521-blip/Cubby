// The agent: gets a task, browses paid endpoints, decides what is worth paying
// for, pays through Cubby, retries with the tx signature as proof, then answers.
//   npx tsx agent/index.ts "Give me a SOL briefing"
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { Connection } from "@solana/web3.js";
import path from "path";
import { Offer, ROOT, agentPay, loadConfig, loadEnv, makeProgram, readKeypair, rpcUrl } from "../lib/cubby";

loadEnv();
const cfg = loadConfig();
const API = process.env.PAID_API_URL ?? "http://localhost:4021";
const MODEL = process.env.CUBBY_MODEL ?? "claude-opus-5-5";
const task =
  process.argv.slice(2).join(" ") ||
  "Give me a quick SOL briefing: current price and the latest Solana news.";

const conn = new Connection(rpcUrl(cfg), "confirmed");
const agentKey = readKeypair(process.env.AGENT_KEYPAIR ?? path.join(ROOT, "keys", "agent.json"));
const program = makeProgram(conn, agentKey);
const quotes = new Map<string, Offer>();

const say = (tag: string, msg: string) => console.log(`${tag.padEnd(8)} ${msg}`);

async function report(entry: Record<string, unknown>) {
  await fetch(`${API}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

const listEndpoints = betaZodTool({
  name: "list_endpoints",
  description: "List the paid data endpoints on the API with their titles and prices.",
  inputSchema: z.object({}),
  run: async () => {
    const r = await fetch(`${API}/catalog`);
    return JSON.stringify(await r.json());
  },
});

const callApi = betaZodTool({
  name: "call_api",
  description:
    "GET an endpoint, e.g. /market or /rogue?mode=price. Returns the data, or a 402 payment quote " +
    "(price in USDC, recipient, description) when payment is required.",
  inputSchema: z.object({ endpoint: z.string().describe("Path starting with /") }),
  run: async ({ endpoint }) => {
    const r = await fetch(API + endpoint);
    const body = (await r.json()) as Offer;
    if (r.status === 402) {
      quotes.set(endpoint, body);
      say("402", `${endpoint} wants ${body.price} USDC -> ${body.recipient.slice(0, 8)}...`);
      return JSON.stringify({
        status: 402,
        title: body.title,
        description: body.description,
        price: body.price,
        recipient: body.recipient,
      });
    }
    return JSON.stringify({ status: r.status, body });
  },
});

const payAndFetch = betaZodTool({
  name: "pay_and_fetch",
  description:
    "Pay the quoted price for an endpoint from the Cubby wallet, then fetch the data using the " +
    "payment as proof. Only use it when the data is worth the price for the task. The wallet " +
    "enforces the owner's rules and can block a payment.",
  inputSchema: z.object({
    endpoint: z.string().describe("Same endpoint string you passed to call_api"),
    reason: z.string().describe("One short line on why this is worth the price. Stored on-chain."),
  }),
  run: async ({ endpoint, reason }) => {
    const offer = quotes.get(endpoint);
    if (!offer) return "No quote for that endpoint yet. Call call_api first.";
    if (offer.mint !== cfg.mint) return "Quote asks for a different token than the wallet holds. Not paying.";

    say("PAYING", `${offer.price} USDC for ${endpoint}: ${reason}`);
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
      say("BLOCKED", `${result.reason}  tx ${result.signature}`);
      return JSON.stringify({ status: "BLOCKED", reason: result.reason, signature: result.signature });
    }
    say("PAID", `tx ${result.signature}`);
    const r = await fetch(API + endpoint, { headers: { "X-Payment": result.signature } });
    const body = (await r.json()) as { data?: unknown; problem?: string };
    if (r.status !== 200) {
      say("REFUSED", `server said: ${body.problem ?? r.status}`);
      return JSON.stringify({ status: "PAID_BUT_NOT_SERVED", signature: result.signature, problem: body.problem });
    }
    say("GOT", `${endpoint} data`);
    return JSON.stringify({ status: "PAID", signature: result.signature, data: body.data });
  },
});

const decline = betaZodTool({
  name: "decline",
  description: "Record that you chose not to pay for an endpoint, with a one-line reason.",
  inputSchema: z.object({ endpoint: z.string(), reason: z.string() }),
  run: async ({ endpoint, reason }) => {
    const offer = quotes.get(endpoint);
    say("SKIP", `${endpoint}: ${reason}`);
    await report({ endpoint, decision: "decline", status: "DECLINED", price: offer?.price, reason });
    return "Noted.";
  },
});

const SYSTEM = `You are a research agent with a small USDC allowance held in a Cubby wallet on Solana.
Paid endpoints answer with an HTTP 402 quote. For each quote, decide whether the data is worth the price for the user's task.
If it is, call pay_and_fetch with a one-line reason; that line is written on-chain for the owner to read. If it is not, call decline with a one-line reason.
Only buy what the task needs. The wallet enforces the owner's spending rules on-chain. If a payment comes back BLOCKED, do not retry it; tell the user what was blocked and why.
End with a short answer to the task, then a receipt: one line per endpoint with PAID, BLOCKED or DECLINED, the price, and the tx signature if there is one.`;

async function main() {
  say("TASK", task);
  const client = new Anthropic();
  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    tools: [listEndpoints, callApi, payAndFetch, decline],
    messages: [{ role: "user", content: task }],
  });

  if (final.stop_reason === "refusal") {
    say("REFUSAL", JSON.stringify(final.stop_details));
    return;
  }
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  console.log("\n" + text.trim());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
