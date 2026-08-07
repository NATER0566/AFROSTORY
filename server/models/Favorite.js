import mongoose from 'mongoose';

const favoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'Series', required: true }
}, { timestamps: true });

// Prevent a user from favoriting the same series twice
favoriteSchema.index({ userId: 1, seriesId: 1 }, { unique: true });

export default mongoose.model('Favorite', favoriteSchema);
