// One-shot devnet bootstrap. Safe to re-run: reuses whatever already exists.
//   npx tsx scripts/devnet-setup.ts          mint + wallets + agent SOL
//   npx tsx scripts/devnet-setup.ts --init   also creates a starter cubby and deposits
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";
import idl from "../target/idl/cubby.json";
import type { Cubby } from "../target/types/cubby";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const ROOT = path.resolve(__dirname, "..");
const KEYS = path.join(ROOT, "keys");
const CONFIG = path.join(ROOT, "config", "devnet.json");
const DECIMALS = 6;
const UNIT = 10 ** DECIMALS;

function readKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function loadOrCreate(name: string): Keypair {
  const p = path.join(KEYS, `${name}.json`);
  if (fs.existsSync(p)) return readKeypair(p);
  const kp = Keypair.generate();
  fs.mkdirSync(KEYS, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`new keypair: ${name} ${kp.publicKey.toBase58()}`);
  return kp;
}

async function main() {
  const init = process.argv.includes("--init");
  const conn = new Connection(RPC, "confirmed");
  const owner = readKeypair(
    process.env.OWNER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")
  );
  const sol = (await conn.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL;
  console.log(`owner ${owner.publicKey.toBase58()} has ${sol} SOL`);
  if (sol < 0.3) throw new Error("owner needs devnet SOL first (faucet.solana.com)");

  const cfg = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, "utf8")) : {};
  const agent = loadOrCreate("agent");
  const market = loadOrCreate("merchant-market");
  const news = loadOrCreate("merchant-news");
  const rogue = loadOrCreate("rogue"); // never allowlisted, no token account

  // Test stablecoin. Ours, so no faucet hunting.
  let mint: PublicKey;
  if (cfg.mint) {
    mint = new PublicKey(cfg.mint);
  } else {
    mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS);
    console.log(`new mint ${mint.toBase58()}`);
  }

  const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
  if (Number(ownerAta.amount) < 1_000 * UNIT) {
    await mintTo(conn, owner, mint, ownerAta.address, owner, 10_000 * UNIT);
    console.log("minted 10,000 to owner");
  }
  for (const m of [market, news]) {
    await getOrCreateAssociatedTokenAccount(conn, owner, mint, m.publicKey);
  }

  // Agent pays its own tx fees.
  if ((await conn.getBalance(agent.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: agent.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [owner]
    );
    console.log("sent agent 0.1 SOL");
  }

  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(owner), {
    commitment: "confirmed",
  });
  const program = new Program<Cubby>(idl as Cubby, provider);
  const [cubby] = PublicKey.findProgramAddressSync(
    [Buffer.from("cubby"), owner.publicKey.toBuffer()],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), cubby.toBuffer()],
    program.programId
  );

  if (init && !(await conn.getAccountInfo(cubby))) {
    // per-payment cap 1.00, daily cap 3.00, allowlist = the two honest merchants
    await program.methods
      .initializeCubby(agent.publicKey, new BN(1 * UNIT), new BN(3 * UNIT), [
        market.publicKey,
        news.publicKey,
      ])
      .accountsPartial({ owner: owner.publicKey, cubby, mint, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    await program.methods
      .deposit(new BN(100 * UNIT))
      .accountsPartial({
        depositor: owner.publicKey,
        cubby,
        vault,
        mint,
        depositorToken: ownerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log(`cubby ${cubby.toBase58()} created with 100 in the vault`);
  }

  const out = {
    rpc: RPC,
    programId: program.programId.toBase58(),
    mint: mint.toBase58(),
    decimals: DECIMALS,
    owner: owner.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    merchants: { market: market.publicKey.toBase58(), news: news.publicKey.toBase58() },
    rogue: rogue.publicKey.toBase58(),
    cubby: cubby.toBase58(),
    vault: vault.toBase58(),
  };
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  if (await conn.getAccountInfo(vault)) {
    console.log(`vault balance: ${Number((await getAccount(conn, vault)).amount) / UNIT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
