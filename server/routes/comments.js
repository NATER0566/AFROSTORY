import Comment from '../models/Comment.js';
import Series from '../models/Series.js';
import { requireAuth } from '../middleware/auth.js';

export default async function commentRoutes(fastify, options) {

  // ==========================================
  // 1. FETCH COMMENTS FOR A SERIES/MOVIE
  // ==========================================
  fastify.get('/:seriesId', async (req, reply) => {
    try {
      const { seriesId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const comments = await Comment.find({ seriesId })
        .sort({ isPinned: -1, createdAt: -1 }) // Pinned comments always on top
        .skip(skip)
        .limit(Number(limit))
        .populate('userId', 'username') 
        .lean(); // Maximum JSON speed

      const total = await Comment.countDocuments({ seriesId });

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
  // 2. POST A NEW COMMENT
  // ==========================================
  fastify.post('/:seriesId', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const { seriesId } = req.params;
      const { text } = req.body;
      const userId = req.user.userId;

      if (!text || text.trim().length === 0) {
        return reply.code(400).send({ success: false, message: 'Comment cannot be empty.' });
      }

      // Verify Series/Movie exists
      const seriesExists = await Series.exists({ _id: seriesId });
      if (!seriesExists) {
        return reply.code(404).send({ success: false, message: 'Content not found.' });
      }

      const newComment = await Comment.create({
        seriesId,
        userId,
        text: text.trim()
      });

      const populatedComment = await Comment.findById(newComment._id)
        .populate('userId', 'username')
        .lean();

      // Broadcast to all active viewers
      if (fastify.io) {
        fastify.io.emit(`new_comment_${seriesId}`, populatedComment);
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

      // Strict Security: Only the author, ADMIN, or OWNER can delete it
      if (comment.userId.toString() !== userId && !['ADMIN', 'OWNER'].includes(role)) {
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
