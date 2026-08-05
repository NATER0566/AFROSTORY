import Episode from '../models/Episode.js';
import Series from '../models/Series.js';
import Unlock from '../models/Unlock.js';
import History from '../models/History.js';
import { requireAuth } from '../middleware/auth.js';

export default async function episodeRoutes(fastify, options) {

  // ==========================================
  // 1. ADD NEW EPISODE (Protected - Creators Only)
  // ==========================================
  fastify.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (req.user.role !== 'CREATOR' && req.user.role !== 'ADMIN') {
        return reply.code(403).send({ success: false, message: 'Only creators can upload episodes.' });
      }

      const { seriesId, episodeNumber, title, mediaUrl, duration, isFree, coinCost, adUnlockable } = req.body;

      if (!seriesId || !episodeNumber || !title || !mediaUrl || !duration) {
        return reply.code(400).send({ success: false, message: 'Missing required episode parameters.' });
      }

      // Enterprise Security: Ensure the creator actually owns the series they are adding to
      const series = await Series.findOne({ _id: seriesId, creatorId: req.user.userId });
      if (!series && req.user.role !== 'ADMIN') {
        return reply.code(403).send({ success: false, message: 'You do not have permission to modify this series.' });
      }

      const newEpisode = await Episode.create({
        seriesId,
        episodeNumber,
        title,
        mediaUrl, // This HLS URL stays hidden from public endpoints
        duration,
        isFree: isFree || false,
        coinCost: coinCost || 10,
        adUnlockable: adUnlockable !== undefined ? adUnlockable : true,
        status: 'PUBLISHED'
      });

      // Automatically update the parent series episode count
      await Series.updateOne({ _id: seriesId }, { $inc: { totalEpisodes: 1 } });

      return reply.code(201).send({
        success: true,
        message: 'Episode successfully deployed.',
        data: { id: newEpisode._id, title: newEpisode.title }
      });
    } catch (error) {
      // Catch MongoDB duplicate key error (11000) for identical episode numbers
      if (error.code === 11000) {
        return reply.code(409).send({ success: false, message: 'An episode with this number already exists in this series.' });
      }
      req.log.error(`Episode Upload Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to deploy episode.' });
    }
  });

  // ==========================================
  // 2. SECURE PLAYBACK (The Access Gate)
  // ==========================================
  fastify.get('/:id/play', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const episodeId = req.params.id;
      const userId = req.user.userId;

      const episode = await Episode.findById(episodeId).lean();
      if (!episode || episode.status !== 'PUBLISHED') {
        return reply.code(404).send({ success: false, message: 'Episode unavailable.' });
      }

      let hasAccess = false;

      // Check 1: Is it free for everyone?
      if (episode.isFree) {
        hasAccess = true;
      } else {
        // Check 2: Did the user legitimately unlock this?
        const accessCheck = await Unlock.findOne({ userId, episodeId }).lean();
        if (accessCheck) hasAccess = true;
      }

      if (!hasAccess) {
        return reply.code(402).send({ 
          success: false, 
          message: 'Payment required to watch this episode.',
          requiredAction: 'UNLOCK'
        });
      }

      // Access Granted: Establish or retrieve watch history
      let history = await History.findOne({ userId, episodeId });
      if (!history) {
        history = await History.create({ userId, episodeId, lastPosition: 0 });
      }

      // Update analytics asynchronously (do not block the video from loading)
      Episode.updateOne({ _id: episodeId }, { $inc: { totalViews: 1 } }).catch(e => req.log.error(e));
      Series.updateOne({ _id: episode.seriesId }, { $inc: { totalViews: 1 } }).catch(e => req.log.error(e));

      // Deliver the locked payload securely
      return reply.code(200).send({
        success: true,
        data: {
          mediaUrl: episode.mediaUrl, // The frontend video player finally gets the URL
          lastPosition: history.lastPosition
        }
      });
    } catch (error) {
      req.log.error(`Playback Authorization Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to initialize secure stream.' });
    }
  });

  // ==========================================
  // 3. TRACK WATCH PROGRESS
  // ==========================================
  fastify.put('/:id/progress', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const episodeId = req.params.id;
      const { lastPosition, completed } = req.body;
      const userId = req.user.userId;

      if (lastPosition === undefined) {
        return reply.code(400).send({ success: false, message: 'lastPosition is required.' });
      }

      await History.updateOne(
        { userId, episodeId },
        { 
          $set: { 
            lastPosition: Number(lastPosition),
            completed: completed || false 
          }
        },
        { upsert: true }
      );

      return reply.code(200).send({ success: true });
    } catch (error) {
      req.log.error(`Progress Sync Error: ${error.message}`);
      // Do not crash the app if a progress ping fails, just return 500 silently
      return reply.code(500).send({ success: false });
    }
  });

}