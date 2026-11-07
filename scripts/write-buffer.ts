// Slow, resumable program upload for networks where public devnet rate limits
// `solana program deploy`. Writes the .so into an existing buffer account one
// chunk at a time, skipping chunks that already landed. Then finish with:
//   solana program deploy --program-id target/deploy/cubby-keypair.json --buffer <BUFFER> -ud
// Create the buffer first with any failed `solana program deploy --buffer <keypair>` run,
// or `solana program write-buffer` interrupted early.
//   npx tsx scripts/write-buffer.ts <buffer-address> [path/to/program.so]
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const HEADER = 37; // UpgradeableLoaderState::Buffer: u32 tag + Option<Pubkey>
const CHUNK = 900;
const GAP_MS = Number(process.env.GAP_MS ?? 400);

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const buffer = new PublicKey(process.argv[2] ?? "");
const soPath = process.argv[3] ?? path.join(__dirname, "..", "target", "deploy", "cubby.so");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.OWNER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8"))
  )
);
const conn = new Connection(RPC, "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const so = fs.readFileSync(soPath);
const chunks = Math.ceil(so.length / CHUNK);

function writeIx(offset: number, bytes: Buffer) {
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0); // Write
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  bytes.copy(data, 16);
  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function missing(): Promise<number[]> {
  for (let i = 0; ; i++) {
    try {
      const acct = await conn.getAccountInfo(buffer, "confirmed");
      if (!acct) throw new Error("buffer account not found");
      if (!acct.owner.equals(LOADER)) throw new Error("not a loader buffer");
      if (acct.data.length < HEADER + so.length) throw new Error(`buffer too small: ${acct.data.length}`);
      const auth = new PublicKey(acct.data.subarray(5, 37));
      if (!auth.equals(payer.publicKey)) throw new Error(`buffer authority is ${auth.toBase58()}`);
      const out: number[] = [];
      for (let c = 0; c < chunks; c++) {
        const a = c * CHUNK;
        const want = so.subarray(a, Math.min(a + CHUNK, so.length));
        const have = acct.data.subarray(HEADER + a, HEADER + a + want.length);
        if (!want.equals(have)) out.push(c);
      }
      return out;
    } catch (e: any) {
      if (/not found|not a loader|too small|authority/.test(e.message) || i >= 8) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function main() {
  console.log(`program ${soPath}: ${so.length} bytes, ${chunks} chunks of ${CHUNK}`);
  for (let pass = 1; pass <= 8; pass++) {
    const todo = await missing();
    console.log(`pass ${pass}: ${chunks - todo.length}/${chunks} chunks on chain, ${todo.length} to write`);
    if (!todo.length) {
      console.log("BUFFER COMPLETE");
      return;
    }
    let bh = await conn.getLatestBlockhash("confirmed");
    let bhAt = Date.now();
    for (let k = 0; k < todo.length; k++) {
      if (Date.now() - bhAt > 30_000) {
        bh = await conn.getLatestBlockhash("confirmed");
        bhAt = Date.now();
      }
      const c = todo[k];
      const a = c * CHUNK;
      const tx = new Transaction({ feePayer: payer.publicKey, ...bh }).add(
        writeIx(a, so.subarray(a, Math.min(a + CHUNK, so.length)))
      );
      tx.sign(payer);
      try {
        await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
      } catch (e: any) {
        console.log(`  chunk ${c}: send failed (${String(e.message).slice(0, 80)}), backing off`);
        await sleep(5000);
      }
      if ((k + 1) % 50 === 0) console.log(`  sent ${k + 1}/${todo.length}`);
      await sleep(GAP_MS);
    }
    // Let the last writes confirm before re-reading the buffer.
    await sleep(15_000);
  }
  const left = await missing();
  if (left.length) {
    console.log(`GAVE UP with ${left.length} chunks missing; rerun to resume`);
    process.exit(2);
  }
  console.log("BUFFER COMPLETE");
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
