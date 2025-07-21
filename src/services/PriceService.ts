import axios from 'axios';
import { PriceData, CryptoCurrency } from '../interfaces';

export class PriceService {
  private static readonly BASE_API_URL = 'https://api.coingecko.com/api/v3';
  static readonly SUPPORTED_CRYPTOS: CryptoCurrency[] = [
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', emoji: '🔷' },
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', emoji: '₿' },
    { id: 'binancecoin', symbol: 'BNB', name: 'BNB', emoji: '🔶' },
    { id: 'cardano', symbol: 'ADA', name: 'Cardano', emoji: '🎯' },
    { id: 'solana', symbol: 'SOL', name: 'Solana', emoji: '☀️' },
    { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', emoji: '🔗' },
    { id: 'polygon', symbol: 'MATIC', name: 'Polygon', emoji: '🔮' },
    { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', emoji: '🐕' },
    { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', emoji: '🐶' },
    { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', emoji: '🏔️' }
  ];

  static async getCryptoPrices(cryptoIds: string[]): Promise<PriceData[]> {
    try {
      const idsString = cryptoIds.join(',');
      const url = `${this.BASE_API_URL}/simple/price?ids=${idsString}&vs_currencies=usd,eur&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true`;
      
      const response = await axios.get(url);
      const priceData: PriceData[] = [];
      
      for (const cryptoId of cryptoIds) {
        const data = response.data[cryptoId];
        if (data) {
          const crypto = this.SUPPORTED_CRYPTOS.find(c => c.id === cryptoId);
          priceData.push({
            symbol: crypto?.symbol || cryptoId.toUpperCase(),
            name: crypto?.name || cryptoId,
            priceUsd: data.usd,
            priceEur: data.eur,
            change24hUsd: data.usd_24h_change || 0,
            change24hEur: data.eur_24h_change || 0,
            change7dUsd: data.usd_7d_change || 0,
            change7dEur: data.eur_7d_change || 0,
            marketCapUsd: data.usd_market_cap || 0,
            marketCapEur: data.eur_market_cap || 0,
            volume24hUsd: data.usd_24h_vol || 0,
            volume24hEur: data.eur_24h_vol || 0,
            timestamp: new Date()
          });
        }
      }
      
      return priceData;
    } catch (error) {
      console.error('Error fetching crypto prices:', error);
      throw error;
    }
  }


  static findCryptoBySymbol(symbol: string): CryptoCurrency | undefined {
    return this.SUPPORTED_CRYPTOS.find(
      c => c.symbol.toLowerCase() === symbol.toLowerCase()
    );
  }

  static findCryptoById(id: string): CryptoCurrency | undefined {
    return this.SUPPORTED_CRYPTOS.find(c => c.id === id);
  }
}