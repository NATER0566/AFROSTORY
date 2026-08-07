import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import geoip from 'geoip-lite';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';

export default async function authRoutes(fastify, options) {
  
  // ==========================================
  // HELPER: GENERATE & SET SECURE COOKIE
  // ==========================================
  const setAuthSession = (reply, user) => {
    const token = jwt.sign(
      { userId: user._id, role: user.role, country: user.country },
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

  // HELPER: GENERATE 6-DIGIT OTP
  const generateOTP = () => {
    return crypto.randomInt(100000, 999999).toString();
  };

  // ==========================================
  // 1. REGISTER NEW USER (OTP & IP Tracking)
  // ==========================================
  fastify.post('/register', async (req, reply) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return reply.code(400).send({ success: false, message: 'All fields are required.' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return reply.code(409).send({ success: false, message: 'Email or Username already in use.' });
    }

    // --- SILENT IP GEOLOCATION ---
    // If testing locally (127.0.0.1), we default to 'NG'. In production, it reads the real IP.
    let userIP = req.ip || req.socket.remoteAddress;
    if (userIP === '127.0.0.1' || userIP === '::1') userIP = '102.89.0.0'; // Mock Nigerian IP for localhost testing
    
    const geo = geoip.lookup(userIP);
    const countryCode = geo ? geo.country : 'UNKNOWN';

    // --- OTP GENERATION ---
    const otpCode = generateOTP();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // Valid for 15 minutes

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // Create User (isVerified defaults to false in the Model)
      const [newUser] = await User.create([{
        username,
        email,
        passwordHash,
        country: countryCode,
        otpCode: otpCode,
        otpExpiry: otpExpiry
      }], { session });

      // Create strictly linked Wallet
      await Wallet.create([{
        userId: newUser._id
      }], { session });

      await session.commitTransaction();
      
      // LOG THE OTP TO YOUR CONSOLE FOR TESTING
      // In production, you will connect SendGrid/Nodemailer here to actually email it.
      console.log(`\n=== MOCK EMAIL SENT ===\nTo: ${email}\nYour AfroStory Code is: ${otpCode}\n=======================\n`);

      // NOTE: We do NOT call setAuthSession here anymore. They must verify first.
      return reply.code(201).send({
        success: true,
        message: 'Account created successfully. OTP Sent.'
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
  // 2. VERIFY EMAIL (OTP CHECK)
  // ==========================================
  fastify.post('/verify-email', async (req, reply) => {
    const { email, code } = req.body;

    if (!email || !code) {
      return reply.code(400).send({ success: false, message: 'Email and Code are required.' });
    }

    try {
      // Must explicitly select the hidden OTP fields
      const user = await User.findOne({ email }).select('+otpCode +otpExpiry');
      
      if (!user) {
        return reply.code(404).send({ success: false, message: 'User not found.' });
      }

      if (user.isVerified) {
        return reply.code(400).send({ success: false, message: 'Account is already verified.' });
      }

      // Check if code matches and is not expired
      if (user.otpCode !== code || user.otpExpiry < Date.now()) {
        return reply.code(400).send({ success: false, message: 'Invalid or expired code.' });
      }

      // Mark as verified and wipe the OTP data for security
      user.isVerified = true;
      user.otpCode = undefined;
      user.otpExpiry = undefined;
      await user.save();

      // NOW we issue the secure cookie
      setAuthSession(reply, user);

      return reply.code(200).send({ success: true, message: 'Account verified successfully.' });

    } catch (error) {
      req.log.error(`Verification Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Internal server error.' });
    }
  });

  // ==========================================
  // 3. LOGIN USER (With Verification Check)
  // ==========================================
  fastify.post('/login', async (req, reply) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return reply.code(400).send({ success: false, message: 'Email and password are required.' });
    }

    try {
      const user = await User.findOne({ email }).select('+passwordHash');
      
      if (!user) {
        return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
      }

      if (!user.isActive) {
        return reply.code(403).send({ success: false, message: 'Account has been suspended.' });
      }

      // --- NEW: THE UNVERIFIED BLOCKER ---
      if (!user.isVerified) {
        // Generate a fresh OTP because they are trying to log in but never verified
        const otpCode = generateOTP();
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
        
        await User.updateOne({ _id: user._id }, { otpCode, otpExpiry });

        console.log(`\n=== MOCK EMAIL SENT ===\nTo: ${email}\nYour FRESH AfroStory Code is: ${otpCode}\n=======================\n`);

        // Send exactly what the frontend is expecting to trigger the OTP slide
        return reply.code(403).send({ 
            success: false, 
            code: 'UNVERIFIED', 
            message: 'Account not verified. A new code has been sent to your email.' 
        });
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
  // 4. RESEND OTP
  // ==========================================
  fastify.post('/resend-otp', async (req, reply) => {
    const { email } = req.body;
    
    try {
        const user = await User.findOne({ email });
        
        if (user && !user.isVerified) {
            const otpCode = generateOTP();
            const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
            
            await User.updateOne({ _id: user._id }, { otpCode, otpExpiry });
            console.log(`\n=== MOCK EMAIL SENT ===\nTo: ${email}\nYour RESENT AfroStory Code is: ${otpCode}\n=======================\n`);
        }

        // We always return 200 OK even if the email doesn't exist to prevent hackers from "email guessing"
        return reply.code(200).send({ success: true, message: 'If the email exists, a new code was sent.' });
    } catch (error) {
        return reply.code(500).send({ success: false, message: 'Server error' });
    }
  });

  // ==========================================
  // 5. FORGOT PASSWORD STUB
  // ==========================================
  fastify.post('/forgot-password', async (req, reply) => {
      // In production, generate a reset token and email it here
      return reply.code(200).send({ success: true, message: 'Reset link sent.' });
  });

  // ==========================================
  // 6. GET CURRENT USER PROFILE (Protected)
  // ==========================================
  fastify.get('/me', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
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
          country: user.country,
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
  // 7. LOGOUT
  // ==========================================
  fastify.post('/logout', async (req, reply) => {
    reply.clearCookie('afro_auth', { path: '/' });
    return reply.code(200).send({ success: true, message: 'Logged out successfully' });
  });
}
