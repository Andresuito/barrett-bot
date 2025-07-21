import mongoose, { Schema, Document } from 'mongoose';

export interface IWallet extends Document {
  chatId: number;
  address: string;
  network: 'ethereum' | 'bitcoin' | 'bsc' | 'solana';
  label?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema: Schema = new Schema({
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  address: {
    type: String,
    required: true,
    lowercase: true
  },
  network: {
    type: String,
    enum: ['ethereum', 'bitcoin', 'bsc', 'solana'],
    required: true,
    default: 'ethereum'
  },
  label: {
    type: String,
    maxlength: 50
  }
}, {
  timestamps: true
});

WalletSchema.index({ chatId: 1 });
WalletSchema.index({ chatId: 1, address: 1, network: 1 }, { unique: true });

export const Wallet = mongoose.model<IWallet>('Wallet', WalletSchema);