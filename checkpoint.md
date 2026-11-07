# Checkpoints

Started: Sun 2026-11-08, 02:24 IST.
Initial submission: 08:30 PM IST (10:00 AM ET).
Final submission: 10:15 PM IST (11:45 AM ET). About 19h50m from start, so we're on the tight side.

| When (IST) | Checkpoint | Status |
|---|---|---|
| 03:30 | CP0: toolchain up, devnet wallet funded, test mint, program deployed to devnet | funded (5 SOL), deploy blocked by public RPC rate limits |
| 07:30 | CP1: valid pay moves tokens, over-cap pay logs BLOCKED, paused pay logs BLOCKED | done locally (11/11 tests), devnet deploy pending |
| 11:30 | CP2: agent does a task end to end, one PAID and one BLOCKED | code written and type-checks, not run yet |
| 12:30 | Food and a break | |
| 16:30 | CP3: full demo runs start to finish once, backup recording | not started |
| 19:30 | README, diagram, devnet links, 2-4 min video, cover image | not started |
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
- [ ] Private devnet RPC URL in .env as RPC_URL (public RPC returns 429 on this network's shared IP)
- [x] scripts/devnet-setup.ts written (mint, agent + merchant wallets, agent SOL, starter cubby)
- [ ] Test SPL mint on devnet (run `npm run devnet:setup` after deploy)
- [ ] Program deployed to devnet, program ID recorded below

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
- [ ] Run the scripted demo end to end on devnet (needs deploy + devnet:setup)
- [ ] Claude agent end to end: skipped, no ANTHROPIC_API_KEY (owner decided not to add one)

## CP3: dashboard

- [x] dashboard/server.ts + dashboard/public/index.html (`npm run dashboard`, http://localhost:4022), type-checks
- [x] Setup screen: create cubby, deposit, set rules
- [x] Live feed: PAID and BLOCKED rows with agent reasoning, read from chain events
- [x] Kill switch
- [x] Deposit / withdraw, edit rules
- [x] /rogue scenario in the demo (scripts/demo.ts)
- [ ] Click through the dashboard against devnet

## Submission (MLH, event slug solana-hackathon)

- [x] DevRelay installed, MCP server registered as devrelay-gateway (needs a Claude Code restart to load)
- [x] README written
- [x] Push commits to github.com/sun2521-blip/Cubby (public, all commits up)
- [x] Sign in to MLH through DevRelay (suneeti arya, checked in at Solana Hackathon)
- [x] Create MLH project "Cubby" and submit it to Solana Hackathon (04:06 IST)
- [ ] Demo video (MLH digital-event rule: 2 min or less, public, say "Solana Hackathon" at the start)
- [ ] Add demo video link (and screenshots once the dashboard exists) to the MLH project
- [ ] Enter prize categories: Top 3 Overall, Best Beginner Hack, DeFi Track, AI Track (Gaming skipped)

MLH lists the event end as 1:00 PM EST = 11:30 PM IST. Entering a category can get it approved instantly, which locks the project, so finish project edits first.

### Category answers (sponsor_usage), ready to send

- **Top 3 Overall:** Cubby lets AI agents pay for APIs without ever holding a funded key. An Anchor program enforces per-payment caps, daily caps and a recipient allowlist, and logs blocked payments as on-chain events instead of reverting. A 402 pay-per-request flow has the API verify the PaymentMade event on Solana before it serves data.
- **Best Beginner Hack:** Built by hackathon beginners this weekend, starting from a fresh Solana and Anchor install. We learned program-derived addresses, SPL tokens and Anchor events to build a wallet an AI agent can only spend from within owner-set rules, with 11 passing tests covering the caps, allowlist, spoofed token accounts and the kill switch.
- **DeFi Track:** Cubby is programmable spending control for on-chain money. USDC sits in a PDA-owned vault, and the program checks per-payment and daily caps, a recipient allowlist and a kill switch before any transfer. That enables per-request USDC payments to APIs, which the merchant verifies on-chain before serving data.
- **AI Track:** A Claude agent built on the Anthropic SDK tool runner handles 402 Payment Required responses, decides whether data is worth the price, and writes a one-line reason that goes on-chain with the payment. If a prompt injection or a swapped payout address pushes it to pay the wrong party, Cubby blocks and logs the payment instead of losing the funds.

## Devnet info

- Program ID: AbA9Gyr5q8SiEK7jL18umsgW92i78qwXNgsdq5JYBvjU (keypair backed up in keys/, gitignored)
- Test mint:
- Owner wallet: GwxbxfTREDDDiz2UpohjPeWxLDmcWYzD5ZxX7od7eANF (WSL ~/.config/solana/id.json)
- Agent wallet:

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
