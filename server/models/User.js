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
    enum: ['USER', 'CREATOR', 'ADMIN'], 
    default: 'USER' 
  },
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