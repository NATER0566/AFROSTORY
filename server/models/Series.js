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
  rating: { type: mongoose.Schema.Types.Decimal128, default: 0.0 }
}, { timestamps: true });

export default mongoose.model('Series', seriesSchema);