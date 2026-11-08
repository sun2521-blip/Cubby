# Checkpoints

## Left to do

Deadlines (IST): aim for **9:30 PM**, hard cutoff **10:15 PM** (11:45 AM ET). MLH closes the event at 11:30 PM IST.

1. **Record the demo video** with the script below. MLH rules for digital events: 2 minutes or less, recorded this weekend, say "Solana Hackathon" at the start. No face or camera needed; screen plus voice is fine. Upload as YouTube (unlisted is fine), Vimeo or Loom.
2. **Send Claude the video link.** Claude adds it to the MLH project, enters the prize categories with the answers below, and gets you the project link.
3. **AI Track: your call.** The Claude agent is written but has not run live (no API key), and the demo shows the wallet, not AI decisions. Enter it on the design or skip it.

Prize categories go in last on purpose: an approved entry locks the project, so the video link has to be on it first.

## Running the demo

Open a WSL terminal (`wsl -d Ubuntu` from Git Bash, or the Ubuntu (WSL) entry in the VS Code terminal menu), then `cd /mnt/d/Cubby`. Use one terminal per command:

```sh
npm run api                 # paid API, port 4021
npm run dashboard           # open http://localhost:4022 in Windows
npm run demo -- --slow      # scripted agent, pauses between steps
```

Each run spends 0.15 of the 3.00 daily cap, so about 20 retakes a day; the cap resets at 5:30 AM IST. A run while frozen spends nothing. Unfreeze when you're done.

## Demo video script (2:00)

Two windows side by side: the dashboard and a terminal. Have `npm run api` already running in another terminal.

- **0:00-0:10** "Hi, I'm Suneeti, and this is Cubby, my project for the Solana Hackathon."
- **0:10-0:25** The problem: agents are starting to pay for APIs on their own. Give one a funded key and a single prompt injection or swapped payout address can drain it.
- **0:25-0:45** Dashboard: USDC sits in a vault owned by the program, not the agent. Rules: 1 USDC per payment, 3 per day, only Market API and News API can be paid. Point at the kill switch.
- **0:45-1:20** Run `npm run demo -- --slow`. This agent is deliberately gullible: it pays every quote. /market and /news are paid and served, and the rows land in the dashboard with the agent's reason. /rogue swaps the payout address: blocked, recipient not on allowlist. /rogue at 50x the price: blocked, over the per-payment cap. The API also refuses the blocked transaction and a replayed signature.
- **1:20-1:35** Click "Freeze agent", run `npm run demo` again: everything comes back BLOCKED, cubby is paused. Unfreeze.
- **1:35-1:45** Click a tx link in the feed: Solana Explorer shows the payment and the agent's reason on devnet. Why Solana: sub-cent fees and one-second confirmations make paying per API call practical, and a program-derived address holds the funds with no private key behind it.
- **1:45-1:57** What I learned (judges score Learning as one of four equal criteria, so say it out loud): "One thing I learned: public devnet kept rate-limiting my deploy, so I wrote a small uploader that sends the program one chunk at a time and skips the chunks that already landed. That's how Cubby got on chain."
  - Alternate, if you'd rather talk about Solana itself (then drop the PDA sentence from 1:35 so you don't say it twice): "One thing I learned: a Solana program can hold money on its own. The vault belongs to a program-derived address with no private key, so the only way funds move is through Cubby's rules."
- **1:57-2:00** "That's Cubby. Thanks."

## Prize category answers, ready to send

Gaming Track skipped (no fit).

- **Top 3 Overall:** Cubby lets AI agents pay for APIs without ever holding a funded key. An Anchor program enforces per-payment caps, daily caps and a recipient allowlist, and logs blocked payments as on-chain events instead of reverting. A 402 pay-per-request flow has the API verify the PaymentMade event on Solana before it serves data.
- **Best Beginner Hack:** Built by hackathon beginners this weekend, starting from a fresh Solana and Anchor install. We learned program-derived addresses, SPL tokens and Anchor events to build a wallet an AI agent can only spend from within owner-set rules, with 11 passing tests covering the caps, allowlist, spoofed token accounts and the kill switch.
- **DeFi Track:** Cubby is programmable spending control for on-chain money. USDC sits in a PDA-owned vault, and the program checks per-payment and daily caps, a recipient allowlist and a kill switch before any transfer. That enables per-request USDC payments to APIs, which the merchant verifies on-chain before serving data.
- **AI Track (only if you decide to enter):** Cubby is the safety layer for AI agents that pay on their own. The agent writes a one-line reason with every payment and it is stored on-chain next to the payment, so the owner can audit why the AI spent. If a prompt injection or a swapped payout address pushes the agent to pay the wrong party, the program blocks and logs it instead of losing funds. Our Claude agent (Anthropic SDK tool runner) decides whether each 402 quote is worth paying; the live demo uses a scripted agent that pays every quote to show the wallet holding the line.

## Done

- Program deployed to devnet, 11/11 tests pass
- Devnet set up: test USDC, agent and merchant wallets, a cubby with 100 test USDC
- Scripted demo runs end to end on devnet: 2 PAID, 2 BLOCKED, blocked tx and replay refused
- Dashboard tested against devnet: feed, kill switch, deposit/withdraw, rules
- README with addresses, tx links, screenshot and the rate-limit workaround
- Everything pushed to github.com/sun2521-blip/Cubby
- MLH project "Cubby" submitted to Solana Hackathon with description, devnet links and 2 screenshots

## Devnet info

Public addresses are also in `config/devnet.json`. Private keys live in `keys/` and WSL `~/.config/solana/id.json`, both outside git.

- Program: AbA9Gyr5q8SiEK7jL18umsgW92i78qwXNgsdq5JYBvjU
- Cubby: FZnfB8TZ79feAkwKCjfb1Rm3JoovFSk8WuVhZzTxEegn, vault CqLvSs8vFtj5sZZ7C6W3Fz7T4As92ZGacL6u3PLP5A9z
- Test USDC mint: BNWTZ3wvoXB8iYghL6ycgbhVAMidshx63EQb2vGtPo1P
- Owner: GwxbxfTREDDDiz2UpohjPeWxLDmcWYzD5ZxX7od7eANF (about 3.5 SOL left)
- Agent: D9A5jdxF256SdgAmvGYPyHTYW5dP6CxY9nMFeC6CD8X

## Build notes

- Build and test from WSL: `cd /mnt/d/Cubby && npm test`
- Build with `anchor build --tools-version v1.57`. Anchor 0.32.3's default (v1.51.1) can't parse edition2024 crates.
- `target/` and `.anchor/` are symlinks into WSL home, so run TypeScript from WSL, not Windows.
