import User from '../models/User.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// IMAGE UPLOADER
function uploadImageToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'afrostory/covers', resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// VIDEO UPLOADER (CHUNKED FOR HUGE FILES)
function uploadVideoToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_chunked_stream(
      { folder: 'afrostory/videos', resource_type: 'video', chunk_size: 20 * 1024 * 1024 },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

export default async function studioRoutes(fastify, options) {

  fastify.get('/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) return reply.code(403).send({ success: false, message: 'Unauthorized' });
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
    } catch (error) { return reply.code(500).send({ success: false, message: 'Failed to fetch analytics.' }); }
  });

  fastify.get('/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) return reply.code(403).send({ success: false, message: 'Unauthorized' });
      const uploads = await Series.find({ creatorId: req.user.userId }).sort({ createdAt: -1 }).lean();
      return reply.code(200).send({ success: true, data: uploads });
    } catch (error) { return reply.code(500).send({ success: false, message: 'Failed to fetch uploads.' }); }
  });

  fastify.post('/upload', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) return reply.code(403).send({ success: false, message: 'Only creators can upload content.' });

      const parts = req.parts();
      const fields = {};
      let coverImageUploaded = false;
      let videoUploaded = false;

      for await (const part of parts) {
        if (part.type === 'file') {
          const fileBuffer = await part.toBuffer();

          if (part.fieldname === 'coverImage') {
            const imageResult = await uploadImageToCloudinary(fileBuffer);
            fields.coverImage = imageResult.secure_url;
            coverImageUploaded = true;
          } else if (part.fieldname === 'videoFile') {
            const videoResult = await uploadVideoToCloudinary(fileBuffer);
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
      return reply.code(500).send({ success: false, message: 'Upload failed.', error: error.message });
    }
  });
}
