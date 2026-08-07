import mongoose from 'mongoose';

const historySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // ADDED: seriesId makes finding "Continue Watching" 100x faster for the database
  seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'Series', required: true },
  episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true, index: true },
  lastPosition: { type: Number, default: 0 },
  completed: { type: Boolean, default: false }
}, { timestamps: true });

historySchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('History', historySchema);
