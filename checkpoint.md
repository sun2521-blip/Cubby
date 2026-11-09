# Checkpoints

## Left to do

Nothing. Submitted 9:49 PM IST on Nov 8, ahead of the 10:15 PM cutoff. The entries are waiting for organizer review. Once one is approved, the project locks.

## Submission log (Nov 8, IST)

- 9:47 PM: demo video https://youtu.be/3IsZDrEg9ok added to the MLH project (checked: anyone with the link can watch it)
- 9:48 PM: MLH wanted a live demo URL before any entry, so the program's devnet Explorer page went in as the live demo link
- 9:49 PM: entered Top 3 Overall, Best Beginner Hack and DeFi Track, using the answers below
- AI Track skipped (your call: the Claude agent hasn't run live). Gaming Track skipped (no fit).
- README now links the demo video
- 10:02 PM: real live demo is up: https://raw.githack.com/sun2521-blip/Cubby/main/docs/index.html. It's a read-only copy of the owner dashboard that reads devnet in the browser, and it replaced the Explorer link as the MLH live demo URL. Freeze, rules and funds stay on the local dashboard.

## Live demo page

- `docs/index.html` is a copy of `dashboard/public/index.html` with a shim that answers `/api/state` and `/api/feed` from devnet in the browser and refuses the owner actions
- `site/live.ts` is the browser data layer. Rebuild it from WSL: `./node_modules/.bin/esbuild site/live.ts --bundle --format=iife --global-name=cubbyLive --platform=browser --minify --inject:site/buffer-shim.ts --define:process.env.NODE_ENV='"production"' --define:global=globalThis --outfile=docs/live.js`
- `site/cubby-idl.json` is copied from `~/cubby-target/idl/cubby.json` in WSL. Copy it again if the program changes.
- Public devnet RPC rate-limits, so the feed can take a few seconds to fill
- GitHub Pages is on (branch main, folder /docs), so https://sun2521-blip.github.io/Cubby/ is the clean link, with no extra screen. The README points there as of Nov 9.
- The MLH submission still has the raw.githack link, because the event closed before the switch. raw.githack shows a "One more step" screen first, and visitors have to click "Open the page" to get through.
- Known issue, not fixed: the page starts a new feed load every 5 seconds without waiting for the last one, which piles extra requests onto devnet's rate limit. Fixing it would be a code change after the deadline, so it waits until judging is over.

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
- **0:10-0:25** agents are starting to pay for APIs on their own. Give one a funded key and a single prompt injection or swapped payout address can drain it.
- **0:25-0:45** USDC sits in a vault owned by the program, not the agent. Rules: 1 USDC per payment, 3 per day, only Market API and News API can be paid.
- **0:45-1:20** Run `npm run demo -- --slow`. This agent is deliberately gullible: it pays every quote. /market and /news are paid and served, and the rows land in the dashboard with the agent's reason.  swaps the payout address: blocked, recipient not on allowlist. at 50x the price: blocked, over the per-payment cap. The API also refuses the blocked transaction and a replayed signature.
- **1:20-1:35** if we click on freeze agent, run `npm run demo` again: everything comes back BLOCKED, cubby is paused. then if we Unfreeze, it shows wallet is not frozen anymore
- **1:35-1:45** if we click onn the tx link Solana Explorer shows the payment and the agent's reason on devnet. on Solana sub-cent fees and one-second confirmations make paying per API call practical, and a program-derived address holds the funds with no private key behind it.
- **1:45-1:57** One thing I learned from it is public devnet kept rate-limiting my deploy, so I wrote a small uploader that sends the program one chunk at a time and skips the chunks that already landed. That's how Cubby got on chain."

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
