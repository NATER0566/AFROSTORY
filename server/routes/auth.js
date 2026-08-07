import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import geoip from 'geoip-lite';
import crypto from 'crypto';
import { Resend } from 'resend';
import { requireAuth } from '../middleware/auth.js';

export default async function authRoutes(fastify, options) {
  
  // ==========================================
  // HELPER: GENERATE & SET SECURE COOKIE
  // ==========================================
  const setAuthSession = (reply, user) => {
    const token = jwt.sign(
      { userId: user._id, role: user.role, country: user.country },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } 
    );

    reply.setCookie('afro_auth', token, {
      path: '/',
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'strict', 
      maxAge: 7 * 24 * 60 * 60 
    });
  };

  const generateOTP = () => crypto.randomInt(100000, 999999).toString();

  // ==========================================
  // HELPER: MOBILE-OPTIMIZED RESEND EMAIL ENGINE
  // ==========================================
  // I updated this to accept 'title' and 'message' so we can reuse the beautiful template for Password Resets too!
  const sendRealEmail = async (email, otpCode, subject = 'Your AfroStory Verification Code', title = 'Unlock the Vault', message = 'Welcome to the premier platform for African storytelling. Please use the secure authorization code below to verify your device.') => {
    try {
      if (!process.env.RESEND_API_KEY) {
        console.log(`\n=== MOCK EMAIL (No API Key Found) ===\nTo: ${email}\nSubject: ${subject}\nCode: ${otpCode}\n=====================================\n`);
        return;
      }

      const resend = new Resend(process.env.RESEND_API_KEY);

      // The Cinematic AfroStory HTML Template - Fully Optimized for Mobile
      const htmlTemplate = `
        <div style="background-color: #000000; padding: 20px 10px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #F5F5F5;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.8);">
            
            <!-- Header -->
            <div style="text-align: center; padding: 30px 10px 10px 10px;">
              <h1 style="font-size: 28px; font-weight: 900; letter-spacing: 2px; margin: 0; color: #D4A017; white-space: nowrap;">
                AFRO<span style="color: #F5F5F5;">STORY</span>
              </h1>
              <div style="height: 2px; background: linear-gradient(90deg, transparent, #D4A017, transparent); margin: 15px auto 0 auto; width: 60%;"></div>
            </div>
            
            <!-- Body -->
            <div style="padding: 0 20px 30px 20px; text-align: center;">
              <h2 style="font-size: 22px; font-weight: 600; margin: 0 0 10px 0; color: #FFFFFF;">${title}</h2>
              <p style="color: #AAAAAA; font-size: 15px; line-height: 1.5; margin: 0 0 25px 0;">
                ${message}
              </p>
              
              <!-- OTP Box - Fixed Mobile Breaking -->
              <div style="background-color: #1B1B1B; border: 1px solid #333333; border-radius: 10px; padding: 20px 10px; text-align: center; margin-bottom: 25px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);">
                <p style="color: #777777; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 10px 0; white-space: nowrap;">Your Secure Code</p>
                <h1 style="font-size: 38px; font-weight: 900; letter-spacing: 8px; margin: 0; color: #D4A017; text-shadow: 0 0 15px rgba(212,160,23,0.3); white-space: nowrap;">
                  ${otpCode}
                </h1>
              </div>
              
              <p style="color: #888888; font-size: 13px; margin: 0;">
                For your security, this code will automatically expire in <strong>15 minutes</strong>.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background-color: #0A0A0A; padding: 20px; text-align: center; border-top: 1px solid #222222;">
              <p style="color: #555555; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin: 0;">
                Engineered & Secured By<br>
                <span style="color: #D4A017; font-weight: bold; font-size: 11px; line-height: 2.5; white-space: nowrap;">NATER GRACE CODE</span>
              </p>
            </div>
            
          </div>
        </div>
      `;

      const { data, error } = await resend.emails.send({
        from: 'AfroStory <onboarding@resend.dev>', 
        to: email,
        subject: subject,
        html: htmlTemplate
      });

      if (error) throw new Error(error.message);
      console.log(`✅ Real Email beautifully sent to ${email} (ID: ${data.id})`);
    } catch (error) {
      console.error('❌ Resend API Error:', error.message);
    }
  };

  // ==========================================
  // 1. REGISTER NEW USER 
  // ==========================================
  fastify.post('/register', async (req, reply) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) return reply.code(400).send({ success: false, message: 'All fields are required.' });

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return reply.code(409).send({ success: false, message: 'Email or Username already in use.' });

    let userIP = req.ip || req.socket.remoteAddress;
    if (userIP === '127.0.0.1' || userIP === '::1') userIP = '102.89.0.0'; 
    
    const geo = geoip.lookup(userIP);
    const countryCode = geo ? geo.country : 'UNKNOWN';

    const otpCode = generateOTP();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); 

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const defaultBrandName = `${username.toUpperCase()} STUDIO`;

      const [newUser] = await User.create([{
        username, email, passwordHash, country: countryCode, brandName: defaultBrandName, otpCode: otpCode, otpExpiry: otpExpiry
      }], { session });

      await Wallet.create([{ userId: newUser._id }], { session });
      await session.commitTransaction();
      
      await sendRealEmail(email, otpCode);
      return reply.code(201).send({ success: true, message: 'Account created successfully. OTP Sent.' });

    } catch (error) {
      await session.abortTransaction();
      req.log.error(`Registration Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to create account. Please try again.' });
    } finally {
      session.endSession();
    }
  });

  // ==========================================
  // 2. VERIFY EMAIL 
  // ==========================================
  fastify.post('/verify-email', async (req, reply) => {
    const { email, code } = req.body;

    if (!email || !code) return reply.code(400).send({ success: false, message: 'Email and Code are required.' });

    try {
      const user = await User.findOne({ email }).select('+otpCode +otpExpiry');
      
      if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });
      if (user.isVerified) return reply.code(400).send({ success: false, message: 'Account is already verified.' });
      if (user.otpCode !== code || user.otpExpiry < Date.now()) return reply.code(400).send({ success: false, message: 'Invalid or expired code.' });

      user.isVerified = true;
      user.otpCode = undefined;
      user.otpExpiry = undefined;
      await user.save();

      setAuthSession(reply, user);
      return reply.code(200).send({ success: true, message: 'Account verified successfully.' });
    } catch (error) {
      req.log.error(`Verification Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Internal server error.' });
    }
  });

  // ==========================================
  // 3. LOGIN USER
  // ==========================================
  fastify.post('/login', async (req, reply) => {
    const { email, password } = req.body;

    if (!email || !password) return reply.code(400).send({ success: false, message: 'Email and password are required.' });

    try {
      const user = await User.findOne({ email }).select('+passwordHash');
      if (!user) return reply.code(401).send({ success: false, message: 'Invalid credentials.' });

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
      if (!user.isActive) return reply.code(403).send({ success: false, message: 'Account has been suspended.' });

      if (!user.isVerified) {
        const otpCode = generateOTP();
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await User.updateOne({ _id: user._id }, { otpCode, otpExpiry });
        await sendRealEmail(email, otpCode);
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
        user: { 
            id: user._id, username: user.username, role: user.role, avatarUrl: user.avatarUrl, brandName: user.brandName
        }
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
            await sendRealEmail(email, otpCode);
        }
        return reply.code(200).send({ success: true, message: 'If the email exists, a new code was sent.' });
    } catch (error) {
        return reply.code(500).send({ success: false, message: 'Server error' });
    }
  });

  // ==========================================
  // 5. FORGOT PASSWORD (NEW ENGINE)
  // ==========================================
  fastify.post('/forgot-password', async (req, reply) => {
    const { email } = req.body;
    if (!email) return reply.code(400).send({ success: false, message: 'Email is required' });

    try {
      const user = await User.findOne({ email });
      
      // We always return success to prevent hackers from guessing which emails exist in your DB
      if (user) {
        const otpCode = generateOTP();
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await User.updateOne({ _id: user._id }, { otpCode, otpExpiry });

        await sendRealEmail(
          email, 
          otpCode, 
          'Reset Your AfroStory Password', 
          'Password Reset', 
          'We received a request to reset your password. Use the secure code below to set a new password.'
        );
      }

      return reply.code(200).send({ success: true, message: 'If the email exists, a reset code has been sent.' });
    } catch (error) {
      req.log.error(`Forgot Password Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'System error' });
    }
  });

  // ==========================================
  // 6. RESET PASSWORD (NEW ENGINE)
  // ==========================================
  fastify.post('/reset-password', async (req, reply) => {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return reply.code(400).send({ success: false, message: 'All fields are required' });
    }

    try {
      const user = await User.findOne({ email }).select('+otpCode +otpExpiry');
      
      if (!user) return reply.code(400).send({ success: false, message: 'Invalid request' });
      if (user.otpCode !== code || user.otpExpiry < Date.now()) {
        return reply.code(400).send({ success: false, message: 'Invalid or expired code.' });
      }

      // Hash the new password and clear the OTP so it can't be reused
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(newPassword, salt);
      user.otpCode = undefined;
      user.otpExpiry = undefined;
      await user.save();

      return reply.code(200).send({ success: true, message: 'Password has been reset successfully. You can now log in.' });
    } catch (error) {
      req.log.error(`Reset Password Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'System error' });
    }
  });

  // ==========================================
  // 7. GET CURRENT USER
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
          id: user._id, username: user.username, email: user.email, role: user.role,
          country: user.country, avatarUrl: user.avatarUrl, brandName: user.brandName,
          adUnlocksRemaining: user.adUnlocksRemaining, balance: wallet ? wallet.storyCoins.toString() : "0.00"
        }
      });
    } catch (error) {
      req.log.error(`Fetch Profile Error: ${error.message}`);
      return reply.code(500).send({ success: false, message: 'Failed to fetch user data.' });
    }
  });

  fastify.post('/logout', async (req, reply) => {
    reply.clearCookie('afro_auth', { path: '/' });
    return reply.code(200).send({ success: true, message: 'Logged out successfully' });
  });
}
