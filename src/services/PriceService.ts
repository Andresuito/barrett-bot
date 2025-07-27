import axios from 'axios';
import { PriceData, CryptoCurrency } from '../interfaces';

export class PriceService {
  private static readonly BASE_API_URL = 'https://api.coingecko.com/api/v3';
  private static lastRequestTime = 0;
  private static readonly REQUEST_DELAY = 6000;
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
      await this.rateLimitRequest();
      
      const idsString = cryptoIds.join(',');
      const url = `${this.BASE_API_URL}/simple/price?ids=${idsString}&vs_currencies=usd,eur&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true`;
      
      const response = await this.makeRequestWithRetry(url);
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

  private static async rateLimitRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.REQUEST_DELAY) {
      const waitTime = this.REQUEST_DELAY - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  private static async makeRequestWithRetry(url: string, maxRetries = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url);
        return response;
      } catch (error: any) {
        if (error.response?.status === 429 && attempt < maxRetries) {
          const retryAfter = error.response.headers['retry-after'];
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
          
          console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
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