import mongoose from 'mongoose';

const episodeSchema = new mongoose.Schema({
  seriesId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Series', 
    required: true, 
    index: true 
  },
  episodeNumber: { 
    type: Number, 
    required: true 
  },
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  mediaUrl: { 
    type: String, 
    required: true // Cloudinary HLS .m3u8 link
  },
  duration: { 
    type: Number, 
    required: true // in seconds
  },
  isFree: { type: Boolean, default: false },
  coinCost: { type: Number, default: 10, min: 0 },
  adUnlockable: { type: Boolean, default: true },
  
  // Analytics
  totalViews: { type: Number, default: 0 },
  totalUnlocks: { type: Number, default: 0 },
  totalAdUnlocks: { type: Number, default: 0 },
  averageWatchTime: { type: Number, default: 0 },
  likesCount: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['PUBLISHED', 'DRAFT'], 
    default: 'DRAFT' 
  }
}, { timestamps: true });

// Ensure episode numbers are mathematically unique within a single series
episodeSchema.index({ seriesId: 1, episodeNumber: 1 }, { unique: true });

export default mongoose.model('Episode', episodeSchema);