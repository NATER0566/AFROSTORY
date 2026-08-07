import User from '../models/User.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';
import { v2 as cloudinary } from 'cloudinary';

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


// Helper function to upload a stream to Cloudinary
function uploadToCloudinary(stream, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'afrostory',
        resource_type: options.resource_type || 'auto'
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    stream.pipe(uploadStream);
  });
}


export default async function studioRoutes(fastify, options) {

  // 1. Get Analytics
  fastify.get('/analytics', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({
          success: false,
          message: 'Unauthorized access.'
        });
      }

      // Aggregate all views/unlocks from the creator's episodes
      const seriesList = await Series.find({
        creatorId: req.user.userId
      }).select('_id');

      const seriesIds = seriesList.map(s => s._id);

      const stats = await Episode.aggregate([
        {
          $match: {
            seriesId: { $in: seriesIds }
          }
        },
        {
          $group: {
            _id: null,
            totalViews: { $sum: "$totalViews" },
            totalUnlocks: { $sum: "$totalUnlocks" },
            totalAdUnlocks: { $sum: "$totalAdUnlocks" }
          }
        }
      ]);

      const creator = await User.findById(req.user.userId)
        .select('followers');

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
      req.log.error(error);

      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch analytics.'
      });
    }
  });


  // 2. Get My Uploads
  fastify.get('/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({
          success: false,
          message: 'Unauthorized access.'
        });
      }

      const uploads = await Series.find({
        creatorId: req.user.userId
      })
        .sort({ createdAt: -1 })
        .lean();

      return reply.code(200).send({
        success: true,
        data: uploads
      });

    } catch (error) {
      req.log.error(error);

      return reply.code(500).send({
        success: false,
        message: 'Failed to fetch uploads.'
      });
    }
  });


  // 3. SECURE MULTIPART UPLOAD (Video & Image)
  fastify.post('/upload', { preHandler: [requireAuth] }, async (req, reply) => {
    try {

      // Check creator permissions
      if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {
        return reply.code(403).send({
          success: false,
          message: 'Only creators can upload content.'
        });
      }


      const parts = req.parts();

      const fields = {};

      let coverImageUploaded = false;
      let videoUploaded = false;


      // Process multipart form data safely
      for await (const part of parts) {

        // ============================
        // FILE UPLOADS
        // ============================
        if (part.type === 'file') {

          // COVER IMAGE
          if (part.fieldname === 'coverImage') {

            const imageResult = await uploadToCloudinary(
              part.file,
              {
                folder: 'afrostory/covers',
                resource_type: 'image'
              }
            );

            fields.coverImage = imageResult.secure_url;

            coverImageUploaded = true;
          }


          // VIDEO FILE
          else if (part.fieldname === 'videoFile') {

            const videoResult = await uploadToCloudinary(
              part.file,
              {
                folder: 'afrostory/videos',
                resource_type: 'video'
              }
            );

            fields.videoFile = videoResult.secure_url;

            videoUploaded = true;
          }

        }


        // ============================
        // NORMAL FORM FIELDS
        // ============================
        else {
          fields[part.fieldname] = part.value;
        }
      }


      // ============================
      // VALIDATION
      // ============================

      if (!fields.title) {
        return reply.code(400).send({
          success: false,
          message: 'Title is required.'
        });
      }

      if (!fields.description) {
        return reply.code(400).send({
          success: false,
          message: 'Description is required.'
        });
      }

      if (!coverImageUploaded) {
        return reply.code(400).send({
          success: false,
          message: 'Cover image is required.'
        });
      }

      if (!videoUploaded) {
        return reply.code(400).send({
          success: false,
          message: 'Video file is required.'
        });
      }


      // ============================
      // STEP 1:
      // CREATE THE SERIES/MOVIE PARENT
      // ============================

      const newSeries = await Series.create({

        creatorId: req.user.userId,

        title: fields.title,

        description: fields.description,

        type: fields.type || 'Movie',

        coverImage: fields.coverImage,

        status: 'ONGOING'

      });


      // ============================
      // STEP 2:
      // CREATE EPISODE/VIDEO DATA
      // ============================

      await Episode.create({

        seriesId: newSeries._id,

        title: fields.title,

        mediaUrl: fields.videoFile,

        access: fields.access || 'Free',

        coinCost: fields.coinCost
          ? Number(fields.coinCost)
          : 0,

        status: 'PUBLISHED'

      });


      // ============================
      // STEP 3:
      // UPDATE SERIES COUNT
      // ============================

      await Series.updateOne(
        { _id: newSeries._id },
        {
          totalEpisodes: 1
        }
      );


      // ============================
      // SUCCESS RESPONSE
      // ============================

      return reply.code(201).send({

        success: true,

        message: 'Content Published!',

        data: {
          seriesId: newSeries._id,

          coverImage: fields.coverImage,

          videoUrl: fields.videoFile
        }

      });

    } catch (error) {

      req.log.error(error);

      return reply.code(500).send({

        success: false,

        message: 'Upload failed.',

        error: process.env.NODE_ENV === 'development'
          ? error.message
          : undefined

      });
    }
  });

}
