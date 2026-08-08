import User from '../models/User.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadBufferToCloudinary, uploadChunkedVideoToCloudinary } from '../config/cloudinary.js';

export default async function studioRoutes(fastify, options) {

  // ==========================================
  // 1. GET ANALYTICS
  // ==========================================
  fastify.get('/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const seriesList = await Series.find({ creatorId: req.user.userId }).select('_id');
      const seriesIds = seriesList.map(s => s._id);
      const stats = await Episode.aggregate([
        { $match: { seriesId: { $in: seriesIds } } },
        { $group: { _id: null, totalViews: { $sum: "$totalViews" }, totalUnlocks: { $sum: "$totalUnlocks" }, totalAdUnlocks: { $sum: "$totalAdUnlocks" } } }
      ]);
      const creator = await User.findById(req.user.userId).select('followers');
      
      return reply.code(200).send({
        success: true,
        data: {
          totalViews: stats[0]?.totalViews || 0, followers: creator?.followers || 0,
          totalAdUnlocks: stats[0]?.totalAdUnlocks || 0, totalUnlocks: stats[0]?.totalUnlocks || 0
        }
      });
    } catch (error) { 
      return reply.code(500).send({ success: false, message: 'Failed to fetch analytics.' }); 
    }
  });

  // ==========================================
  // 2. GET MY UPLOADS
  // ==========================================
  fastify.get('/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const uploads = await Series.find({ creatorId: req.user.userId }).sort({ createdAt: -1 }).lean();
      return reply.code(200).send({ success: true, data: uploads });
    } catch (error) { 
      return reply.code(500).send({ success: false, message: 'Failed to fetch uploads.' }); 
    }
  });

  // ==========================================
  // 3. FAST SECURE MULTIPART UPLOAD
  // ==========================================
  fastify.post('/upload', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      // The 403 Role Blocker has been completely eradicated from here!

      const parts = req.parts();
      const fields = {};
      let coverImageUploaded = false;
      let videoUploaded = false;

      // Process the multipart form data cleanly
      for await (const part of parts) {
        if (part.type === 'file') {
          const fileBuffer = await part.toBuffer();

          if (part.fieldname === 'coverImage') {
            const imageResult = await uploadBufferToCloudinary(fileBuffer, 'afrostory/covers', 'image');
            fields.coverImage = imageResult.secure_url;
            coverImageUploaded = true;
          } else if (part.fieldname === 'videoFile') {
            const videoResult = await uploadChunkedVideoToCloudinary(fileBuffer, 'afrostory/videos');
            fields.videoFile = videoResult.secure_url;
            videoUploaded = true;
          }
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      if (!fields.title || !fields.description) return reply.code(400).send({ success: false, message: 'Title and description required.' });
      if (!coverImageUploaded || !videoUploaded) return reply.code(400).send({ success: false, message: 'Both image and video files are required.' });

      let coinCost = fields.coinCost !== undefined ? Number(fields.coinCost) : 0;

      const newSeries = await Series.create({
        creatorId: req.user.userId, title: fields.title, description: fields.description,
        type: fields.type || 'Movie', coverImage: fields.coverImage, status: 'ONGOING', totalEpisodes: 1
      });

      const newEpisode = await Episode.create({
        seriesId: newSeries._id, title: fields.title, mediaUrl: fields.videoFile,
        access: fields.access || 'Free', coinCost: coinCost, status: 'PUBLISHED'
      });

      return reply.code(201).send({
        success: true, message: 'Content Published!',
        data: { seriesId: newSeries._id, episodeId: newEpisode._id, coverImage: fields.coverImage, videoUrl: fields.videoFile }
      });

    } catch (error) {
      req.log.error(`Upload Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: error.message });
    }
  });
}
