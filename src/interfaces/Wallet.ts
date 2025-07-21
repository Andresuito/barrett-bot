export interface Wallet {
  chatId: number;
  address: string;
  network: 'ethereum' | 'bitcoin' | 'bsc' | 'solana';
  label?: string;
}

export interface WalletBalance {
  address: string;
  network: string;
  balance: number;
  balanceUsd: number;
  balanceEur: number;
  symbol: string;
}