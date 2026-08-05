import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';

export default async function authRoutes(fastify, options) {
  
  // ==========================================
  // HELPER: GENERATE & SET SECURE COOKIE
  // ==========================================
  const setAuthSession = (reply, user) => {
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // 7-day session
    );

    reply.setCookie('afro_auth', token, {
      path: '/',
      httpOnly: true, // Prevents XSS attacks (JS cannot read it)
      secure: process.env.NODE_ENV === 'production', // Requires HTTPS in production
      sameSite: 'strict', // Prevents CSRF attacks
      maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
    });
  };

  // ==========================================
  // 1. REGISTER NEW USER (With DB Transaction)
  // ==========================================
  fastify.post('/register', async (req, reply) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return reply.code(400).send({ success: false, message: 'All fields are required.' });
    }

    // Check for existing users before starting transaction to save DB resources
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return reply.code(409).send({ success: false, message: 'Email or Username already in use.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Hash password (Cost factor 10 is the enterprise standard)
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // Create User
      const [newUser] = await User.create([{
        username,
        email,
        passwordHash
      }], { session });

      // Create strictly linked Wallet for this user
      await Wallet.create([{
        userId: newUser._id
      }], { session });

      // Commit the transaction (Lock it into the database)
      await session.commitTransaction();
      
      // Issue secure session
      setAuthSession(reply, newUser);

      return reply.code(201).send({
        success: true,
        message: 'Account created successfully',
        user: { id: newUser._id, username: newUser.username, role: newUser.role }
      });

    } catch (error) {
      await session.abortTransaction();
      req.log.error(`Registration Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to create account. Please try again.' });
    } finally {
      session.endSession();
    }
  });

  // ==========================================
  // 2. LOGIN USER
  // ==========================================
  fastify.post('/login', async (req, reply) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return reply.code(400).send({ success: false, message: 'Email and password are required.' });
    }

    try {
      // Find user and explicitly request the passwordHash (since it's hidden by default)
      const user = await User.findOne({ email }).select('+passwordHash');
      
      if (!user) {
        return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
      }

      // Cryptographically compare submitted password with stored hash
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
      }

      if (!user.isActive) {
        return reply.code(403).send({ success: false, message: 'Account has been suspended.' });
      }

      setAuthSession(reply, user);

      return reply.code(200).send({
        success: true,
        message: 'Login successful',
        user: { id: user._id, username: user.username, role: user.role }
      });
    } catch (error) {
      req.log.error(`Login Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Internal server error.' });
    }
  });

  // ==========================================
  // 3. GET CURRENT USER PROFILE (Protected)
  // ==========================================
  fastify.get('/me', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      // The middleware attached the token payload to req.user
      const user = await User.findById(req.user.userId);
      const wallet = await Wallet.findOne({ userId: req.user.userId });

      if (!user) {
        reply.clearCookie('afro_auth', { path: '/' });
        return reply.code(404).send({ success: false, message: 'User not found' });
      }

      return reply.code(200).send({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          adUnlocksRemaining: user.adUnlocksRemaining,
          balance: wallet ? wallet.storyCoins.toString() : "0.00"
        }
      });
    } catch (error) {
      req.log.error(`Fetch Profile Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to fetch user data.' });
    }
  });

  // ==========================================
  // 4. LOGOUT
  // ==========================================
  fastify.post('/logout', async (req, reply) => {
    reply.clearCookie('afro_auth', { path: '/' });
    return reply.code(200).send({ success: true, message: 'Logged out successfully' });
  });
}