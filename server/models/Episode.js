import mongoose from 'mongoose';

const episodeSchema = new mongoose.Schema({
  seriesId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Series', 
    required: true, 
    index: true 
  },
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  description: { 
    type: String 
  },
  season: { 
    type: Number, 
    default: 1 
  },
  episodeNumber: { 
    type: Number, 
    default: 1 // Optional now, so Standalone Movies don't crash the DB
  },
  mediaUrl: { 
    type: String, 
    required: true // Cloudinary Video URL
  },
  thumbnail: { 
    type: String // Cloudinary Cover Image
  },
  duration: { 
    type: String, // Changed to string to match frontend "45m" layout
    default: "00:00"
  },
  
  // --- STRICT MONETIZATION ENGINE ---
  access: { 
    type: String, 
    enum: ['Free', 'Ad', 'Premium'], 
    default: 'Free' 
  },
  isFree: { type: Boolean, default: true },
  adUnlockable: { type: Boolean, default: false },
  coinCost: { type: Number, default: 0, min: 0 },
  
  // --- ANALYTICS ---
  totalViews: { type: Number, default: 0 },
  totalUnlocks: { type: Number, default: 0 },
  totalAdUnlocks: { type: Number, default: 0 },
  likesCount: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['PUBLISHED', 'DRAFT'], 
    default: 'PUBLISHED' 
  }
}, { timestamps: true });

// SECURITY HOOK: Auto-sync frontend "access" strings to backend boolean locks
episodeSchema.pre('save', function(next) {
  if (this.access === 'Free') {
    this.isFree = true;
    this.adUnlockable = false;
    this.coinCost = 0;
  } else if (this.access === 'Ad') {
    this.isFree = false;
    this.adUnlockable = true;
    this.coinCost = 0;
  } else if (this.access === 'Premium') {
    this.isFree = false;
    this.adUnlockable = false;
    // coinCost is preserved from frontend input
  }
  next();
});

export default mongoose.model('Episode', episodeSchema);
