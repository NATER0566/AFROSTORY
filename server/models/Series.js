import mongoose from 'mongoose';

const seriesSchema = new mongoose.Schema({
  creatorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  description: { 
    type: String, 
    required: true, 
    trim: true, 
    maxlength: 2000 
  },
  // --- Handle Movie vs Series ---
  type: { 
    type: String, 
    enum: ['Movie', 'Series'], 
    default: 'Series' 
  },
  coverImage: { 
    type: String, 
    required: true 
  },
  tags: [{ 
    type: String, 
    trim: true, 
    lowercase: true 
  }],
  status: { 
    type: String, 
    enum: ['ONGOING', 'COMPLETED', 'DRAFT'], 
    default: 'DRAFT' 
  },
  followers: { type: Number, default: 0 },
  totalViews: { type: Number, default: 0 },
  totalEpisodes: { type: Number, default: 0 },
  
  // --- Frontend UI Meta Data ---
  rating: { type: Number, default: 98 }, // 98% Match
  releaseYear: { type: Number, default: () => new Date().getFullYear() },

  // --- LIKE SYSTEM ---
  // We store User IDs in an array. The total likes = likes.length
  likes: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }]
}, { timestamps: true });

export default mongoose.model('Series', seriesSchema);
