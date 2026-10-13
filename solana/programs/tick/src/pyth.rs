//! Reading a Pyth price update account, without the Pyth SDK.
//!
//! The SDK's one job here is to hand back the price message inside a `PriceUpdateV2` account that
//! the Pyth receiver program has already verified. It is skipped because it pins its own Anchor and
//! Solana versions, which drags a second copy of both into the build. What it does is reproduced in
//! full: the account must be owned by the receiver program, carry the `PriceUpdateV2` discriminator,
//! be fully verified rather than partially signed, and describe the feed the caller asked for.
//!
//! The layout below is `PriceUpdateV2` from `pyth-solana-receiver-sdk` 0.6.1, with the message type
//! from `pythnet-sdk` 2.3.1. Borsh, in declaration order, after the 8-byte Anchor discriminator.

use anchor_lang::prelude::*;

use crate::TickError;

/// The Pyth Solana Receiver program. It is what verifies the guardian signatures on an update
/// before writing the account this module reads.
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// sha256("account:PriceUpdateV2")[..8], the Anchor discriminator the receiver writes.
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// How thoroughly the receiver checked the guardian signatures. Anything short of `Full` lowers the
/// number of guardians who would have to collude to post a bad price, so it is refused here.
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Debug)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Debug)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

/// Read a verified price for `feed_id` out of a posted Pyth update account.
///
/// Nothing about freshness is decided here: the caller compares `publish_time` against its own
/// window, because a stake wants a price that is recent and a settlement wants the price at a
/// particular second.
pub fn read_price(account: &UncheckedAccount, feed_id: &[u8; 32]) -> Result<PriceFeedMessage> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER_ID, TickError::WrongPriceOwner);

    let data = account.try_borrow_data()?;
    require!(data.len() > 8, TickError::NotAPriceUpdate);
    require!(
        data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        TickError::NotAPriceUpdate
    );

    let update = PriceUpdateV2::deserialize(&mut &data[8..])
        .map_err(|_| error!(TickError::NotAPriceUpdate))?;

    require!(
        update.verification_level == VerificationLevel::Full,
        TickError::PriceNotVerified
    );
    require!(
        update.price_message.feed_id == *feed_id,
        TickError::WrongFeed
    );

    Ok(update.price_message)
}
