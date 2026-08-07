import History from '../models/History.js';
import { requireAuth } from '../middleware/auth.js';

export default async function historyRoutes(fastify, options) {
  
  // 1. Save Video Progress
  fastify.post('/progress', { preHandler: [requireAuth] }, async (req, reply) => {
    const { episodeId, position, completed } = req.body;
    const userId = req.user.userId;

    try {
      // Find the episode to get the parent Series ID
      const Episode = (await import('../models/Episode.js')).default;
      const ep = await Episode.findById(episodeId).select('seriesId');
      if (!ep) return reply.code(404).send({ success: false });

      await History.findOneAndUpdate(
        { userId, episodeId },
        { lastPosition: position, completed, seriesId: ep.seriesId },
        { upsert: true, new: true }
      );
      return reply.code(200).send({ success: true });
    } catch (err) {
      return reply.code(500).send({ success: false });
    }
  });

  // 2. Get "Continue Watching" List
  fastify.get('/continue', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      // Get the 10 most recently watched series for this user
      const history = await History.find({ userId: req.user.userId })
        .sort({ updatedAt: -1 })
        .populate('seriesId', 'title coverImage type status')
        .limit(10)
        .lean();

      const formatted = history.filter(h => h.seriesId).map(h => ({
        _id: h.seriesId._id,
        title: h.seriesId.title,
        type: h.seriesId.type,
        img: h.seriesId.coverImage,
        progress: h.completed ? 100 : Math.floor(Math.random() * 80) + 10 // Calculate actual % in production using duration
      }));

      return reply.code(200).send(formatted);
    } catch (err) {
      return reply.code(500).send({ success: false });
    }
  });
}
