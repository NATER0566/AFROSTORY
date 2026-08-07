import crypto from 'crypto';
import mongoose from 'mongoose';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import Episode from '../models/Episode.js';
import Series from '../models/Series.js';
import Unlock from '../models/Unlock.js';
import Transaction from '../models/Transaction.js';
import { requireAuth } from '../middleware/auth.js';

export default async function walletRoutes(fastify, options) {

  // ==========================================
  // 1. PAYSTACK WEBHOOK (Server-to-Server)
  // ==========================================
  fastify.post('/webhook/paystack', async (req, reply) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const hash = crypto.createHmac('sha512', secret)
                       .update(JSON.stringify(req.body))
                       .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      req.log.warn('🚨 Unauthorized Paystack Webhook Attempt Detected');
      return reply.code(401).send({ success: false, message: 'Invalid signature' });
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const { reference, amount, metadata } = event.data;
      const userId = metadata?.userId; 

      if (!userId) {
        req.log.error('Webhook received without userId in metadata.');
        return reply.code(200).send();
      }

      // IDEMPOTENCY CHECK
      const existingTx = await Transaction.findOne({ reference });
      if (existingTx) return reply.code(200).send();

      // Convert Kobo to Naira, then Naira to Coins (10 Naira = 1 Coin)
      const coinAmount = (amount / 100) / 10; 

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        await Wallet.updateOne(
          { userId },
          { $inc: { storyCoins: coinAmount } },
          { session }
        );

        await Transaction.create([{
          walletId: wallet._id,
          type: 'FUND',
          amount: coinAmount,
          reference: reference,
          description: `Funded wallet via Paystack`,
          status: 'SUCCESS'
        }], { session });

        await session.commitTransaction();
        req.log.info(`✅ Wallet ${wallet._id} successfully funded with ${coinAmount} coins.`);
      } catch (error) {
        await session.abortTransaction();
        req.log.error(`Webhook Processing Error: ${error.message}`);
      } finally {
        session.endSession();
      }
    }

    return reply.code(200).send({ success: true });
  });


  // ==========================================
  // 2. UNLOCK EPISODE VIA PREMIUM COINS
  // ==========================================
  fastify.post('/unlock/coin', { preHandler: [requireAuth] }, async (req, reply) => {
    const { episodeId } = req.body;
    const userId = req.user.userId;

    if (!episodeId) return reply.code(400).send({ success: false, message: 'Episode ID required' });

    const episode = await Episode.findById(episodeId).populate('seriesId');
    if (!episode) return reply.code(404).send({ success: false, message: 'Episode not found' });

    if (episode.isFree) return reply.code(200).send({ success: true, message: 'Episode is already free' });

    const existingUnlock = await Unlock.findOne({ userId, episodeId });
    if (existingUnlock) return reply.code(200).send({ success: true, message: 'Episode already unlocked' });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userWallet = await Wallet.findOne({ userId }).session(session);
      const coinCost = episode.coinCost;

      if (parseFloat(userWallet.storyCoins.toString()) < coinCost) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      const creatorId = episode.seriesId.creatorId;
      
      // REGIONAL PROFIT ENGINE: Check Creator's Country
      const creatorUser = await User.findById(creatorId).session(session);
      const splitRate = (creatorUser.country === 'NG') ? 0.60 : 0.55;
      
      const creatorEarnings = parseFloat((coinCost * splitRate).toFixed(2)); 
      // The remaining percentage automatically stays in the platform via pure math.

      // 1. Deduct from User
      await Wallet.updateOne(
        { userId },
        { $inc: { storyCoins: -coinCost } },
        { session }
      );

      // 2. Add strictly calculated earnings to Creator
      await Wallet.updateOne(
        { userId: creatorId },
        { $inc: { lockedEarnings: creatorEarnings } },
        { session }
      );

      // 3. Grant Access
      await Unlock.create([{
        userId,
        episodeId,
        method: 'COIN',
        amountPaid: coinCost
      }], { session });

      // 4. Update Analytics
      await Episode.updateOne(
        { _id: episodeId },
        { $inc: { totalUnlocks: 1 } },
        { session }
      );

      // 5. Audit Trail
      await Transaction.create([{
        walletId: userWallet._id,
        type: 'SPEND',
        amount: -coinCost,
        description: `Unlocked Episode: ${episode.title}`,
        status: 'SUCCESS'
      }], { session });

      await session.commitTransaction();
      return reply.code(200).send({ success: true, message: 'Episode unlocked successfully' });

    } catch (error) {
      await session.abortTransaction();
      if (error.message === 'INSUFFICIENT_FUNDS') {
        return reply.code(402).send({ success: false, message: 'Insufficient coins. Please top up.' });
      }
      return reply.code(500).send({ success: false, message: 'Unlock failed. Please try again.' });
    } finally {
      session.endSession();
    }
  });


  // ==========================================
  // 3. UNLOCK EPISODE VIA REWARDED AD
  // ==========================================
  fastify.post('/unlock/ad', { preHandler: [requireAuth] }, async (req, reply) => {
    const { episodeId } = req.body;
    const userId = req.user.userId;

    const episode = await Episode.findById(episodeId);
    if (!episode || !episode.adUnlockable) {
      return reply.code(403).send({ success: false, message: 'This episode cannot be unlocked with an ad.' });
    }

    const existingUnlock = await Unlock.findOne({ userId, episodeId });
    if (existingUnlock) return reply.code(200).send({ success: true, message: 'Episode already unlocked' });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      
      if (user.adUnlocksRemaining <= 0) throw new Error('NO_ADS_REMAINING');

      user.adUnlocksRemaining -= 1;
      await user.save({ session });

      await Unlock.create([{
        userId,
        episodeId,
        method: 'AD',
        amountPaid: 0
      }], { session });

      await Episode.updateOne(
        { _id: episodeId },
        { $inc: { totalAdUnlocks: 1 } },
        { session }
      );

      await session.commitTransaction();
      return reply.code(200).send({ success: true, message: 'Ad unlock successful. Enjoy the episode!' });

    } catch (error) {
      await session.abortTransaction();
      if (error.message === 'NO_ADS_REMAINING') {
        return reply.code(429).send({ success: false, message: 'Daily ad limit reached. Come back tomorrow or use coins.' });
      }
      return reply.code(500).send({ success: false, message: 'System error during unlock.' });
    } finally {
      session.endSession();
    }
  });

  // ==========================================
  // 4. GIFT CREATOR (TikTok Style)
  // ==========================================
  fastify.post('/gift', { preHandler: [requireAuth] }, async (req, reply) => {
    const { seriesId, amount } = req.body;
    const userId = req.user.userId;
    const giftAmount = parseFloat(amount);

    if (!seriesId || !giftAmount || giftAmount <= 0) {
        return reply.code(400).send({ success: false, message: 'Valid series ID and amount required.' });
    }

    const series = await Series.findById(seriesId);
    if (!series) return reply.code(404).send({ success: false, message: 'Series not found.' });

    // Cannot gift yourself
    if (series.creatorId.toString() === userId.toString()) {
        return reply.code(400).send({ success: false, message: 'You cannot gift yourself.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userWallet = await Wallet.findOne({ userId }).session(session);
      
      if (parseFloat(userWallet.storyCoins.toString()) < giftAmount) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // REGIONAL PROFIT ENGINE: Check Creator's Country
      const creatorUser = await User.findById(series.creatorId).session(session);
      const splitRate = (creatorUser.country === 'NG') ? 0.60 : 0.55;
      
      const creatorEarnings = parseFloat((giftAmount * splitRate).toFixed(2));

      // 1. Deduct from Sender
      await Wallet.updateOne(
        { userId },
        { $inc: { storyCoins: -giftAmount } },
        { session }
      );

      // 2. Add calculated split to Creator
      await Wallet.updateOne(
        { userId: series.creatorId },
        { $inc: { lockedEarnings: creatorEarnings } },
        { session }
      );

      // 3. Log the Gifting Transaction
      await Transaction.create([{
        walletId: userWallet._id,
        type: 'SPEND',
        amount: -giftAmount,
        description: `Gifted coins to creator of: ${series.title}`,
        status: 'SUCCESS'
      }], { session });

      await session.commitTransaction();
      return reply.code(200).send({ success: true, message: 'Gift sent successfully!' });

    } catch (error) {
      await session.abortTransaction();
      if (error.message === 'INSUFFICIENT_FUNDS') {
        return reply.code(402).send({ success: false, message: 'Insufficient coins to send this gift.' });
      }
      return reply.code(500).send({ success: false, message: 'Failed to send gift. Try again later.' });
    } finally {
      session.endSession();
    }
  });

}
