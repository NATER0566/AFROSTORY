import Favorite from '../models/Favorite.js';
import { requireAuth } from '../middleware/auth.js';

export default async function favoriteRoutes(fastify, options) {
  
  // Toggle Favorite (Add/Remove)
  fastify.post('/toggle', { preHandler: [requireAuth] }, async (req, reply) => {
    const { seriesId } = req.body;
    const userId = req.user.userId;

    if (!seriesId) return reply.code(400).send({ success: false, message: 'Series ID required' });

    try {
      const existing = await Favorite.findOne({ userId, seriesId });
      
      if (existing) {
        await Favorite.deleteOne({ _id: existing._id });
        return reply.code(200).send({ success: true, message: 'Removed from library' });
      } else {
        await Favorite.create({ userId, seriesId });
        return reply.code(200).send({ success: true, message: 'Added to library' });
      }
    } catch (error) {
      req.log.error(`Favorite Toggle Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to update library.' });
    }
  });

  // Get User's Favorites for the Grid
  fastify.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = req.user.userId;

    try {
      const favorites = await Favorite.find({ userId })
        .sort({ createdAt: -1 })
        .populate('seriesId', 'title coverImage type status')
        .lean();

      const formatted = favorites.filter(f => f.seriesId).map(f => ({
        _id: f.seriesId._id,
        title: f.seriesId.title,
        type: f.seriesId.type,
        img: f.seriesId.coverImage
      }));

      return reply.code(200).send(formatted);
    } catch (error) {
      req.log.error(`Fetch Favorites Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load library.' });
    }
  });
}
