import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document {
  chatId: number;
  coinId: string;
  coinSymbol: string;
  type: 'above' | 'below';
  price: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema: Schema = new Schema({
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['above', 'below'],
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

AlertSchema.index({ chatId: 1, active: 1 });
AlertSchema.index({ chatId: 1, coinId: 1 });

export const Alert = mongoose.model<IAlert>('Alert', AlertSchema);