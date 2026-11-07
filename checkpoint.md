# Checkpoints

Started: Sun 2026-11-08, 02:24 IST.
Initial submission: 08:30 PM IST (10:00 AM ET).
Final submission: 10:15 PM IST (11:45 AM ET). About 19h50m from start, so we're on the tight side.

| When (IST) | Checkpoint | Status |
|---|---|---|
| 03:30 | CP0: toolchain up, devnet wallet funded, test mint, program deployed to devnet | toolchain up, waiting on devnet SOL |
| 07:30 | CP1: valid pay moves tokens, over-cap pay logs BLOCKED, paused pay logs BLOCKED | done locally (11/11 tests), devnet deploy pending |
| 11:30 | CP2: agent does a task end to end, one PAID and one BLOCKED | not started |
| 12:30 | Food and a break | |
| 16:30 | CP3: full demo runs start to finish once, backup recording | not started |
| 19:30 | README, diagram, devnet links, 2-4 min video, cover image | not started |
| 20:30 | CP4: submitted on MLH (AI track, check DeFi) | not started |
| 22:15 | Hard deadline | |

## CP0: toolchain and devnet

- [x] Repo created
- [x] WSL Ubuntu moved to D:\WSL\Ubuntu (C: only had 5 GB free)
- [x] Setup scripts written: scripts/setup-wsl-root.sh, scripts/setup-wsl-user.sh
- [x] Fixed WSL networking: IPv6 and the network's DNS (172.17.1.10) were broken, so WSL now uses 8.8.8.8
- [x] Toolchain: gcc 15, Rust 1.99 (apt rustup), Node 22 (apt), Solana CLI 4.4.1, Anchor CLI 0.32.3
- [x] Anchor workspace config (Anchor.toml, Cargo.toml, package.json, tsconfig.json)
- [x] Devnet wallet created
- [ ] Devnet wallet funded (CLI airdrop rate-limited, use faucet.solana.com)
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

- [ ] Express mock API: /market, /news, /rogue with 402 responses
- [ ] Server verifies payment signature on devnet (must check for PaymentMade, since blocked pays also succeed)
- [ ] Agent loop: task, 402, LLM decides, pay, retry with signature, summarize

## CP3: dashboard

- [ ] Setup screen: create cubby, deposit, set rules
- [ ] Live feed: PAID and BLOCKED rows with agent reasoning
- [ ] Kill switch
- [ ] /rogue scenario in the demo

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
