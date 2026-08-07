import Fastify from 'fastify';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart'; // <-- ADDED: Required for Video/Image uploads
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// ES Module path resolution for serving static frontend files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Fastify with advanced logging for development
const fastify = Fastify({
  logger: process.env.NODE_ENV === 'development' ? {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' }
    }
  } : true
});

// ==========================================
// 1. REGISTER ENTERPRISE MIDDLEWARE
// ==========================================

// Security headers (Helmet)
fastify.register(fastifyHelmet, {
  contentSecurityPolicy: false
});

// CORS (Cross-Origin Resource Sharing)
fastify.register(fastifyCors, {
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Cookie Parser
fastify.register(fastifyCookie, {
  secret: process.env.JWT_SECRET,
  parseOptions: {}
});

// Multipart for Studio Video/Image Uploads <-- ADDED
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max file size for videos
  }
});

// Static File Serving
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/',
});

// ==========================================
// 2. DATABASE CONNECTION (MongoDB Atlas)
// ==========================================
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in .env");

    await mongoose.connect(process.env.MONGO_URI);
    fastify.log.info('✅ MongoDB Atlas Connected Successfully');
  } catch (error) {
    fastify.log.error('❌ MongoDB Connection Failed:', error.message);
    process.exit(1);
  }
};

// ==========================================
// 3. REALTIME ENGINE (Socket.io)
// ==========================================
const io = new Server(fastify.server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

fastify.decorate('io', io);

io.on('connection', (socket) => {
  fastify.log.info(`🔌 Client Connected: ${socket.id}`);
  socket.on('disconnect', () => {
    fastify.log.info(`🔌 Client Disconnected: ${socket.id}`);
  });
});

// ==========================================
// 4. GRACEFUL SHUTDOWN (Production Safety)
// ==========================================
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    await mongoose.connection.close();
    await fastify.close();
    process.exit(0);
  });
});

// ==========================================
// API ROUTES
// ==========================================
import authRoutes from './routes/auth.js';
fastify.register(authRoutes, { prefix: '/api/auth' });

import walletRoutes from './routes/wallet.js';
fastify.register(walletRoutes, { prefix: '/api/wallet' });

import seriesRoutes from './routes/series.js';
fastify.register(seriesRoutes, { prefix: '/api/series' });

import episodeRoutes from './routes/episodes.js';
fastify.register(episodeRoutes, { prefix: '/api/episodes' });

import commentRoutes from './routes/comments.js';
fastify.register(commentRoutes, { prefix: '/api/comments' });

// <-- ADDED MISSING ROUTES FOR FRONTEND -->
import profileRoutes from './routes/profile.js';
fastify.register(profileRoutes, { prefix: '/api/profile' });

import studioRoutes from './routes/studio.js';
fastify.register(studioRoutes, { prefix: '/api/studio' });

// ==========================================
// 5. BOOTSTRAP SERVER
// ==========================================
const startServer = async () => {
  try {
    await connectDB();
    const port = process.env.PORT || 3000;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    fastify.log.info(`🚀 AfroStory Engine running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

startServer();
