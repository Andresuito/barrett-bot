import mongoose, { Schema, Document } from 'mongoose';

export interface IUserSettings extends Document {
  chatId: number;
  currency: 'usd' | 'eur';
  trackedCryptos: string[];
  updateInterval: '15min' | '30min' | '1h' | '2h';
  emergencyAlerts: boolean;
  emergencyThreshold: number;
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
  },
  emergencyAlerts: {
    type: Boolean,
    default: true,
    required: true
  },
  emergencyThreshold: {
    type: Number,
    default: 10,
    min: 5,
    max: 25,
    required: true
  }
}, {
  timestamps: true
});

UserSettingsSchema.index({ chatId: 1 });

export const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema);