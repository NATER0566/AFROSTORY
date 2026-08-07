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
    select: false 
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
  
  // --- Profile & Studio Info ---
  avatarUrl: { type: String },
  brandName: { type: String },
  followers: { type: Number, default: 0 },

  // --- Regional Monetization Engine ---
  country: { type: String, default: 'UNKNOWN' },
  
  // --- OTP Verification Engine ---
  isVerified: { type: Boolean, default: false },
  otpCode: { type: String, select: false },
  otpExpiry: { type: Date, select: false },
  
  // --- System ---
  adUnlocksRemaining: { type: Number, default: 3, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
