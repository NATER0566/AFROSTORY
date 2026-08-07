import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    minlength: 3, 
    maxlength: 30, 
    index: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true, 
    index: true 
  },
  passwordHash: { 
    type: String, 
    required: true, 
    select: false // Absolute security: never returns in normal queries
  },
  pinHash: { 
    type: String, 
    select: false 
  },
  role: { 
    type: String, 
    enum: ['USER', 'CREATOR', 'ADMIN', 'OWNER'], 
    default: 'USER' 
  },
  // --- NEW: Regional Monetization Engine ---
  country: {
    type: String,
    default: 'UNKNOWN' // Will be auto-populated by IP (e.g., 'NG')
  },
  // --- NEW: OTP Verification Engine ---
  isVerified: {
    type: Boolean,
    default: false
  },
  otpCode: {
    type: String,
    select: false // Hidden from normal queries
  },
  otpExpiry: {
    type: Date,
    select: false // Hidden from normal queries
  },
  // ----------------------------------------
  adUnlocksRemaining: { 
    type: Number, 
    default: 3, 
    min: 0 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
