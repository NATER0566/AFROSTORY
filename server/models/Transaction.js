import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  walletId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Wallet', 
    required: true, 
    index: true 
  },
  type: { 
    type: String, 
    enum: ['FUND', 'SPEND', 'AD_REWARD', 'PAYOUT', 'SYSTEM_ADJUSTMENT'], 
    required: true 
  },
  amount: { 
    type: mongoose.Schema.Types.Decimal128, 
    required: true 
  },
  reference: { 
    type: String, 
    unique: true, 
    sparse: true // Paystack ref or internal idempotency key
  },
  description: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'SUCCESS', 'FAILED'], 
    default: 'PENDING' 
  }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);