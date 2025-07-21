import mongoose, { Schema, Document } from 'mongoose';

export interface IUserSettings extends Document {
  chatId: number;
  currency: 'usd' | 'eur';
  trackedCryptos: string[];
  updateInterval: '15min' | '30min' | '1h' | '2h';
  createdAt: Date;
  updatedAt: Date;
}

const UserSettingsSchema: Schema = new Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  currency: {
    type: String,
    enum: ['usd', 'eur'],
    default: 'usd',
    required: true
  },
  trackedCryptos: {
    type: [String],
    default: ['ethereum'],
    required: true
  },
  updateInterval: {
    type: String,
    enum: ['15min', '30min', '1h', '2h'],
    default: '1h',
    required: true
  }
}, {
  timestamps: true
});

UserSettingsSchema.index({ chatId: 1 });

export const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema);