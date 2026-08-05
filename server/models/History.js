import mongoose from 'mongoose';

const historySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  episodeId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Episode', 
    required: true, 
    index: true 
  },
  lastPosition: { 
    type: Number, 
    default: 0 // In seconds
  },
  completed: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

// A user can only have one history state per episode
historySchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('History', historySchema);