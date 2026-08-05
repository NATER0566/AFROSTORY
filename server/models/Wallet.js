import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true, 
    index: true 
  },
  storyCoins: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0.00 
  },
  lockedEarnings: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: 0.00 
  }
}, { timestamps: true });

export default mongoose.model('Wallet', walletSchema);