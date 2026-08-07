import User from '../models/User.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';

export default async function studioRoutes(fastify, options) {

  // 1. Get Analytics
  fastify.get('/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({ success: false, message: 'Unauthorized access.' });
      }

      // Aggregate all views/unlocks from the creator's episodes
      const seriesList = await Series.find({ creatorId: req.user.userId }).select('_id');
      const seriesIds = seriesList.map(s => s._id);

      const stats = await Episode.aggregate([
        { $match: { seriesId: { $in: seriesIds } } },
        { $group: {
            _id: null,
            totalViews: { $sum: "$totalViews" },
            totalUnlocks: { $sum: "$totalUnlocks" },
            totalAdUnlocks: { $sum: "$totalAdUnlocks" }
        }}
      ]);

      const creator = await User.findById(req.user.userId).select('followers');

      return reply.code(200).send({ 
        success: true, 
        data: { 
            totalViews: stats[0]?.totalViews || 0, 
            followers: creator?.followers || 0, 
            totalAdUnlocks: stats[0]?.totalAdUnlocks || 0, 
            totalUnlocks: stats[0]?.totalUnlocks || 0 
        } 
      });
    } catch (error) {
      return reply.code(500).send({ success: false, message: 'Failed to fetch analytics.' });
    }
  });

  // 2. Get My Uploads
  fastify.get('/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({ success: false, message: 'Unauthorized access.' });
      }

      const uploads = await Series.find({ creatorId: req.user.userId })
        .sort({ createdAt: -1 })
        .lean();

      return reply.code(200).send({ success: true, data: uploads });
    } catch (error) {
      return reply.code(500).send({ success: false, message: 'Failed to fetch uploads.' });
    }
  });

  // 3. SECURE MULTIPART UPLOAD (Video & Image)
  fastify.post('/upload', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({ success: false, message: 'Only creators can upload content.' });
      }

      const parts = req.parts();
      const fields = {};
      
      // Process multipart form data safely
      for await (const part of parts) {
        if (part.type === 'file') {
            // TODO: Stream `part.file` directly to Cloudinary here.
            // For now, we mock the URLs so your frontend works instantly.
            if (part.fieldname === 'coverImage') fields.coverImage = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=400';
            if (part.fieldname === 'videoFile') fields.videoFile = 'https://www.w3schools.com/html/mov_bbb.mp4';
        } else {
            fields[part.fieldname] = part.value;
        }
      }

      // Step 1: Create the Series/Movie Parent
      const newSeries = await Series.create({
        creatorId: req.user.userId,
        title: fields.title,
        description: fields.description,
        type: fields.type || 'Movie',
        coverImage: fields.coverImage,
        status: 'ONGOING' 
      });

      // Step 2: Create the Episode/Video Data attached to it
      await Episode.create({
        seriesId: newSeries._id,
        title: fields.title,
        mediaUrl: fields.videoFile,
        access: fields.access || 'Free',
        coinCost: fields.coinCost ? Number(fields.coinCost) : 0,
        status: 'PUBLISHED'
      });

      // Update series count
      await Series.updateOne({ _id: newSeries._id }, { totalEpisodes: 1 });

      return reply.code(201).send({ success: true, message: 'Content Published!' });
    } catch (error) {
      req.log.error(error);
      return reply.code(500).send({ success: false, message: 'Upload failed.' });
    }
  });
}
