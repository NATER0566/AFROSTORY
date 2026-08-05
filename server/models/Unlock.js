import mongoose from 'mongoose';

const unlockSchema = new mongoose.Schema({
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
  method: { 
    type: String, 
    enum: ['COIN', 'AD', 'VIP', 'FREE'], 
    required: true 
  },
  amountPaid: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0.00 
  }
}, { timestamps: true });

// CRITICAL SECURITY: A user can NEVER unlock the same episode twice.
unlockSchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('Unlock', unlockSchema);