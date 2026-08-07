import User from '../models/User.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';
import { v2 as cloudinary } from 'cloudinary';

// ==========================================
// CLOUDINARY CONFIGURATION
// ==========================================

cloudinary.config({
cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
api_key: process.env.CLOUDINARY_API_KEY,
api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==========================================
// CLOUDINARY IMAGE UPLOAD
// ==========================================

function uploadImageToCloudinary(stream) {
return new Promise((resolve, reject) => {

const uploadStream = cloudinary.uploader.upload_stream(
  {
    folder: 'afrostory/covers',
    resource_type: 'image'
  },
  (error, result) => {

    if (error) {
      return reject(error);
    }

    resolve(result);
  }
);

stream.pipe(uploadStream);

stream.on('error', (error) => {
  reject(error);
});

uploadStream.on('error', (error) => {
  reject(error);
});

});
}

// ==========================================
// CLOUDINARY LARGE VIDEO UPLOAD
// ==========================================
// Uses Cloudinary's chunked upload stream.
// This is better for large video files than
// using a normal upload_stream().

function uploadVideoToCloudinary(stream) {
return new Promise((resolve, reject) => {

const uploadStream = cloudinary.uploader.upload_chunked_stream(
  {
    folder: 'afrostory/videos',
    resource_type: 'video',

    // 20 MB chunks
    chunk_size: 20 * 1024 * 1024
  },
  (error, result) => {

    if (error) {
      return reject(error);
    }

    resolve(result);
  }
);

stream.pipe(uploadStream);

stream.on('error', (error) => {
  reject(error);
});

uploadStream.on('error', (error) => {
  reject(error);
});

});
}

export default async function studioRoutes(fastify, options) {

// ==========================================
// 1. GET ANALYTICS
// ==========================================

fastify.get('/analytics', { preHandler: [requireAuth] }, async (req, reply) => {

try {

  if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {

    return reply.code(403).send({
      success: false,
      message: 'Unauthorized access.'
    });

  }


  // Get all series belonging to the creator
  const seriesList = await Series.find({
    creatorId: req.user.userId
  }).select('_id');


  const seriesIds = seriesList.map(s => s._id);


  // Aggregate episode statistics
  const stats = await Episode.aggregate([

    {
      $match: {
        seriesId: { $in: seriesIds }
      }
    },

    {
      $group: {

        _id: null,

        totalViews: {
          $sum: "$totalViews"
        },

        totalUnlocks: {
          $sum: "$totalUnlocks"
        },

        totalAdUnlocks: {
          $sum: "$totalAdUnlocks"
        }

      }
    }

  ]);


  const creator = await User.findById(
    req.user.userId
  ).select('followers');


  return reply.code(200).send({

    success: true,

    data: {

      totalViews:
        stats[0]?.totalViews || 0,

      followers:
        creator?.followers || 0,

      totalAdUnlocks:
        stats[0]?.totalAdUnlocks || 0,

      totalUnlocks:
        stats[0]?.totalUnlocks || 0

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

// ==========================================
// 2. GET MY UPLOADS
// ==========================================

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

// ==========================================
// 3. SECURE MULTIPART UPLOAD
// ==========================================

fastify.post('/upload', { preHandler: [requireAuth] }, async (req, reply) => {

try {

  // ==========================================
  // CHECK CREATOR PERMISSIONS
  // ==========================================

  if (!['CREATOR', 'ADMIN', 'OWNER'].includes(req.user.role)) {

    return reply.code(403).send({

      success: false,

      message: 'Only creators can upload content.'

    });

  }


  // ==========================================
  // CHECK CLOUDINARY CONFIGURATION
  // ==========================================

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {

    req.log.error(
      'Cloudinary environment variables are missing.'
    );

    return reply.code(500).send({

      success: false,

      message: 'Cloudinary is not configured on the server.'

    });

  }


  const parts = req.parts();

  const fields = {};


  let coverImageUploaded = false;

  let videoUploaded = false;


  // ==========================================
  // PROCESS MULTIPART FORM DATA
  // ==========================================

  for await (const part of parts) {

    // ==========================================
    // FILE
    // ==========================================

    if (part.type === 'file') {


      // ==========================================
      // COVER IMAGE
      // ==========================================

      if (part.fieldname === 'coverImage') {

        const imageResult =
          await uploadImageToCloudinary(part.file);


        fields.coverImage =
          imageResult.secure_url;


        coverImageUploaded = true;

      }


      // ==========================================
      // VIDEO
      // ==========================================

      else if (part.fieldname === 'videoFile') {

        const videoResult =
          await uploadVideoToCloudinary(part.file);


        fields.videoFile =
          videoResult.secure_url;


        videoUploaded = true;

      }


      // ==========================================
      // UNKNOWN FILE
      // ==========================================

      else {

        // Consume the stream so the multipart
        // request can continue safely.
        part.file.resume();

      }

    }


    // ==========================================
    // NORMAL FORM FIELD
    // ==========================================

    else {

      fields[part.fieldname] = part.value;

    }

  }


  // ==========================================
  // VALIDATION
  // ==========================================

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


  // ==========================================
  // VALIDATE COIN COST
  // ==========================================

  let coinCost = 0;


  if (fields.coinCost !== undefined) {

    coinCost = Number(fields.coinCost);


    if (!Number.isFinite(coinCost) || coinCost < 0) {

      return reply.code(400).send({

        success: false,

        message: 'Invalid coin cost.'

      });

    }

  }


  // ==========================================
  // STEP 1:
  // CREATE SERIES / MOVIE
  // ==========================================

  const newSeries = await Series.create({

    creatorId: req.user.userId,

    title: fields.title,

    description: fields.description,

    type: fields.type || 'Movie',

    coverImage: fields.coverImage,

    status: 'ONGOING',

    totalEpisodes: 1

  });


  // ==========================================
  // STEP 2:
  // CREATE EPISODE
  // ==========================================

  const newEpisode = await Episode.create({

    seriesId: newSeries._id,

    title: fields.title,

    mediaUrl: fields.videoFile,

    access: fields.access || 'Free',

    coinCost: coinCost,

    status: 'PUBLISHED'

  });


  // ==========================================
  // SUCCESS RESPONSE
  // ==========================================

  return reply.code(201).send({

    success: true,

    message: 'Content Published!',

    data: {

      seriesId: newSeries._id,

      episodeId: newEpisode._id,

      coverImage: fields.coverImage,

      videoUrl: fields.videoFile

    }

  });


} catch (error) {

  req.log.error(error);


  return reply.code(500).send({

    success: false,

    message: 'Upload failed.',

    error:
      process.env.NODE_ENV === 'development'
        ? error.message
        : undefined

  });

}

});

}
