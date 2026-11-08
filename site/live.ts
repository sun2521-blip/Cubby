// Read-only live view for the public demo page. Same data the local dashboard
// serves from /api/state and /api/feed, read straight from devnet in the browser.
// Owner actions need the owner's keypair, so they only run on the local dashboard.
import { EventParser, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "./cubby-idl.json";
import cfg from "../config/devnet.json";

const conn = new Connection(cfg.rpc, "confirmed");
const program = new Program(idl as any, { connection: conn } as any);
const parser = new EventParser(program.programId, program.coder);
const UNIT = 10 ** cfg.decimals;
const cubbyKey = new PublicKey(cfg.cubby);
const vaultKey = new PublicKey(cfg.vault);
const ownerAta = getAssociatedTokenAddressSync(new PublicKey(cfg.mint), new PublicKey(cfg.owner));

const LABELS: Record<string, string> = {
  [cfg.merchants.market]: "Market API",
  [cfg.merchants.news]: "News API",
  [cfg.rogue]: "Unknown wallet",
  [cfg.agent]: "Agent",
  [cfg.owner]: "Owner",
  [ownerAta.toBase58()]: "Owner",
};

const REASON_TEXT: Record<string, string> = {
  paused: "cubby is paused",
  recipientNotAllowed: "recipient not on allowlist",
  invalidRecipientAccount: "bad recipient token account",
  overPerPaymentCap: "over per-payment cap",
  overDailyCap: "over daily cap",
  insufficientFunds: "vault has insufficient funds",
};

const toUi = (n: { toString(): string } | number) => Number(n.toString()) / UNIT;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balance(k: PublicKey) {
  try {
    return (await conn.getTokenAccountBalance(k)).value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

export async function state() {
  const acct: any = await (program.account as any).cubby.fetchNullable(cubbyKey);
  return {
    network: "devnet",
    readOnly: true,
    config: cfg,
    labels: LABELS,
    exists: !!acct,
    vaultBalance: acct ? await balance(vaultKey) : 0,
    ownerBalance: await balance(ownerAta),
    account: acct && {
      agent: acct.agent.toBase58(),
      perPaymentCap: toUi(acct.perPaymentCap),
      dailyCap: toUi(acct.dailyCap),
      spentToday:
        acct.dayStart.toNumber() < Math.floor(Date.now() / 1000 / 86400) * 86400 ? 0 : toUi(acct.spentToday),
      allowlist: acct.allowlist.map((k: PublicKey) => k.toBase58()),
      paused: acct.paused,
      totalPaid: toUi(acct.totalPaid),
      paymentsMade: acct.paymentsMade.toNumber(),
      paymentsBlocked: acct.paymentsBlocked.toNumber(),
    },
  };
}

type FeedItem = Record<string, unknown> & { signature: string; time: number | null };

function toItems(signature: string, time: number | null, events: { name: string; data: any }[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of events) {
    const d = e.data;
    const base = { signature, time, onChain: true };
    switch (e.name.toLowerCase()) {
      case "paymentmade":
        out.push({ ...base, kind: "PAID", amount: toUi(d.amount), recipient: d.recipient.toBase58(), memo: d.memo });
        break;
      case "paymentblocked": {
        const key = Object.keys(d.reason)[0];
        out.push({
          ...base,
          kind: "BLOCKED",
          amount: toUi(d.amount),
          recipient: d.recipient.toBase58(),
          memo: d.memo,
          reason: REASON_TEXT[key] ?? key,
        });
        break;
      }
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

const parsed = new Map<string, FeedItem[]>();
let order: { signature: string; time: number | null }[] = [];

export async function feed() {
  const sigs = await conn.getSignaturesForAddress(cubbyKey, { limit: 25 }, "confirmed");
  order = sigs.map((s) => ({ signature: s.signature, time: s.blockTime ?? null }));
  for (const s of [...sigs].reverse()) {
    if (parsed.has(s.signature)) continue;
    if (s.err) {
      parsed.set(s.signature, []);
      continue;
    }
    const tx = await conn
      .getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    if (!tx) continue;
    parsed.set(s.signature, toItems(s.signature, s.blockTime ?? null, [...parser.parseLogs(tx.meta?.logMessages ?? [])]));
    await sleep(300);
  }
  return order
    .flatMap((o) => parsed.get(o.signature) ?? [])
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 60);
}
