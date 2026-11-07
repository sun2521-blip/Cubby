//! Cubby: an on-chain allowance wallet for AI agents.
//!
//! The owner funds a vault (a token account owned by the Cubby PDA, so the
//! agent never holds funds) and sets rules. The agent can only move money via
//! `pay`, which enforces those rules.
//!
//! Design: block and log instead of fail. A rule violation does not revert.
//! `pay` returns Ok, skips the transfer and emits `PaymentBlocked` with a
//! reason, so every refusal has a real transaction signature the dashboard
//! can show. Only auth failures (wrong signer) and malformed input revert.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("AbA9Gyr5q8SiEK7jL18umsgW92i78qwXNgsdq5JYBvjU");

pub const CUBBY_SEED: &[u8] = b"cubby";
pub const VAULT_SEED: &[u8] = b"vault";
pub const MAX_ALLOWLIST: usize = 5;
pub const MAX_MEMO_LEN: usize = 160;
pub const DAY_SECONDS: i64 = 86_400;

#[program]
pub mod cubby {
    use super::*;

    /// Create the Cubby PDA (one per owner) and its vault.
    pub fn initialize_cubby(
        ctx: Context<InitializeCubby>,
        agent: Pubkey,
        per_payment_cap: u64,
        daily_cap: u64,
        allowlist: Vec<Pubkey>,
    ) -> Result<()> {
        validate_policy(per_payment_cap, daily_cap, &allowlist)?;
        let now = Clock::get()?.unix_timestamp;

        let cubby_key = ctx.accounts.cubby.key();
        let cubby = &mut ctx.accounts.cubby;
        cubby.owner = ctx.accounts.owner.key();
        cubby.agent = agent;
        cubby.mint = ctx.accounts.mint.key();
        cubby.vault = ctx.accounts.vault.key();
        cubby.per_payment_cap = per_payment_cap;
        cubby.daily_cap = daily_cap;
        cubby.spent_today = 0;
        cubby.day_start = day_floor(now);
        cubby.allowlist = allowlist;
        cubby.paused = false;
        cubby.total_paid = 0;
        cubby.payments_made = 0;
        cubby.payments_blocked = 0;
        cubby.bump = ctx.bumps.cubby;
        cubby.vault_bump = ctx.bumps.vault;

        emit!(CubbyCreated {
            cubby: cubby_key,
            owner: cubby.owner,
            agent,
            mint: cubby.mint,
            vault: cubby.vault,
        });
        Ok(())
    }

    /// Anyone can top up the vault.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, CubbyError::InvalidAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.depositor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Deposited {
            cubby: ctx.accounts.cubby.key(),
            from: ctx.accounts.depositor.key(),
            amount,
        });
        Ok(())
    }

    /// Owner replaces the whole policy (agent, caps, allowlist).
    pub fn update_policy(
        ctx: Context<OwnerOnly>,
        agent: Pubkey,
        per_payment_cap: u64,
        daily_cap: u64,
        allowlist: Vec<Pubkey>,
    ) -> Result<()> {
        validate_policy(per_payment_cap, daily_cap, &allowlist)?;
        let cubby_key = ctx.accounts.cubby.key();
        let cubby = &mut ctx.accounts.cubby;
        cubby.agent = agent;
        cubby.per_payment_cap = per_payment_cap;
        cubby.daily_cap = daily_cap;
        cubby.allowlist = allowlist.clone();
        emit!(PolicyUpdated {
            cubby: cubby_key,
            agent,
            per_payment_cap,
            daily_cap,
            allowlist,
        });
        Ok(())
    }

    /// The kill switch.
    pub fn set_paused(ctx: Context<OwnerOnly>, paused: bool) -> Result<()> {
        let cubby_key = ctx.accounts.cubby.key();
        ctx.accounts.cubby.paused = paused;
        emit!(PausedChanged {
            cubby: cubby_key,
            paused,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Owner pulls funds back out of the vault.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, CubbyError::InvalidAmount);
        require!(
            ctx.accounts.vault.amount >= amount,
            CubbyError::InsufficientVault
        );
        let owner = ctx.accounts.cubby.owner;
        let bump = [ctx.accounts.cubby.bump];
        let seeds: &[&[u8]] = &[CUBBY_SEED, owner.as_ref(), &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.cubby.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Withdrawn {
            cubby: ctx.accounts.cubby.key(),
            to: ctx.accounts.destination.key(),
            amount,
        });
        Ok(())
    }

    /// Agent-only. Pays `amount` to `recipient` if every rule passes;
    /// otherwise logs `PaymentBlocked` and returns Ok without moving funds.
    /// `memo` carries the agent's one-line reasoning so the feed is on-chain.
    pub fn pay(ctx: Context<Pay>, amount: u64, memo: String) -> Result<()> {
        require!(amount > 0, CubbyError::InvalidAmount);
        require!(memo.len() <= MAX_MEMO_LEN, CubbyError::MemoTooLong);

        let now = Clock::get()?.unix_timestamp;
        let cubby_key = ctx.accounts.cubby.key();
        let recipient = ctx.accounts.recipient.key();
        let vault_balance = ctx.accounts.vault.amount;
        let token_ok = recipient_token_ok(
            &ctx.accounts.recipient_token.to_account_info(),
            &ctx.accounts.token_program.key(),
            &recipient,
            &ctx.accounts.mint.key(),
        );

        // Policy check (mutable borrow ends before the CPI).
        let blocked = {
            let cubby = &mut ctx.accounts.cubby;
            cubby.roll_day(now);
            let reason = cubby.check(amount, &recipient, token_ok, vault_balance);
            if let Some(reason) = reason {
                cubby.payments_blocked = cubby.payments_blocked.saturating_add(1);
                msg!("BLOCKED: {}", reason.label());
                emit!(PaymentBlocked {
                    cubby: cubby_key,
                    agent: cubby.agent,
                    recipient,
                    amount,
                    reason,
                    spent_today: cubby.spent_today,
                    daily_cap: cubby.daily_cap,
                    memo: memo.clone(),
                    timestamp: now,
                });
            }
            reason.is_some()
        };
        if blocked {
            return Ok(());
        }

        // Allowed: transfer from the vault, signed by the Cubby PDA.
        let owner = ctx.accounts.cubby.owner;
        let bump = [ctx.accounts.cubby.bump];
        let seeds: &[&[u8]] = &[CUBBY_SEED, owner.as_ref(), &bump];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.cubby.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let cubby = &mut ctx.accounts.cubby;
        cubby.spent_today = cubby
            .spent_today
            .checked_add(amount)
            .ok_or(CubbyError::MathOverflow)?;
        cubby.total_paid = cubby.total_paid.saturating_add(amount);
        cubby.payments_made = cubby.payments_made.saturating_add(1);
        msg!("PAID: {} to {}", amount, recipient);
        emit!(PaymentMade {
            cubby: cubby_key,
            agent: cubby.agent,
            recipient,
            amount,
            spent_today: cubby.spent_today,
            daily_cap: cubby.daily_cap,
            memo,
            timestamp: now,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct InitializeCubby<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Cubby::INIT_SPACE,
        seeds = [CUBBY_SEED, owner.key().as_ref()],
        bump,
    )]
    pub cubby: Account<'info, Cubby>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, cubby.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = cubby,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,

    #[account(
        seeds = [CUBBY_SEED, cubby.owner.as_ref()],
        bump = cubby.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub cubby: Account<'info, Cubby>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub depositor_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CUBBY_SEED, owner.key().as_ref()],
        bump = cubby.bump,
        has_one = owner @ CubbyError::Unauthorized,
    )]
    pub cubby: Account<'info, Cubby>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [CUBBY_SEED, owner.key().as_ref()],
        bump = cubby.bump,
        has_one = owner @ CubbyError::Unauthorized,
        has_one = mint,
        has_one = vault,
    )]
    pub cubby: Account<'info, Cubby>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [CUBBY_SEED, cubby.owner.as_ref()],
        bump = cubby.bump,
        has_one = agent @ CubbyError::UnauthorizedAgent,
        has_one = mint,
        has_one = vault,
    )]
    pub cubby: Account<'info, Cubby>,

    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: only used as a pubkey, compared against the allowlist.
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: deliberately unchecked so a bad/missing account is BLOCKED and
    /// logged instead of reverting. Validated in `recipient_token_ok`
    /// (token-program owned, right mint, owned by `recipient`) before any transfer.
    #[account(mut)]
    pub recipient_token: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ------------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Cubby {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub per_payment_cap: u64,
    pub daily_cap: u64,
    pub spent_today: u64,
    /// Unix timestamp of the start of the current UTC day.
    pub day_start: i64,
    #[max_len(5)]
    pub allowlist: Vec<Pubkey>,
    pub paused: bool,
    pub total_paid: u64,
    pub payments_made: u64,
    pub payments_blocked: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Cubby {
    /// Reset the daily counter when a new UTC day starts.
    fn roll_day(&mut self, now: i64) {
        let today = day_floor(now);
        if today > self.day_start {
            self.day_start = today;
            self.spent_today = 0;
        }
    }

    /// First rule that fails, or None if the payment is allowed.
    fn check(
        &self,
        amount: u64,
        recipient: &Pubkey,
        recipient_token_ok: bool,
        vault_balance: u64,
    ) -> Option<BlockReason> {
        if self.paused {
            return Some(BlockReason::Paused);
        }
        if !self.allowlist.contains(recipient) {
            return Some(BlockReason::RecipientNotAllowed);
        }
        if !recipient_token_ok {
            return Some(BlockReason::InvalidRecipientAccount);
        }
        if amount > self.per_payment_cap {
            return Some(BlockReason::OverPerPaymentCap);
        }
        match self.spent_today.checked_add(amount) {
            Some(total) if total <= self.daily_cap => {}
            _ => return Some(BlockReason::OverDailyCap),
        }
        if vault_balance < amount {
            return Some(BlockReason::InsufficientFunds);
        }
        None
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockReason {
    Paused,
    RecipientNotAllowed,
    InvalidRecipientAccount,
    OverPerPaymentCap,
    OverDailyCap,
    InsufficientFunds,
}

impl BlockReason {
    pub fn label(&self) -> &'static str {
        match self {
            BlockReason::Paused => "cubby is paused",
            BlockReason::RecipientNotAllowed => "recipient not on allowlist",
            BlockReason::InvalidRecipientAccount => "bad recipient token account",
            BlockReason::OverPerPaymentCap => "over per-payment cap",
            BlockReason::OverDailyCap => "over daily cap",
            BlockReason::InsufficientFunds => "vault has insufficient funds",
        }
    }
}

// ----------------------------------------------------------------- helpers

fn day_floor(ts: i64) -> i64 {
    ts - ts.rem_euclid(DAY_SECONDS)
}

fn validate_policy(per_payment_cap: u64, daily_cap: u64, allowlist: &[Pubkey]) -> Result<()> {
    require!(allowlist.len() <= MAX_ALLOWLIST, CubbyError::AllowlistTooLong);
    require!(
        per_payment_cap > 0 && daily_cap > 0 && per_payment_cap <= daily_cap,
        CubbyError::InvalidCap
    );
    for (i, key) in allowlist.iter().enumerate() {
        require!(!allowlist[..i].contains(key), CubbyError::DuplicateRecipient);
    }
    Ok(())
}

/// True if `info` is a token account of `mint`, owned by `recipient`,
/// living under `token_program`. Never errors: a bad account just means BLOCKED.
fn recipient_token_ok(
    info: &AccountInfo,
    token_program: &Pubkey,
    recipient: &Pubkey,
    mint: &Pubkey,
) -> bool {
    if info.owner != token_program {
        return false;
    }
    let Ok(data) = info.try_borrow_data() else {
        return false;
    };
    match TokenAccount::try_deserialize(&mut &data[..]) {
        Ok(acct) => acct.owner == *recipient && acct.mint == *mint,
        Err(_) => false,
    }
}

// ------------------------------------------------------------------ events

#[event]
pub struct CubbyCreated {
    pub cubby: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct Deposited {
    pub cubby: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub cubby: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PolicyUpdated {
    pub cubby: Pubkey,
    pub agent: Pubkey,
    pub per_payment_cap: u64,
    pub daily_cap: u64,
    pub allowlist: Vec<Pubkey>,
}

#[event]
pub struct PausedChanged {
    pub cubby: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct PaymentMade {
    pub cubby: Pubkey,
    pub agent: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub spent_today: u64,
    pub daily_cap: u64,
    pub memo: String,
    pub timestamp: i64,
}

#[event]
pub struct PaymentBlocked {
    pub cubby: Pubkey,
    pub agent: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub reason: BlockReason,
    pub spent_today: u64,
    pub daily_cap: u64,
    pub memo: String,
    pub timestamp: i64,
}

// ------------------------------------------------------------------ errors

#[error_code]
pub enum CubbyError {
    #[msg("Only the owner can do that")]
    Unauthorized,
    #[msg("Only this cubby's agent can pay")]
    UnauthorizedAgent,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Caps must be > 0 and per-payment cap <= daily cap")]
    InvalidCap,
    #[msg("Allowlist holds at most 5 recipients")]
    AllowlistTooLong,
    #[msg("Duplicate recipient in allowlist")]
    DuplicateRecipient,
    #[msg("Memo is too long")]
    MemoTooLong,
    #[msg("Not enough tokens in the vault")]
    InsufficientVault,
    #[msg("Math overflow")]
    MathOverflow,
}
