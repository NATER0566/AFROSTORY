import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';

export default async function seriesRoutes(fastify, options) {

  // ==========================================
  // 1. GET ALL SERIES (For the Discover Feed)
  // ==========================================
  fastify.get('/', async (req, reply) => {
    try {
      const { category, sort = 'popular', page = 1, limit = 10 } = req.query;
      
      // Only serve series that are ready for the public
      const query = { status: 'ONGOING' }; 

      if (category) {
        query.tags = { $in: [category.toLowerCase()] };
      }

      // Sort by views or newest
      const sortOption = sort === 'popular' ? { totalViews: -1 } : { createdAt: -1 };
      const skip = (page - 1) * limit;

      const series = await Series.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(Number(limit))
        .populate('creatorId', 'username brandName') // Only grab safe creator data
        .lean(); // Strip Mongoose overhead for maximum JSON delivery speed

      const total = await Series.countDocuments(query);

      return reply.code(200).send({
        success: true,
        data: series,
        meta: { total, page: Number(page), pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      req.log.error(`Fetch Series Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load series feed.' });
    }
  });

  // ==========================================
  // 2. CREATE A NEW SERIES (Protected)
  // ==========================================
  fastify.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      // SECURITY: Strictly block normal users from cluttering the database
      if (req.user.role !== 'CREATOR' && req.user.role !== 'ADMIN') {
        return reply.code(403).send({ success: false, message: 'Unauthorized. Only Creators can launch a series.' });
      }

      const { title, description, coverImage, tags } = req.body;

      if (!title || !description || !coverImage) {
        return reply.code(400).send({ success: false, message: 'Title, description, and cover image are required.' });
      }

      const newSeries = await Series.create({
        creatorId: req.user.userId,
        title,
        description,
        coverImage,
        tags: tags || [],
        status: 'DRAFT' // Safely hide it from the public until episodes are uploaded
      });

      return reply.code(201).send({
        success: true,
        message: 'Series created successfully.',
        data: newSeries
      });
    } catch (error) {
      req.log.error(`Create Series Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to initialize series.' });
    }
  });

  // ==========================================
  // 3. GET SINGLE SERIES + EPISODE LIST
  // ==========================================
  fastify.get('/:id', async (req, reply) => {
    try {
      const { id } = req.params;

      const series = await Series.findById(id)
        .populate('creatorId', 'username brandName bio')
        .lean();

      if (!series) {
        return reply.code(404).send({ success: false, message: 'Series not found.' });
      }

      // Fetch all published episodes attached to this series, sorted chronologically
      const episodes = await Episode.find({ seriesId: id, status: 'PUBLISHED' })
        .sort({ episodeNumber: 1 })
        .select('-mediaUrl') // CRITICAL SECURITY: Never leak the raw HLS video URL on the public listing.
        .lean();

      return reply.code(200).send({
        success: true,
        data: {
          ...series,
          episodes
        }
      });
    } catch (error) {
      req.log.error(`Fetch Single Series Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load series details.' });
    }
  });

}