import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { v2 as cloudinary } from 'cloudinary';
import bcrypt from 'bcryptjs';

export default async function profileRoutes(fastify, options) {

  // 1. UPLOAD AVATAR TO CLOUDINARY
  fastify.post('/avatar', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ success: false, message: 'No file uploaded.' });

      // Wrap Cloudinary stream in a promise
      const uploadPromise = new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'afrostory/avatars', transformation: [{ width: 400, height: 400, crop: 'fill' }] },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        data.file.pipe(stream);
      });

      const result = await uploadPromise;
      
      // Update User Database
      const user = await User.findByIdAndUpdate(
        req.user.userId, 
        { avatarUrl: result.secure_url }, 
        { new: true }
      );

      return reply.code(200).send({ success: true, avatarUrl: user.avatarUrl });
    } catch (error) {
      req.log.error(`Avatar Upload Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to upload avatar.' });
    }
  });

  // 2. UPDATE PROFILE DETAILS
  fastify.post('/update', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { username, email, pin } = req.body;
      const updates = { username, email };

      // If user provided a new PIN, hash it and save it
      if (pin && pin.length === 4) {
        const salt = await bcrypt.genSalt(10);
        updates.pinHash = await bcrypt.hash(pin, salt);
      }

      const updatedUser = await User.findByIdAndUpdate(req.user.userId, updates, { new: true });
      
      return reply.code(200).send({ 
        success: true, 
        user: { username: updatedUser.username, email: updatedUser.email } 
      });
    } catch (error) {
      req.log.error(`Profile Update Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to update profile.' });
    }
  });
}
