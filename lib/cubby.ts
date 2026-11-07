// Shared bits for the mock API, the agent and scripts.
import * as anchor from "@coral-xyz/anchor";
import { EventParser, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, VersionedTransactionResponse } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import idl from "../target/idl/cubby.json";
import type { Cubby } from "../target/types/cubby";

export const ROOT = path.resolve(__dirname, "..");

export type DevnetConfig = {
  rpc: string;
  programId: string;
  mint: string;
  decimals: number;
  owner: string;
  agent: string;
  merchants: { market: string; news: string };
  rogue: string;
  cubby: string;
  vault: string;
};

export function loadEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {
    // no .env, fine
  }
}

export function loadConfig(): DevnetConfig {
  const p = path.join(ROOT, "config", "devnet.json");
  if (!fs.existsSync(p)) throw new Error("config/devnet.json missing, run `npm run devnet:setup`");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export const rpcUrl = (cfg: DevnetConfig) => process.env.RPC_URL || cfg.rpc;

export function readKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export function makeProgram(conn: Connection, signer?: Keypair): Program<Cubby> {
  const wallet = new anchor.Wallet(signer ?? Keypair.generate());
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  return new Program<Cubby>(idl as Cubby, provider);
}

export type CubbyEvent = { name: string; data: any };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch a confirmed tx and decode Cubby events from its logs. Retries while the RPC catches up. */
export async function txEvents(
  conn: Connection,
  program: Program<Cubby>,
  sig: string,
  tries = 15
): Promise<{ tx: VersionedTransactionResponse; events: CubbyEvent[] } | null> {
  const parser = new EventParser(program.programId, program.coder);
  for (let i = 0; i < tries; i++) {
    const tx = await conn
      .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    if (tx) return { tx, events: [...parser.parseLogs(tx.meta?.logMessages ?? [])] };
    await sleep(1000);
  }
  return null;
}

export const isEvent = (e: CubbyEvent, name: string) => e.name.toLowerCase() === name.toLowerCase();

export const reasonKey = (reason: object) => Object.keys(reason)[0];

export const REASON_TEXT: Record<string, string> = {
  paused: "cubby is paused",
  recipientNotAllowed: "recipient not on allowlist",
  invalidRecipientAccount: "bad recipient token account",
  overPerPaymentCap: "over per-payment cap",
  overDailyCap: "over daily cap",
  insufficientFunds: "vault is out of funds",
};

/** Trim to at most `max` UTF-8 bytes without splitting a character. */
export function clipBytes(s: string, max: number): string {
  let out = s;
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
}
