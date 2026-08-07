import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';

export default async function seriesRoutes(fastify, options) {

  // ==========================================
  // 1. GET HERO BANNER (Must be before /:id)
  // ==========================================
  fastify.get('/hero', async (req, reply) => {
    try {
      const hero = await Series.findOne({ status: 'ONGOING' })
        .sort({ totalViews: -1 })
        .lean();
      
      return reply.code(200).send(hero || {});
    } catch (error) {
      req.log.error(`Hero Fetch Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load hero.' });
    }
  });

  // ==========================================
  // 2. GET TRENDING (Must be before /:id)
  // ==========================================
  fastify.get('/trending', async (req, reply) => {
    try {
      const trending = await Series.find({ status: 'ONGOING' })
        .sort({ totalViews: -1 })
        .limit(10)
        .lean();
      
      const formattedTrending = trending.map(item => ({
        _id: item._id,
        title: item.title,
        type: item.type, 
        img: item.coverImage,
        access: item.totalEpisodes > 0 ? 'Premium' : 'Free' 
      }));

      return reply.code(200).send(formattedTrending);
    } catch (error) {
      req.log.error(`Trending Fetch Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load trending.' });
    }
  });

  // ==========================================
  // 3. GET ALL SERIES (For the Discover Feed)
  // ==========================================
  fastify.get('/', async (req, reply) => {
    try {
      const { category, sort = 'popular', page = 1, limit = 10 } = req.query;
      
      const query = { status: 'ONGOING' }; 

      if (category) {
        query.tags = { $in: [category.toLowerCase()] };
      }

      const sortOption = sort === 'popular' ? { totalViews: -1 } : { createdAt: -1 };
      const skip = (page - 1) * limit;

      const series = await Series.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(Number(limit))
        .populate('creatorId', 'username brandName') 
        .lean(); 

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
  // 4. CREATE A NEW SERIES (Protected)
  // ==========================================
  fastify.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({ success: false, message: 'Unauthorized. Only Creators can launch a series.' });
      }

      const { title, description, type, coverImage, tags } = req.body;

      if (!title || !description || !coverImage) {
        return reply.code(400).send({ success: false, message: 'Title, description, and cover image are required.' });
      }

      const newSeries = await Series.create({
        creatorId: req.user.userId,
        title,
        description,
        type: type || 'Series',
        coverImage,
        tags: tags || [],
        status: 'DRAFT' 
      });

      return reply.code(201).send({
        success: true,
        message: `${newSeries.type} created successfully.`,
        data: newSeries
      });
    } catch (error) {
      req.log.error(`Create Series Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to initialize series.' });
    }
  });

  // ==========================================
  // 5. TOGGLE LIKE ON A SERIES/MOVIE
  // ==========================================
  fastify.post('/like', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { seriesId } = req.body;
      const userId = req.user.userId;

      if (!seriesId) {
        return reply.code(400).send({ success: false, message: 'Series ID required' });
      }

      const series = await Series.findById(seriesId);
      if (!series) {
        return reply.code(404).send({ success: false, message: 'Content not found' });
      }

      const hasLiked = series.likes.includes(userId);

      if (hasLiked) {
        await Series.updateOne(
          { _id: seriesId }, 
          { $pull: { likes: userId } }
        );
        return reply.code(200).send({ success: true, message: 'Unliked', liked: false });
      } else {
        await Series.updateOne(
          { _id: seriesId }, 
          { $addToSet: { likes: userId } }
        );
        return reply.code(200).send({ success: true, message: 'Liked!', liked: true });
      }
      
    } catch (error) {
      req.log.error(`Like Series Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to process like.' });
    }
  });

  // ==========================================
  // 6. GET SINGLE SERIES + EPISODE LIST
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

      const episodes = await Episode.find({ seriesId: id, status: 'PUBLISHED' })
        .sort({ episodeNumber: 1 })
        .select('-mediaUrl') 
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
