import mongoose, { Schema, Document } from 'mongoose';

export interface IPortfolioEntry extends Document {
  chatId: number;
  cryptoId: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PortfolioEntrySchema: Schema = new Schema({
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  cryptoId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  }
}, {
  timestamps: true
});

PortfolioEntrySchema.index({ chatId: 1, cryptoId: 1 });
PortfolioEntrySchema.index({ chatId: 1, timestamp: -1 });

export const PortfolioEntry = mongoose.model<IPortfolioEntry>('PortfolioEntry', PortfolioEntrySchema);