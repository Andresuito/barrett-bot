export interface UserSettings {
  currency: 'usd' | 'eur';
  trackedCryptos: string[];
  updateInterval: UpdateInterval;
}

export type UpdateInterval = '15min' | '30min' | '1h' | '2h';