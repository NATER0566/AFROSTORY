import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  // --- CHANGED: Now attaches to the whole Series/Movie, not an individual episode
  seriesId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Series', 
    required: true, 
    index: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  text: { 
    type: String, 
    required: true, 
    trim: true,
    minlength: 1,
    maxlength: 1000 // Enterprise limit: prevents database bloat attacks
  },
  likes: { 
    type: Number, 
    default: 0 
  },
  isPinned: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

// Optimize query speed for loading comments under a series
commentSchema.index({ seriesId: 1, createdAt: -1 });

export default mongoose.model('Comment', commentSchema);
