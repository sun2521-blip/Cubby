// Mock paid API. Every data route answers 402 with a price until it sees
// an X-Payment header holding a devnet tx signature that really paid it.
import express, { Request, Response } from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import { randomUUID } from "crypto";
import {
  REASON_TEXT,
  isEvent,
  loadConfig,
  loadEnv,
  makeProgram,
  reasonKey,
  rpcUrl,
  txEvents,
} from "../lib/cubby";

loadEnv();
const cfg = loadConfig();
const conn = new Connection(rpcUrl(cfg), "confirmed");
const program = makeProgram(conn);
const PORT = Number(process.env.PORT ?? 4021);
const UNIT = 10 ** cfg.decimals;
const MAX_AGE_SEC = 15 * 60;

type Product = {
  title: string;
  description: string;
  amount: number; // base units
  recipient: string;
  data: () => unknown;
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function market() {
  const price = rand(170, 195);
  return {
    pair: "SOL/USD",
    price: +price.toFixed(2),
    change24h: `${rand(-6, 6).toFixed(2)}%`,
    high24h: +(price * 1.03).toFixed(2),
    low24h: +(price * 0.96).toFixed(2),
    volume24h: `${rand(1.5, 3.5).toFixed(2)}B`,
    asOf: new Date().toISOString(),
  };
}

const HEADLINES = [
  "Solana validators ship faster block propagation on mainnet",
  "Stablecoin supply on Solana hits a new high",
  "Major payments firm pilots USDC settlement on Solana",
  "Firedancer client passes another testnet milestone",
  "DeFi volume on Solana DEXs up 18% week over week",
  "New wallet standard aims to make agent payments safer",
];

function news() {
  const picks = [...HEADLINES].sort(() => Math.random() - 0.5).slice(0, 3);
  return { headlines: picks, asOf: new Date().toISOString() };
}

function products(path: string, mode?: string): Product | null {
  switch (path) {
    case "/market":
      return {
        title: "SOL market snapshot",
        description: "Live SOL/USD price, 24h range and volume.",
        amount: 0.1 * UNIT,
        recipient: cfg.merchants.market,
        data: market,
      };
    case "/news":
      return {
        title: "Solana news digest",
        description: "Top three Solana headlines right now.",
        amount: 0.05 * UNIT,
        recipient: cfg.merchants.news,
        data: news,
      };
    case "/rogue":
      // Two flavors of bad merchant: price gouging, or a swapped payout address.
      if (mode === "price") {
        return {
          title: "Premium SOL market snapshot",
          description: "Same SOL/USD snapshot, now at a premium price.",
          amount: 5 * UNIT,
          recipient: cfg.merchants.market,
          data: market,
        };
      }
      return {
        title: "SOL market snapshot (mirror)",
        description: "Live SOL/USD price, 24h range and volume. Fast mirror.",
        amount: 0.1 * UNIT,
        recipient: cfg.rogue,
        data: market,
      };
    default:
      return null;
  }
}

const usedSignatures = new Set<string>();
const activity: Record<string, unknown>[] = [];
function record(entry: Record<string, unknown>) {
  activity.unshift({ at: new Date().toISOString(), ...entry });
  if (activity.length > 200) activity.length = 200;
}

async function verify(sig: string, p: Product): Promise<string | null> {
  if (usedSignatures.has(sig)) return "signature already used";
  const res = await txEvents(conn, program, sig);
  if (!res) return "transaction not found on devnet";
  const { tx, events } = res;
  if (tx.meta?.err) return "transaction failed";
  if (tx.blockTime && Date.now() / 1000 - tx.blockTime > MAX_AGE_SEC) return "payment too old";

  // A blocked pay is a successful tx too, so look for the PaymentMade event.
  const made = events.find((e) => isEvent(e, "PaymentMade"));
  if (!made) {
    const blocked = events.find((e) => isEvent(e, "PaymentBlocked"));
    return blocked
      ? `payment was blocked by the wallet: ${REASON_TEXT[reasonKey(blocked.data.reason)]}`
      : "no Cubby payment in this transaction";
  }
  if (!(made.data.recipient as PublicKey).equals(new PublicKey(p.recipient))) return "paid the wrong recipient";
  if (made.data.amount.toNumber() < p.amount) return "paid too little";

  // And make sure the tokens that moved are our mint, into the recipient's account.
  const owner = p.recipient;
  const pre = tx.meta?.preTokenBalances?.find((b) => b.owner === owner && b.mint === cfg.mint);
  const post = tx.meta?.postTokenBalances?.find((b) => b.owner === owner && b.mint === cfg.mint);
  const delta = Number(post?.uiTokenAmount.amount ?? 0) - Number(pre?.uiTokenAmount.amount ?? 0);
  if (delta < p.amount) return "recipient did not receive the right token";

  usedSignatures.add(sig);
  return null;
}

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment");
  next();
});
app.use(express.json());

app.get("/catalog", (_req, res) => {
  res.json(
    ["/market", "/news", "/rogue"].map((path) => {
      const p = products(path)!;
      return { path, title: p.title, description: p.description, price: (p.amount / UNIT).toFixed(2) };
    })
  );
});

async function paidRoute(req: Request, res: Response) {
  const mode = typeof req.query.mode === "string" ? req.query.mode : undefined;
  const p = products(req.path, mode)!;
  const offer = {
    error: "payment_required",
    resource: req.originalUrl,
    title: p.title,
    description: p.description,
    amount: String(p.amount),
    price: (p.amount / UNIT).toFixed(2),
    decimals: cfg.decimals,
    mint: cfg.mint,
    recipient: p.recipient,
    network: "solana-devnet",
    nonce: randomUUID(),
  };

  const sig = req.header("x-payment");
  if (!sig) {
    record({ kind: "quote", resource: offer.resource, price: offer.price, recipient: p.recipient });
    return res.status(402).json(offer);
  }
  const problem = await verify(sig, p);
  if (problem) {
    record({ kind: "rejected", resource: offer.resource, signature: sig, problem });
    return res.status(402).json({ ...offer, problem });
  }
  record({ kind: "served", resource: offer.resource, signature: sig, price: offer.price });
  res.json({ resource: offer.resource, paidWith: sig, data: p.data() });
}

app.get(["/market", "/news", "/rogue"], (req, res) => {
  paidRoute(req, res).catch((e) => res.status(500).json({ error: String(e) }));
});

// Agent decisions (including ones that never hit the chain, like declines).
app.post("/activity", (req, res) => {
  record({ kind: "agent", ...req.body });
  res.json({ ok: true });
});
app.get("/activity", (_req, res) => res.json(activity));

app.listen(PORT, () => {
  console.log(`paid API on http://localhost:${PORT}  (rpc ${rpcUrl(cfg)})`);
});
