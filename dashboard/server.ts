// Owner dashboard: rules, live feed and kill switch for one Cubby.
// The feed is read straight from the chain (Cubby events in the program's logs).
// Owner actions are signed here with the owner's devnet keypair, so this only
// listens on localhost.
//   npm run dashboard   ->  http://localhost:4022
import express, { Request, Response } from "express";
import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import os from "os";
import path from "path";
import {
  CubbyEvent,
  REASON_TEXT,
  loadConfig,
  loadEnv,
  makeProgram,
  readKeypair,
  reasonKey,
  rpcUrl,
  txEvents,
} from "../lib/cubby";

loadEnv();
const cfg = loadConfig();
const conn = new Connection(rpcUrl(cfg), "confirmed");
const owner = readKeypair(process.env.OWNER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"));
if (owner.publicKey.toBase58() !== cfg.owner) {
  console.warn(`warning: owner keypair ${owner.publicKey.toBase58()} is not the config owner ${cfg.owner}`);
}
const program = makeProgram(conn, owner);
const PORT = Number(process.env.DASHBOARD_PORT ?? 4022);
const API = process.env.PAID_API_URL ?? "http://localhost:4021";
const UNIT = 10 ** cfg.decimals;

const cubbyKey = new PublicKey(cfg.cubby);
const vaultKey = new PublicKey(cfg.vault);
const mint = new PublicKey(cfg.mint);
const ownerAta = getAssociatedTokenAddressSync(mint, owner.publicKey);

const LABELS: Record<string, string> = {
  [cfg.merchants.market]: "Market API",
  [cfg.merchants.news]: "News API",
  [cfg.rogue]: "Unknown wallet",
  [cfg.agent]: "Agent",
  [cfg.owner]: "Owner",
};

LABELS[ownerAta.toBase58()] = "Owner"; // withdrawals name the token account, not the wallet

const toUi = (n: BN | number | bigint) => Number(n.toString()) / UNIT;
const toBase = (x: unknown) => {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be a positive number");
  return new BN(Math.round(n * UNIT));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ state

let stateCache: { at: number; body: unknown } | null = null;

async function readState() {
  if (stateCache && Date.now() - stateCache.at < 3000) return stateCache.body;
  const acct = await program.account.cubby.fetchNullable(cubbyKey);
  const balance = async (k: PublicKey) => {
    try {
      return toUi((await getAccount(conn, k)).amount);
    } catch {
      return 0;
    }
  };
  const body = {
    network: "devnet",
    config: cfg,
    labels: LABELS,
    exists: !!acct,
    vaultBalance: acct ? await balance(vaultKey) : 0,
    ownerBalance: await balance(ownerAta),
    account: acct && {
      agent: acct.agent.toBase58(),
      perPaymentCap: toUi(acct.perPaymentCap),
      dailyCap: toUi(acct.dailyCap),
      // The program resets the counter lazily on the next pay, so mirror that here.
      spentToday:
        acct.dayStart.toNumber() < Math.floor(Date.now() / 1000 / 86400) * 86400 ? 0 : toUi(acct.spentToday),
      allowlist: acct.allowlist.map((k) => k.toBase58()),
      paused: acct.paused,
      totalPaid: toUi(acct.totalPaid),
      paymentsMade: acct.paymentsMade.toNumber(),
      paymentsBlocked: acct.paymentsBlocked.toNumber(),
    },
  };
  stateCache = { at: Date.now(), body };
  return body;
}

// ------------------------------------------------------------------- feed

type FeedItem = {
  signature: string;
  time: number | null;
  kind: string;
  amount?: number;
  recipient?: string;
  memo?: string;
  reason?: string;
  detail?: string;
  onChain: boolean;
};

const parsed = new Map<string, FeedItem[]>(); // signature -> items from that tx
let order: { signature: string; time: number | null }[] = [];
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

function toItems(signature: string, time: number | null, events: CubbyEvent[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of events) {
    const d = e.data;
    const base = { signature, time, onChain: true };
    switch (e.name.toLowerCase()) {
      case "paymentmade":
        out.push({ ...base, kind: "PAID", amount: toUi(d.amount), recipient: d.recipient.toBase58(), memo: d.memo });
        break;
      case "paymentblocked":
        out.push({
          ...base,
          kind: "BLOCKED",
          amount: toUi(d.amount),
          recipient: d.recipient.toBase58(),
          memo: d.memo,
          reason: REASON_TEXT[reasonKey(d.reason)] ?? reasonKey(d.reason),
        });
        break;
      case "deposited":
        out.push({ ...base, kind: "DEPOSIT", amount: toUi(d.amount), recipient: d.from.toBase58() });
        break;
      case "withdrawn":
        out.push({ ...base, kind: "WITHDRAW", amount: toUi(d.amount), recipient: d.to.toBase58() });
        break;
      case "pausedchanged":
        out.push({ ...base, kind: d.paused ? "FROZEN" : "UNFROZEN" });
        break;
      case "policyupdated":
        out.push({
          ...base,
          kind: "RULES",
          detail: `per payment ${toUi(d.perPaymentCap)}, daily ${toUi(d.dailyCap)}, ${d.allowlist.length} allowed`,
        });
        break;
      case "cubbycreated":
        out.push({ ...base, kind: "CREATED" });
        break;
    }
  }
  return out;
}

async function refreshFeed() {
  const sigs = await conn.getSignaturesForAddress(cubbyKey, { limit: 40 }, "confirmed");
  order = sigs.map((s) => ({ signature: s.signature, time: s.blockTime ?? null }));
  // Oldest first, so a rate limit halfway through still leaves a contiguous feed.
  for (const s of [...sigs].reverse()) {
    if (parsed.has(s.signature)) continue;
    if (s.err) {
      parsed.set(s.signature, []);
      continue;
    }
    const res = await txEvents(conn, program, s.signature, 3);
    if (!res) continue; // try again next refresh
    parsed.set(s.signature, toItems(s.signature, s.blockTime ?? null, res.events));
    await sleep(120);
  }
}

async function offChainDeclines(): Promise<FeedItem[]> {
  try {
    const r = await fetch(`${API}/activity`, { signal: AbortSignal.timeout(1500) });
    const rows = (await r.json()) as Record<string, any>[];
    return rows
      .filter((a) => a.kind === "agent" && a.decision === "decline")
      .map((a) => ({
        signature: "",
        time: Math.floor(new Date(a.at).getTime() / 1000),
        kind: "DECLINED",
        amount: a.price ? Number(a.price) : undefined,
        memo: a.reason,
        detail: a.endpoint,
        onChain: false,
      }));
  } catch {
    return [];
  }
}

async function readFeed() {
  if (!refreshing && Date.now() - lastRefresh > 4000) {
    refreshing = refreshFeed()
      .catch((e) => console.warn("feed refresh:", String(e).slice(0, 200)))
      .finally(() => {
        lastRefresh = Date.now();
        refreshing = null;
      });
  }
  if (!order.length && refreshing) await refreshing;
  const chain = order.flatMap((o) => parsed.get(o.signature) ?? []);
  const all = [...chain, ...(await offChainDeclines())];
  return all.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 60);
}

// ---------------------------------------------------------------- actions

async function act(res: Response, fn: () => Promise<string>) {
  try {
    const signature = await fn();
    stateCache = null;
    lastRefresh = 0;
    res.json({ ok: true, signature });
  } catch (e: any) {
    const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
    const msg = e?.error?.errorMessage ?? e?.message ?? String(e);
    console.warn("action failed:", msg, logs.slice(-3));
    res.status(400).json({ ok: false, error: msg });
  }
}

const keys = (list: unknown): PublicKey[] => {
  if (!Array.isArray(list)) throw new Error("allowlist must be a list of addresses");
  return list
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map((s) => new PublicKey(s));
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (_req, res) => {
  readState()
    .then((b) => res.json(b))
    .catch((e) => res.status(502).json({ error: String(e) }));
});

app.get("/api/feed", (_req, res) => {
  readFeed()
    .then((b) => res.json(b))
    .catch((e) => res.status(502).json({ error: String(e) }));
});

app.post("/api/pause", (req: Request, res: Response) =>
  act(res, () =>
    program.methods
      .setPaused(!!req.body.paused)
      .accountsPartial({ owner: owner.publicKey, cubby: cubbyKey })
      .rpc()
  )
);

app.post("/api/policy", (req, res) =>
  act(res, () =>
    program.methods
      .updatePolicy(
        new PublicKey(req.body.agent ?? cfg.agent),
        toBase(req.body.perPaymentCap),
        toBase(req.body.dailyCap),
        keys(req.body.allowlist)
      )
      .accountsPartial({ owner: owner.publicKey, cubby: cubbyKey })
      .rpc()
  )
);

app.post("/api/deposit", (req, res) =>
  act(res, () =>
    program.methods
      .deposit(toBase(req.body.amount))
      .accountsPartial({
        depositor: owner.publicKey,
        cubby: cubbyKey,
        vault: vaultKey,
        mint,
        depositorToken: ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()
  )
);

app.post("/api/withdraw", (req, res) =>
  act(res, () =>
    program.methods
      .withdraw(toBase(req.body.amount))
      .accountsPartial({
        owner: owner.publicKey,
        cubby: cubbyKey,
        vault: vaultKey,
        mint,
        destination: ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()
  )
);

// Setup screen: create the cubby (one per owner), then optionally fund it.
app.post("/api/create", (req, res) =>
  act(res, async () => {
    const sig = await program.methods
      .initializeCubby(
        new PublicKey(req.body.agent ?? cfg.agent),
        toBase(req.body.perPaymentCap),
        toBase(req.body.dailyCap),
        keys(req.body.allowlist)
      )
      .accountsPartial({ owner: owner.publicKey, cubby: cubbyKey, mint, vault: vaultKey, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    if (Number(req.body.deposit) > 0) {
      await program.methods
        .deposit(toBase(req.body.deposit))
        .accountsPartial({
          depositor: owner.publicKey,
          cubby: cubbyKey,
          vault: vaultKey,
          mint,
          depositorToken: ownerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    }
    return sig;
  })
);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`dashboard on http://localhost:${PORT}  (cubby ${cfg.cubby}, rpc ${rpcUrl(cfg)})`);
});
