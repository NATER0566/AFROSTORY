import Comment from '../models/Comment.js';
import Episode from '../models/Episode.js';
import { requireAuth } from '../middleware/auth.js';

export default async function commentRoutes(fastify, options) {

  // ==========================================
  // 1. FETCH COMMENTS FOR AN EPISODE (High Speed)
  // ==========================================
  fastify.get('/:episodeId', async (req, reply) => {
    try {
      const { episodeId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      // Use .lean() for maximum JSON speed. 
      // Populate grabs just the username to keep the payload lightweight.
      const comments = await Comment.find({ episodeId })
        .sort({ isPinned: -1, createdAt: -1 }) // Pinned comments always on top
        .skip(skip)
        .limit(Number(limit))
        .populate('userId', 'username') 
        .lean();

      const total = await Comment.countDocuments({ episodeId });

      return reply.code(200).send({
        success: true,
        data: comments,
        meta: { total, page: Number(page), pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      req.log.error(`Fetch Comments Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to load comments.' });
    }
  });

  // ==========================================
  // 2. POST A NEW COMMENT (Real-Time Broadcast)
  // ==========================================
  fastify.post('/:episodeId', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { episodeId } = req.params;
      const { text } = req.body;
      const userId = req.user.userId;

      if (!text || text.trim().length === 0) {
        return reply.code(400).send({ success: false, message: 'Comment cannot be empty.' });
      }

      // Verify episode exists before allowing a comment
      const episodeExists = await Episode.exists({ _id: episodeId });
      if (!episodeExists) {
        return reply.code(404).send({ success: false, message: 'Episode not found.' });
      }

      // Save to MongoDB
      const newComment = await Comment.create({
        episodeId,
        userId,
        text: text.trim()
      });

      // Populate user data before broadcasting so the UI shows the commenter's name
      const populatedComment = await Comment.findById(newComment._id)
        .populate('userId', 'username')
        .lean();

      // ENTERPRISE WEBSOCKET MAGIC: 
      // Instantly broadcast the comment to everyone connected to the Fastify server
      if (fastify.io) {
        fastify.io.emit(`new_comment_${episodeId}`, populatedComment);
      }

      return reply.code(201).send({
        success: true,
        message: 'Comment posted successfully.',
        data: populatedComment
      });
    } catch (error) {
      req.log.error(`Post Comment Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to post comment.' });
    }
  });

  // ==========================================
  // 3. DELETE A COMMENT (Security Check)
  // ==========================================
  fastify.delete('/:commentId', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;
      const role = req.user.role;

      const comment = await Comment.findById(commentId);
      if (!comment) {
        return reply.code(404).send({ success: false, message: 'Comment not found.' });
      }

      // Strict Security: Only the author or an ADMIN can delete it
      if (comment.userId.toString() !== userId && role !== 'ADMIN') {
        return reply.code(403).send({ success: false, message: 'Unauthorized to delete this comment.' });
      }

      await Comment.deleteOne({ _id: commentId });

      return reply.code(200).send({ success: true, message: 'Comment deleted.' });
    } catch (error) {
      req.log.error(`Delete Comment Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to delete comment.' });
    }
  });

}