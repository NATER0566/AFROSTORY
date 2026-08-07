import mongoose from 'mongoose';
import Episode from '../models/Episode.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import Unlock from '../models/Unlock.js';
import Transaction from '../models/Transaction.js';
import { requireAuth } from '../middleware/auth.js';

export default async function episodeRoutes(fastify, options) {

  // ==========================================
  // 1. UNLOCK EPISODE VIA PREMIUM COINS
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

      // REGIONAL PROFIT ENGINE
      const creatorId = episode.seriesId.creatorId;
      const creatorUser = await User.findById(creatorId).session(session);
      const splitRate = (creatorUser.country === 'NG') ? 0.60 : 0.55;
      
      const creatorEarnings = parseFloat((coinCost * splitRate).toFixed(2)); 

      // 1. Deduct from User
      await Wallet.updateOne({ userId }, { $inc: { storyCoins: -coinCost } }, { session });
      
      // 2. Add to Creator
      await Wallet.updateOne({ userId: creatorId }, { $inc: { lockedEarnings: creatorEarnings } }, { session });
      
      // 3. Grant Access
      await Unlock.create([{ userId, episodeId, method: 'COIN', amountPaid: coinCost }], { session });
      
      // 4. Update Analytics
      await Episode.updateOne({ _id: episodeId }, { $inc: { totalUnlocks: 1 } }, { session });
      
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
      req.log.error(`Unlock Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Unlock failed. Please try again.' });
    } finally {
      session.endSession();
    }
  });

  // ==========================================
  // 2. UNLOCK EPISODE VIA REWARDED AD
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

      await Unlock.create([{ userId, episodeId, method: 'AD', amountPaid: 0 }], { session });
      await Episode.updateOne({ _id: episodeId }, { $inc: { totalAdUnlocks: 1 } }, { session });

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

}
