# Checkpoints

## When you wake up

**Overnight status (05:20 IST):** program deployed to devnet, devnet set up (mint, wallets, cubby with 100 test USDC), scripted demo runs end to end (2 PAID, 2 BLOCKED), dashboard works against devnet (feed, kill switch, deposit/withdraw, rules all tested). README has addresses, tx links and a screenshot. Everything committed and pushed. MLH project description updated, screenshots added. Prize categories still NOT entered (waiting on your video link).

To run the demo yourself, three WSL terminals in /mnt/d/Cubby: `npm run api`, `npm run dashboard` (open http://localhost:4022 in Windows), then `npm run demo -- --slow`.

1. **Record the demo video** (script below). MLH digital-event rules: 2 minutes or less, public (YouTube unlisted is fine, or Loom), and say "Solana Hackathon" at the start.
2. **Send Claude the video link.** Claude adds it to the MLH project and enters the four prize categories (answers are under Submission below), then gets you the project link. Do this before 9:30 PM IST to leave margin before the 10:15 PM IST cutoff.
3. **AI Track: your call.** The Claude agent is written but has not run live (no API key). The scripted demo shows the wallet, not AI decisions. Options: enter AI Track anyway on the design, skip it, or add a key and run `npm run agent` once for the video.

### Demo video script (about 2:00)

Two windows side by side: the dashboard (`npm run dashboard`, http://localhost:4022) and a terminal. Have `npm run api` already running in another terminal.

- **0:00-0:10** "Hi, I'm Suneeti, and this is Cubby, my project for the Solana Hackathon."
- **0:10-0:30** The problem: agents are starting to pay for APIs on their own. Give one a funded key and a single prompt injection or swapped payout address can drain it.
- **0:30-0:50** Dashboard: USDC sits in a vault owned by the program, not the agent. Rules: 1 USDC per payment, 3 per day, only Market API and News API can be paid. Point at the kill switch.
- **0:50-1:25** Run `npm run demo -- --slow`. This agent is deliberately gullible: it pays every quote. /market and /news are paid and served, and the rows land in the dashboard with the agent's reason. /rogue swaps the payout address: blocked, recipient not on allowlist. /rogue at 50x the price: blocked, over the per-payment cap. The API also refuses the blocked transaction and a replayed signature.
- **1:25-1:40** Click "Freeze agent", run `npm run demo` again: everything comes back BLOCKED, cubby is paused. Unfreeze.
- **1:40-1:55** Click a tx link in the feed: Solana Explorer shows the payment and the agent's reason on devnet. Why Solana: sub-cent fees and one-second confirmations make paying per API call practical, and a program-derived address holds the funds with no private key behind it.
- **1:55-2:00** "That's Cubby. Thanks."

Started: Sun 2026-11-08, 02:24 IST.
Initial submission: 08:30 PM IST (10:00 AM ET).
Final submission: 10:15 PM IST (11:45 AM ET). About 19h50m from start, so we're on the tight side.

| When (IST) | Checkpoint | Status |
|---|---|---|
| 03:30 | CP0: toolchain up, devnet wallet funded, test mint, program deployed to devnet | done 05:00 (deployed via throttled buffer upload) |
| 07:30 | CP1: valid pay moves tokens, over-cap pay logs BLOCKED, paused pay logs BLOCKED | done, local tests 11/11 and on devnet |
| 11:30 | CP2: agent does a task end to end, one PAID and one BLOCKED | done with the scripted agent on devnet; Claude agent not run (no API key) |
| 12:30 | Food and a break | |
| 16:30 | CP3: full demo runs start to finish once, backup recording | demo + dashboard run start to finish; recording is yours |
| 19:30 | README, diagram, devnet links, video (2 min max per MLH), cover image | README, diagram, devnet links, screenshot done; video yours |
| 20:30 | CP4: submitted on MLH (AI track, check DeFi) | project submitted 04:06 IST; prize categories not entered yet (waiting on demo video) |
| 22:15 | Hard deadline | |

## CP0: toolchain and devnet

- [x] Repo created
- [x] WSL Ubuntu moved to D:\WSL\Ubuntu (C: only had 5 GB free)
- [x] Setup scripts written: scripts/setup-wsl-root.sh, scripts/setup-wsl-user.sh
- [x] Fixed WSL networking: IPv6 and the network's DNS (172.17.1.10) were broken, so WSL now uses 8.8.8.8
- [x] Toolchain: gcc 15, Rust 1.99 (apt rustup), Node 22 (apt), Solana CLI 4.4.1, Anchor CLI 0.32.3
- [x] Anchor workspace config (Anchor.toml, Cargo.toml, package.json, tsconfig.json)
- [x] Devnet wallet created
- [x] Devnet wallet funded, 5 SOL from the web faucet
- [x] Private devnet RPC URL: not needed in the end. Deployed with `--use-rpc` plus scripts/write-buffer.ts (slow, resumable chunk upload)
- [x] scripts/devnet-setup.ts written (mint, agent + merchant wallets, agent SOL, starter cubby)
- [x] Test SPL mint on devnet (`npm run devnet:setup`)
- [x] Program deployed to devnet, program ID recorded below

## CP1: Anchor program

- [x] programs/cubby/src/lib.rs: initialize_cubby, deposit, update_policy, set_paused, pay, withdraw
- [x] pay blocks and logs (PaymentBlocked event with reason) instead of reverting
- [x] Agent reasoning goes on-chain as a memo in the pay event
- [x] tests/cubby.ts written
- [x] `anchor build` passes (284 KB .so)
- [x] `anchor test` passes, 11/11: valid pay, over per-payment cap, unknown recipient, spoofed token account, daily cap, kill switch auth, paused, impostor agent, withdraw

## CP2: agent and mock API

- [x] Express mock API (server/index.ts): /catalog, /market, /news, /rogue (?mode=price or wallet swap), /activity
- [x] Server verifies payment on devnet: PaymentMade event, right recipient, amount, mint balance delta, tx age, one use per signature
- [x] Agent (agent/index.ts): Claude tool runner with list_endpoints, call_api, pay_and_fetch, decline
- [x] Payment code moved into lib/cubby.ts (agentPay), shared by the agent and the scripted demo
- [x] scripts/demo.ts (`npm run demo`): scripted agent, no API key, pays every quote; /market and /news paid, /rogue swap and /rogue?mode=price blocked, blocked-tx and replay refused by the API
- [x] Run the scripted demo end to end on devnet: 2 PAID, 2 BLOCKED, blocked-tx and replay refused
- [ ] Claude agent end to end: skipped, no ANTHROPIC_API_KEY (owner decided not to add one)

## CP3: dashboard

- [x] dashboard/server.ts + dashboard/public/index.html (`npm run dashboard`, http://localhost:4022), type-checks
- [x] Setup screen: create cubby, deposit, set rules
- [x] Live feed: PAID and BLOCKED rows with agent reasoning, read from chain events
- [x] Kill switch
- [x] Deposit / withdraw, edit rules
- [x] /rogue scenario in the demo (scripts/demo.ts)
- [x] Dashboard tested against devnet: state, on-chain feed, freeze (demo run while frozen: 4 BLOCKED, cubby is paused), unfreeze, deposit, withdraw, rules save, over-withdraw error. Screenshots in light, dark, tablet width

## Submission (MLH, event slug solana-hackathon)

- [x] DevRelay installed, MCP server registered as devrelay-gateway (needs a Claude Code restart to load)
- [x] README written
- [x] Push commits to github.com/sun2521-blip/Cubby (public, all commits up)
- [x] Sign in to MLH through DevRelay (suneeti arya, checked in at Solana Hackathon)
- [x] Create MLH project "Cubby" and submit it to Solana Hackathon (04:06 IST)
- [ ] Demo video (MLH digital-event rule: 2 min or less, public, say "Solana Hackathon" at the start)
- [x] Dashboard screenshots added to the MLH project, description updated to the devnet status
- [ ] Add demo video link to the MLH project
- [ ] Enter prize categories: Top 3 Overall, Best Beginner Hack, DeFi Track, AI Track (Gaming skipped)

MLH lists the event end as 1:00 PM EST = 11:30 PM IST. Entering a category can get it approved instantly, which locks the project, so finish project edits first.

### Category answers (sponsor_usage), ready to send

- **Top 3 Overall:** Cubby lets AI agents pay for APIs without ever holding a funded key. An Anchor program enforces per-payment caps, daily caps and a recipient allowlist, and logs blocked payments as on-chain events instead of reverting. A 402 pay-per-request flow has the API verify the PaymentMade event on Solana before it serves data.
- **Best Beginner Hack:** Built by hackathon beginners this weekend, starting from a fresh Solana and Anchor install. We learned program-derived addresses, SPL tokens and Anchor events to build a wallet an AI agent can only spend from within owner-set rules, with 11 passing tests covering the caps, allowlist, spoofed token accounts and the kill switch.
- **DeFi Track:** Cubby is programmable spending control for on-chain money. USDC sits in a PDA-owned vault, and the program checks per-payment and daily caps, a recipient allowlist and a kill switch before any transfer. That enables per-request USDC payments to APIs, which the merchant verifies on-chain before serving data.
- **AI Track:** A Claude agent built on the Anthropic SDK tool runner handles 402 Payment Required responses, decides whether data is worth the price, and writes a one-line reason that goes on-chain with the payment. If a prompt injection or a swapped payout address pushes it to pay the wrong party, Cubby blocks and logs the payment instead of losing the funds.

## Devnet info

- Program ID: AbA9Gyr5q8SiEK7jL18umsgW92i78qwXNgsdq5JYBvjU (keypair backed up in keys/, gitignored)
- Test mint: BNWTZ3wvoXB8iYghL6ycgbhVAMidshx63EQb2vGtPo1P (6 decimals, owner holds 9,900)
- Cubby: FZnfB8TZ79feAkwKCjfb1Rm3JoovFSk8WuVhZzTxEegn, vault CqLvSs8vFtj5sZZ7C6W3Fz7T4As92ZGacL6u3PLP5A9z
- Merchants: market FVP5wYpMJhekaLhAtxUrNZAfQBQg9kB9wxNRroervKHu, news 8PAQXUC2DMLrSXDqV5pMBmtTF4dpka6yaSMD1Yu4m2aG, rogue 84hFXzHdNhcYuBYawhodkLHjnF7z6oJNyDfa8bTHGW1T
- Owner wallet: GwxbxfTREDDDiz2UpohjPeWxLDmcWYzD5ZxX7od7eANF (WSL ~/.config/solana/id.json)
- Agent wallet: D9A5jdxF256SdgAmvGYPyHTYW5dP6CxY9nMFeC6CD8X (0.1 SOL for fees; keys in keys/, gitignored)
- Deploy tx: 5LxJ1HSc51zYdPYt8ZX2BLyzEKmqCNC28i4zp45siAThdYcuthehEfWmMyb1RDKiUB5oqHKrSQKXvNs525iPnNGc. Owner has about 3.5 SOL left

## Build notes

- Build and test from WSL: `wsl -d Ubuntu`, then `cd /mnt/d/Cubby && npm test`
- Always build with `anchor build --tools-version v1.57`. Anchor 0.32.3 defaults to v1.51.1, whose cargo can't parse edition2024 crates.
- `target/` and `.anchor/` are symlinks into WSL home (still on D:, faster, and the test validator's RocksDB is happier off /mnt/d)
- Versions: anchor-lang 0.32.3, @coral-xyz/anchor 0.32.1, Agave 4.4.1, platform-tools v1.57, SBPF v3

## Log

- 02:24 IST: WSL moved to D:. Program and tests written. Toolchain install is waiting on the setup scripts.
- 03:10 IST: Fixed WSL DNS, toolchain installed, program ID generated. First build running. Devnet airdrop rate-limited.
- 03:20 IST: Build green after switching to platform-tools v1.57. All 11 tests pass on local validator. Waiting on devnet SOL to deploy.
- 03:30 IST: Devnet bootstrap script committed. CLI airdrop still rate-limited, needs web faucet. Next: `npm run deploy` then `npm run devnet:setup`.
- 03:55 IST: Got 5 SOL. Two deploy attempts died on 429s from api.devnet.solana.com; buffers closed and the SOL is back. Need a private RPC URL to deploy. Meanwhile wrote the paid API, the agent and the README. DevRelay installed for the MLH submission; it needs a Claude Code restart.
- 04:06 IST: Pushed all commits to GitHub. Signed in to MLH through DevRelay, created the Cubby project and submitted it to Solana Hackathon. Prize categories held until the demo video is up, since an approved entry locks the project.
- 04:45 IST: No Anthropic key (owner's call), so wrote a scripted demo that needs none. Built the owner dashboard. First deploy hung: chunks sent over QUIC/UDP never landed on this network. Rerunning with `--use-rpc` against the same buffer; chunks are landing but public devnet rate limits are slowing it.
- 05:05 IST: CLI deploy kept rate-limiting itself (sends ~300 writes at once). Wrote scripts/write-buffer.ts: reads the buffer, writes missing chunks one at a time. 295 chunks landed in one pass, then deployed from the buffer in one tx. Ran devnet:setup.
- 05:20 IST: Scripted demo ran end to end on devnet. Dashboard tested against devnet, fixed time wrapping and the withdraw label. README has addresses, tx links, screenshot and the rate-limit workaround.
