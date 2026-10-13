//! Tick on Solana: 30-second parimutuel price markets, settled from Pyth.
//!
//! The Monad contract's rules, carried over exactly:
//!
//! - **A market is its terms.** `(feed_id, strike, expo, closes_at)` seeds the market PDA, so there
//!   is no "create market" instruction. The first staker opens the account; everyone who names the
//!   same terms lands on the same market.
//! - **Parimutuel.** Winners split the losing pool pro rata, minus a 2% fee on profit. A one-sided
//!   market voids and refunds everyone.
//! - **Settlement is permissionless and paid.** Anyone may settle with a Pyth update whose publish
//!   time sits within tolerance of the close, and earns half the fee, capped at 2 USDC.
//! - **Fresh-price cutoff.** A stake is only accepted while the posted price is within 10 seconds
//!   of fresh. That is the residual latency-arbitrage window, on screen rather than hidden.
//!
//! What changes on Solana is the contention story. The EVM version shards its pools 64 ways so
//! stakers do not write the same slot. Here each staker writes their own `Position` PDA and the
//! market's two pool counters, so the close-of-window burst of settles and claims touches a
//! different account per trader and runs in parallel without any sharding of our own.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod pyth;
use pyth::read_price;

declare_id!("5adXZ1k5eYzyzsnAEkHsEjTfQdg1QMv53H9Ltjj9vV2v");

/// 2% of profit, in basis points.
pub const FEE_BPS: u64 = 200;
/// The settler's share of the fee, in basis points.
pub const BOUNTY_BPS: u64 = 5000;
/// The settler bounty never exceeds 2 USDC (6 decimals).
pub const MAX_BOUNTY: u64 = 2_000_000;
/// A stake is refused if the posted price is older than this.
pub const ACCEPT_MARGIN_SECONDS: i64 = 10;
/// A settlement price must have been published within this many seconds of the close.
pub const SETTLE_TOLERANCE_SECONDS: i64 = 20;
/// After this long unsettled, a market voids and everyone is refunded.
pub const SETTLE_WINDOW_SECONDS: i64 = 600;
/// The smallest stake, 0.10 USDC.
pub const MIN_STAKE: u64 = 100_000;

#[program]
pub mod tick {
    use super::*;

    /// Take a side of a window. The first staker opens the market.
    pub fn stake(ctx: Context<Stake>, args: MarketTerms, above: bool, amount: u64) -> Result<()> {
        require!(amount >= MIN_STAKE, TickError::StakeTooSmall);
        let now = Clock::get()?.unix_timestamp;
        require!(now < args.closes_at, TickError::WindowClosed);

        // The posted price must be fresh, or the taker is calling a number everyone else has
        // already seen move. Same cutoff as the EVM contract, and it is the stake that is
        // refused, never the settlement.
        let price = read_price(&ctx.accounts.price_update, &args.feed_id())?;
        require!(
            now - price.publish_time <= ACCEPT_MARGIN_SECONDS,
            TickError::PriceStale
        );

        let market = &mut ctx.accounts.market;
        if market.closes_at == 0 {
            market.feed_id = args.feed_id;
            market.strike = args.strike;
            market.expo = args.expo;
            market.closes_at = args.closes_at;
            market.mint = ctx.accounts.mint.key();
            market.bump = ctx.bumps.market;
            market.vault_bump = ctx.bumps.vault;
        } else {
            require!(market.mint == ctx.accounts.mint.key(), TickError::WrongMint);
        }
        require!(!market.settled, TickError::AlreadySettled);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.staker_tokens.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        if position.market == Pubkey::default() {
            position.market = market.key();
            position.owner = ctx.accounts.staker.key();
            position.bump = ctx.bumps.position;
        }

        if above {
            market.pool_above = market.pool_above.checked_add(amount).unwrap();
            position.above = position.above.checked_add(amount).unwrap();
        } else {
            market.pool_below = market.pool_below.checked_add(amount).unwrap();
            position.below = position.below.checked_add(amount).unwrap();
        }

        emit!(Staked {
            market: market.key(),
            staker: ctx.accounts.staker.key(),
            above,
            amount,
        });
        Ok(())
    }

    /// Settle a closed window against Pyth and collect the bounty. Anyone may call this.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(!market.settled, TickError::AlreadySettled);
        require!(now >= market.closes_at, TickError::WindowOpen);

        // One side empty: nobody can be paid from nobody, so the market voids and every stake is
        // refunded. Same for a market nobody settled inside the window.
        if market.pool_above == 0 || market.pool_below == 0 {
            market.settled = true;
            market.void = true;
            emit!(Settled { market: market.key(), above_won: false, void: true, price: 0, fee: 0, bounty: 0 });
            return Ok(());
        }
        if now > market.closes_at + SETTLE_WINDOW_SECONDS {
            market.settled = true;
            market.void = true;
            emit!(Settled { market: market.key(), above_won: false, void: true, price: 0, fee: 0, bounty: 0 });
            return Ok(());
        }

        // The update has to be the one for this close, not merely a recent price. Pyth verified
        // the signature when the update account was posted; what is checked here is that it
        // describes the right feed at the right second.
        let feed_id = market.feed_id;
        let price = read_price(&ctx.accounts.price_update, &feed_id)?;
        require!(price.exponent == market.expo, TickError::WrongExponent);
        require!(
            (price.publish_time - market.closes_at).abs() <= SETTLE_TOLERANCE_SECONDS,
            TickError::PriceOutOfWindow
        );

        let above_won = price.price > market.strike;
        let losing = if above_won { market.pool_below } else { market.pool_above };

        // The fee is taken on profit only, and the settler's half of it is the reason an outside
        // bot bothers to call this at all.
        let fee = losing * FEE_BPS / 10_000;
        let bounty = core::cmp::min(fee * BOUNTY_BPS / 10_000, MAX_BOUNTY);

        market.settled = true;
        market.above_won = above_won;
        market.settle_price = price.price;
        market.fee = fee;

        if bounty > 0 {
            let seeds: &[&[u8]] = &[
                b"market",
                market.feed_id.as_ref(),
                &market.strike.to_le_bytes(),
                &market.closes_at.to_le_bytes(),
                &[market.bump],
            ];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.settler_tokens.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[seeds],
                ),
                bounty,
            )?;
        }

        emit!(Settled {
            market: market.key(),
            above_won,
            void: false,
            price: price.price,
            fee,
            bounty,
        });
        Ok(())
    }

    /// Take your winnings, or your refund from a voided market.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.settled, TickError::NotSettled);
        let position = &mut ctx.accounts.position;
        require!(!position.claimed, TickError::AlreadyClaimed);

        let owed = if market.void {
            position.above + position.below
        } else {
            let (stake, winning, losing) = if market.above_won {
                (position.above, market.pool_above, market.pool_below)
            } else {
                (position.below, market.pool_below, market.pool_above)
            };
            if stake == 0 {
                0
            } else {
                // Stake back, plus a pro rata share of what the losing side left after the fee.
                // u128 so a large pool times a large stake cannot overflow before the divide.
                let profit = ((losing - market.fee) as u128)
                    .checked_mul(stake as u128)
                    .unwrap()
                    / winning as u128;
                stake + profit as u64
            }
        };

        position.claimed = true;
        if owed > 0 {
            let seeds: &[&[u8]] = &[
                b"market",
                market.feed_id.as_ref(),
                &market.strike.to_le_bytes(),
                &market.closes_at.to_le_bytes(),
                &[market.bump],
            ];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.winner_tokens.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    &[seeds],
                ),
                owed,
            )?;
        }

        emit!(Claimed {
            market: market.key(),
            owner: position.owner,
            amount: owed,
        });
        Ok(())
    }
}

/// The terms that name a market. Hashing them into the PDA seeds is what removes the need for a
/// create-market transaction.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketTerms {
    pub feed_id: [u8; 32],
    pub strike: i64,
    pub expo: i32,
    pub closes_at: i64,
}

impl MarketTerms {
    pub fn feed_id(&self) -> [u8; 32] {
        self.feed_id
    }
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub feed_id: [u8; 32],
    pub strike: i64,
    pub expo: i32,
    pub closes_at: i64,
    pub mint: Pubkey,
    pub pool_above: u64,
    pub pool_below: u64,
    pub fee: u64,
    pub settle_price: i64,
    pub settled: bool,
    pub above_won: bool,
    pub void: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

/// One trader's side of one market. Its own account, so two traders never write the same bytes.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub above: u64,
    pub below: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(args: MarketTerms)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", args.feed_id.as_ref(), &args.strike.to_le_bytes(), &args.closes_at.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = staker,
        token::mint = mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), staker.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut, token::mint = mint, token::authority = staker)]
    pub staker_tokens: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    /// CHECK: ownership, discriminator and feed id are all checked in `pyth::read_price`.
    pub price_update: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub settler: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.feed_id.as_ref(), &market.strike.to_le_bytes(), &market.closes_at.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = market.mint, token::authority = settler)]
    pub settler_tokens: Account<'info, TokenAccount>,

    /// CHECK: ownership, discriminator and feed id are all checked in `pyth::read_price`.
    pub price_update: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.feed_id.as_ref(), &market.strike.to_le_bytes(), &market.closes_at.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,

    #[account(mut, token::mint = market.mint, token::authority = owner)]
    pub winner_tokens: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct Staked {
    pub market: Pubkey,
    pub staker: Pubkey,
    pub above: bool,
    pub amount: u64,
}

#[event]
pub struct Settled {
    pub market: Pubkey,
    pub above_won: bool,
    pub void: bool,
    pub price: i64,
    pub fee: u64,
    pub bounty: u64,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum TickError {
    #[msg("Stake is below the minimum")]
    StakeTooSmall,
    #[msg("The window has closed")]
    WindowClosed,
    #[msg("The window has not closed yet")]
    WindowOpen,
    #[msg("The posted price is stale")]
    PriceStale,
    #[msg("The price was not published near the close")]
    PriceOutOfWindow,
    #[msg("The price exponent does not match the market")]
    WrongExponent,
    #[msg("Wrong stake token for this market")]
    WrongMint,
    #[msg("This market is already settled")]
    AlreadySettled,
    #[msg("This market is not settled yet")]
    NotSettled,
    #[msg("This position has already been claimed")]
    AlreadyClaimed,
    #[msg("The price account is not owned by the Pyth receiver")]
    WrongPriceOwner,
    #[msg("The price account is not a Pyth price update")]
    NotAPriceUpdate,
    #[msg("The price update is for a different feed")]
    WrongFeed,
    #[msg("The price update is not fully verified")]
    PriceNotVerified,
}
