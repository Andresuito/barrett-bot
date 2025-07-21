import axios from 'axios';
import { WalletBalance } from '../interfaces';

export class WalletService {
  private static readonly BLOCKCHAIR_API = 'https://api.blockchair.com';
  private static readonly COINGECKO_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price';

  static async getWalletBalance(address: string, network: string): Promise<WalletBalance | null> {
    try {
      switch (network.toLowerCase()) {
        case 'ethereum':
          return await this.getEthereumBalance(address);
        case 'bitcoin':
          return await this.getBitcoinBalance(address);
        case 'bsc':
          return await this.getBSCBalance(address);
        case 'solana':
          return await this.getSolanaBalance(address);
        default:
          throw new Error(`Unsupported network: ${network}`);
      }
    } catch (error) {
      console.error(`Error fetching ${network} balance:`, error);
      return null;
    }
  }

  private static async getEthereumBalance(address: string): Promise<WalletBalance | null> {
    try {
      // Using Blockchair API (free, no API key needed)
      const balanceResponse = await axios.get(`${this.BLOCKCHAIR_API}/ethereum/dashboards/address/${address}`, {
        timeout: 10000
      });

      if (!balanceResponse.data?.data?.[address]) {
        throw new Error('Invalid response from Blockchair');
      }

      const addressData = balanceResponse.data.data[address].address;
      const balanceWei = addressData.balance;
      const balanceEth = parseFloat(balanceWei) / Math.pow(10, 18);

      // Get ETH price
      const priceResponse = await axios.get(`${this.COINGECKO_PRICE_API}?ids=ethereum&vs_currencies=usd,eur`, {
        timeout: 10000
      });

      const ethPriceUsd = priceResponse.data.ethereum.usd;
      const ethPriceEur = priceResponse.data.ethereum.eur;

      return {
        address,
        network: 'Ethereum',
        balance: balanceEth,
        balanceUsd: balanceEth * ethPriceUsd,
        balanceEur: balanceEth * ethPriceEur,
        symbol: 'ETH'
      };
    } catch (error) {
      console.error('Error fetching Ethereum balance:', error);
      return null;
    }
  }

  private static async getBitcoinBalance(address: string): Promise<WalletBalance | null> {
    try {
      const balanceResponse = await axios.get(`${this.BLOCKCHAIR_API}/bitcoin/dashboards/address/${address}`, {
        timeout: 10000
      });

      if (!balanceResponse.data?.data?.[address]) {
        throw new Error('Invalid response from Blockchair');
      }

      const addressData = balanceResponse.data.data[address].address;
      const balanceSatoshi = addressData.balance;
      const balanceBtc = balanceSatoshi / 100000000; // Convert satoshi to BTC

      // Get BTC price
      const priceResponse = await axios.get(`${this.COINGECKO_PRICE_API}?ids=bitcoin&vs_currencies=usd,eur`, {
        timeout: 10000
      });

      const btcPriceUsd = priceResponse.data.bitcoin.usd;
      const btcPriceEur = priceResponse.data.bitcoin.eur;

      return {
        address,
        network: 'Bitcoin',
        balance: balanceBtc,
        balanceUsd: balanceBtc * btcPriceUsd,
        balanceEur: balanceBtc * btcPriceEur,
        symbol: 'BTC'
      };
    } catch (error) {
      console.error('Error fetching Bitcoin balance:', error);
      return null;
    }
  }

  private static async getBSCBalance(address: string): Promise<WalletBalance | null> {
    try {
      // BSC uses same API as Ethereum but different endpoint
      const balanceResponse = await axios.get(`https://api.bscscan.com/api`, {
        params: {
          module: 'account',
          action: 'balance',
          address: address,
          tag: 'latest'
        },
        timeout: 10000
      });

      if (balanceResponse.data.status !== '1') {
        throw new Error('Failed to fetch balance from BSCScan');
      }

      const balanceWei = balanceResponse.data.result;
      const balanceBnb = parseFloat(balanceWei) / Math.pow(10, 18);

      // Get BNB price
      const priceResponse = await axios.get(`${this.COINGECKO_PRICE_API}?ids=binancecoin&vs_currencies=usd,eur`, {
        timeout: 10000
      });

      const bnbPriceUsd = priceResponse.data.binancecoin.usd;
      const bnbPriceEur = priceResponse.data.binancecoin.eur;

      return {
        address,
        network: 'BSC',
        balance: balanceBnb,
        balanceUsd: balanceBnb * bnbPriceUsd,
        balanceEur: balanceBnb * bnbPriceEur,
        symbol: 'BNB'
      };
    } catch (error) {
      console.error('Error fetching BSC balance:', error);
      return null;
    }
  }

  private static async getSolanaBalance(address: string): Promise<WalletBalance | null> {
    try {
      // Using Solana public RPC
      const response = await axios.post('https://api.mainnet-beta.solana.com', {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address]
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      const balanceLamports = response.data.result.value;
      const balanceSol = balanceLamports / Math.pow(10, 9); // Convert lamports to SOL

      // Get SOL price
      const priceResponse = await axios.get(`${this.COINGECKO_PRICE_API}?ids=solana&vs_currencies=usd,eur`, {
        timeout: 10000
      });

      const solPriceUsd = priceResponse.data.solana.usd;
      const solPriceEur = priceResponse.data.solana.eur;

      return {
        address,
        network: 'Solana',
        balance: balanceSol,
        balanceUsd: balanceSol * solPriceUsd,
        balanceEur: balanceSol * solPriceEur,
        symbol: 'SOL'
      };
    } catch (error) {
      console.error('Error fetching Solana balance:', error);
      return null;
    }
  }

  static detectAddressNetwork(address: string): string | null {
    // Ethereum/BSC address (40 hex chars with 0x prefix)
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return 'ethereum'; // Default to ethereum for EVM addresses
    }
    
    // Bitcoin address (various formats)
    if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || // P2PKH/P2SH Legacy
        /^bc1[a-z0-9]{39,59}$/.test(address)) { // Bech32
      return 'bitcoin';
    }
    
    // Solana address (base58, 32-44 chars)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'solana';
    }
    
    return null;
  }

  static validateAddress(address: string, network: string): boolean {
    switch (network.toLowerCase()) {
      case 'ethereum':
      case 'bsc':
        return /^0x[a-fA-F0-9]{40}$/.test(address);
      case 'bitcoin':
        return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[a-z0-9]{39,59}$/.test(address);
      case 'solana':
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      default:
        return false;
    }
  }
}