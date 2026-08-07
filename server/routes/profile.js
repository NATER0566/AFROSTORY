import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth.js';

export default async function profileRoutes(fastify, options) {
  
  // 1. Update Profile Info & PIN
  fastify.post('/update', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { username, email, pin } = req.body;
      const updates = { username, email };

      if (pin) {
        const salt = await bcrypt.genSalt(10);
        updates.pinHash = await bcrypt.hash(pin, salt);
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.user.userId,
        { $set: updates },
        { new: true, runValidators: true }
      );

      return reply.code(200).send({ 
        success: true, 
        user: { username: updatedUser.username, email: updatedUser.email } 
      });
    } catch (error) {
      return reply.code(500).send({ success: false, message: 'Failed to update profile.' });
    }
  });

  // 2. Upload Avatar (Multipart)
  fastify.post('/avatar', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ success: false, message: 'No file uploaded.' });

      // TODO: Connect Cloudinary `upload_stream` here.
      // For now, we return a mock URL so your frontend doesn't crash during testing.
      const mockAvatarUrl = `https://ui-avatars.com/api/?name=${req.user.username || 'User'}&background=D4A017&color=111`;

      await User.findByIdAndUpdate(req.user.userId, { avatarUrl: mockAvatarUrl });

      return reply.code(200).send({ success: true, avatarUrl: mockAvatarUrl });
    } catch (error) {
      return reply.code(500).send({ success: false, message: 'Avatar upload failed.' });
    }
  });
}
