export interface PriceData {
  symbol: string;
  name: string;
  priceUsd: number;
  priceEur: number;
  change24hUsd: number;
  change24hEur: number;
  change7dUsd: number;
  change7dEur: number;
  marketCapUsd: number;
  marketCapEur: number;
  volume24hUsd: number;
  volume24hEur: number;
  timestamp: Date;
}

export interface CryptoCurrency {
  id: string;
  symbol: string;
  name: string;
}