import axios from 'axios';
import { PriceData } from '../interfaces';

export class PriceService {
  private static readonly API_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true';

  static async getEthereumPrice(): Promise<PriceData> {
    try {
      const response = await axios.get(this.API_URL);
      const ethData = response.data.ethereum;
      
      return {
        priceUsd: ethData.usd,
        priceEur: ethData.eur,
        change24hUsd: ethData.usd_24h_change || 0,
        change24hEur: ethData.eur_24h_change || 0,
        change7dUsd: ethData.usd_7d_change || 0,
        change7dEur: ethData.eur_7d_change || 0,
        marketCapUsd: ethData.usd_market_cap || 0,
        marketCapEur: ethData.eur_market_cap || 0,
        volume24hUsd: ethData.usd_24h_vol || 0,
        volume24hEur: ethData.eur_24h_vol || 0,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error fetching Ethereum price:', error);
      throw error;
    }
  }
}