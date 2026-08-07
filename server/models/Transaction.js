import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
  type: { 
    type: String, 
    // ADDED: WITHDRAW and GIFT to support the new frontend buttons
    enum: ['FUND', 'SPEND', 'AD_REWARD', 'PAYOUT_CREDIT', 'WITHDRAW', 'SYSTEM_ADJUSTMENT', 'GIFT'], 
    required: true 
  },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true },
  reference: { type: String, unique: true, sparse: true },
  description: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);
