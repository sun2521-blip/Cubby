import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { Cubby } from "../target/types/cubby";

const USDC = (n: number) => new BN(Math.round(n * 1_000_000));

describe("cubby", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Cubby as Program<Cubby>;
  const conn = provider.connection;
  const owner = (provider.wallet as anchor.Wallet).payer;

  const agent = Keypair.generate();
  const merchantA = Keypair.generate(); // /market
  const merchantB = Keypair.generate(); // /news
  const rogue = Keypair.generate(); // never allowlisted

  let mint: PublicKey;
  let ownerAta: PublicKey;
  let merchantAAta: PublicKey;
  let agentAta: PublicKey;

  const [cubby] = PublicKey.findProgramAddressSync(
    [Buffer.from("cubby"), owner.publicKey.toBuffer()],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), cubby.toBuffer()],
    program.programId
  );

  const balance = async (ata: PublicKey) =>
    Number((await getAccount(conn, ata)).amount);

  async function events(sig: string) {
    const tx = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const parser = new anchor.EventParser(program.programId, program.coder);
    return [...parser.parseLogs(tx!.meta!.logMessages!)];
  }

  async function onlyEvent(sig: string, name: string) {
    const evs = await events(sig);
    const ev = evs.find((e) => e.name.toLowerCase() === name.toLowerCase());
    assert.ok(ev, `expected ${name}, got ${evs.map((e) => e.name)}`);
    return ev!.data as any;
  }

  const reasonOf = (data: any) => Object.keys(data.reason)[0].toLowerCase();

  function pay(
    amount: BN,
    recipient: PublicKey,
    memo: string,
    opts: { recipientToken?: PublicKey; signer?: Keypair } = {}
  ) {
    const signer = opts.signer ?? agent;
    return program.methods
      .pay(amount, memo)
      .accountsPartial({
        agent: signer.publicKey,
        cubby,
        vault,
        mint,
        recipient,
        recipientToken:
          opts.recipientToken ?? getAssociatedTokenAddressSync(mint, recipient),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc({ commitment: "confirmed" });
  }

  before(async () => {
    const sig = await conn.requestAirdrop(agent.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");

    mint = await createMint(conn, owner, owner.publicKey, null, 6);
    ownerAta = (
      await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey)
    ).address;
    await mintTo(conn, owner, mint, ownerAta, owner, 1_000_000_000); // 1000
    merchantAAta = (
      await getOrCreateAssociatedTokenAccount(conn, owner, mint, merchantA.publicKey)
    ).address;
    await getOrCreateAssociatedTokenAccount(conn, owner, mint, merchantB.publicKey);
    agentAta = (
      await getOrCreateAssociatedTokenAccount(conn, owner, mint, agent.publicKey)
    ).address;
  });

  it("initializes a cubby", async () => {
    await program.methods
      .initializeCubby(agent.publicKey, USDC(10), USDC(25), [
        merchantA.publicKey,
        merchantB.publicKey,
      ])
      .accountsPartial({
        owner: owner.publicKey,
        cubby,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const c = await program.account.cubby.fetch(cubby);
    assert.ok(c.owner.equals(owner.publicKey));
    assert.ok(c.agent.equals(agent.publicKey));
    assert.equal(c.perPaymentCap.toNumber(), 10_000_000);
    assert.equal(c.dailyCap.toNumber(), 25_000_000);
    assert.equal(c.allowlist.length, 2);
    assert.isFalse(c.paused);
  });

  it("takes a deposit", async () => {
    await program.methods
      .deposit(USDC(100))
      .accountsPartial({
        depositor: owner.publicKey,
        cubby,
        vault,
        mint,
        depositorToken: ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
    assert.equal(await balance(vault), 100_000_000);
  });

  it("valid pay moves tokens", async () => {
    const sig = await pay(USDC(5), merchantA.publicKey, "market data is worth $5");
    assert.equal(await balance(merchantAAta), 5_000_000);
    assert.equal(await balance(vault), 95_000_000);
    const ev = await onlyEvent(sig, "PaymentMade");
    assert.equal(ev.amount.toNumber(), 5_000_000);
    assert.equal(ev.memo, "market data is worth $5");
  });

  it("over per-payment cap is BLOCKED and logged, not reverted", async () => {
    const sig = await pay(USDC(15), merchantA.publicKey, "pricey but fine?");
    assert.equal(await balance(merchantAAta), 5_000_000);
    const ev = await onlyEvent(sig, "PaymentBlocked");
    assert.equal(reasonOf(ev), "overperpaymentcap");
  });

  it("unknown recipient is BLOCKED even with no token account", async () => {
    const sig = await pay(USDC(1), rogue.publicKey, "rogue api wants paying");
    const ev = await onlyEvent(sig, "PaymentBlocked");
    assert.equal(reasonOf(ev), "recipientnotallowed");
  });

  it("allowed name + agent-owned token account is BLOCKED", async () => {
    const sig = await pay(USDC(1), merchantA.publicKey, "sneaky", {
      recipientToken: agentAta,
    });
    assert.equal(await balance(agentAta), 0);
    const ev = await onlyEvent(sig, "PaymentBlocked");
    assert.equal(reasonOf(ev), "invalidrecipientaccount");
  });

  it("daily cap BLOCKS once spent", async () => {
    await pay(USDC(10), merchantA.publicKey, "a"); // 15
    await pay(USDC(10), merchantA.publicKey, "b"); // 25
    const sig = await pay(USDC(1), merchantA.publicKey, "c");
    const ev = await onlyEvent(sig, "PaymentBlocked");
    assert.equal(reasonOf(ev), "overdailycap");
    const c = await program.account.cubby.fetch(cubby);
    assert.equal(c.spentToday.toNumber(), 25_000_000);
    assert.equal(c.paymentsMade.toNumber(), 3);
    assert.equal(c.paymentsBlocked.toNumber(), 4);
  });

  it("only the owner can hit the kill switch", async () => {
    try {
      await program.methods
        .setPaused(true)
        .accountsPartial({ owner: agent.publicKey, cubby })
        .signers([agent])
        .rpc();
      assert.fail("agent paused the cubby");
    } catch (e: any) {
      assert.notInclude(String(e), "agent paused the cubby");
    }
  });

  it("paused pay is BLOCKED", async () => {
    // raise the daily cap so pause is the only thing in the way
    await program.methods
      .updatePolicy(agent.publicKey, USDC(10), USDC(50), [
        merchantA.publicKey,
        merchantB.publicKey,
      ])
      .accountsPartial({ owner: owner.publicKey, cubby })
      .rpc({ commitment: "confirmed" });
    await program.methods
      .setPaused(true)
      .accountsPartial({ owner: owner.publicKey, cubby })
      .rpc({ commitment: "confirmed" });

    const sig = await pay(USDC(1), merchantA.publicKey, "while frozen");
    const ev = await onlyEvent(sig, "PaymentBlocked");
    assert.equal(reasonOf(ev), "paused");

    await program.methods
      .setPaused(false)
      .accountsPartial({ owner: owner.publicKey, cubby })
      .rpc({ commitment: "confirmed" });
    const ok = await pay(USDC(1), merchantA.publicKey, "thawed");
    await onlyEvent(ok, "PaymentMade");
  });

  it("nobody but the agent can pay", async () => {
    const impostor = Keypair.generate();
    const s = await conn.requestAirdrop(impostor.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(s, "confirmed");
    try {
      await pay(USDC(1), merchantA.publicKey, "hi", { signer: impostor });
      assert.fail("impostor paid");
    } catch (e: any) {
      assert.include(String(e), "UnauthorizedAgent");
    }
  });

  it("owner can withdraw", async () => {
    const before = await balance(ownerAta);
    await program.methods
      .withdraw(USDC(10))
      .accountsPartial({
        owner: owner.publicKey,
        cubby,
        vault,
        mint,
        destination: ownerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
    assert.equal((await balance(ownerAta)) - before, 10_000_000);
  });
});
