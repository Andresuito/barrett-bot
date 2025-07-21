export interface UserSettings {
  currency: 'usd' | 'eur';
  trackedCryptos: string[];
  updateInterval: UpdateInterval;
  emergencyAlerts: boolean;
  emergencyThreshold: number;
}

export type UpdateInterval = '15min' | '30min' | '1h' | '2h';