import axios, { AxiosError } from 'axios';
import { WalletBalance } from '../interfaces';

export class WalletService {
  // Multiple API providers for better reliability (no env variables needed)
  
  private static readonly COINGECKO_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price';
  private static lastRequestTime = 0;
  private static readonly RATE_LIMIT_DELAY = 500; // Reduced delay with multiple APIs

  private static async rateLimitedRequest<T>(requestFn: () => Promise<T>, maxRetries = 3): Promise<T> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        if (error instanceof AxiosError) {
          const status = error.response?.status;
          
          // Rate limit errors (429, 430) or server errors (5xx) - retry with backoff
          if ((status === 429 || status === 430 || (status && status >= 500)) && attempt < maxRetries) {
            const backoffDelay = Math.pow(2, attempt) * 1000; // Exponential backoff
            console.warn(`API request failed with status ${status}, retrying in ${backoffDelay}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          }
          
          // Client errors (4xx except rate limits) - don't retry
          if (status && status >= 400 && status < 500 && status !== 429 && status !== 430) {
            throw error;
          }
        }
        
        // Last attempt or non-HTTP error
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Generic retry with shorter delay
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error('Max retries exceeded');
  }

  static async getWalletBalance(address: string, network: string): Promise<WalletBalance | null> {
    console.log(`🔍 Fetching ${network} balance for ${address.slice(0,8)}...${address.slice(-6)}`);
    
    try {
      switch (network.toLowerCase()) {
        case 'ethereum':
          return await this.getEthereumBalanceWithRetry(address);
        case 'bitcoin':
          return await this.getBitcoinBalanceWithRetry(address);
        case 'bsc':
          return await this.getBSCBalanceWithRetry(address);
        case 'solana':
          return await this.getSolanaBalanceWithRetry(address);
        default:
          throw new Error(`Unsupported network: ${network}`);
      }
    } catch (error) {
      console.error(`❌ Error fetching ${network} balance:`, error);
      return null;
    }
  }

  private static async getEthereumBalanceWithRetry(address: string): Promise<WalletBalance | null> {
    // Try Etherscan first (most reliable)
    try {
      console.log('🔷 Trying Etherscan API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get('https://api.etherscan.io/api', {
          params: {
            module: 'account',
            action: 'balance',
            address: address,
            tag: 'latest'
          },
          timeout: 8000
        })
      );
      
      if (balanceResponse.data.status === '1') {
        const balanceWei = balanceResponse.data.result;
        const balanceEth = parseFloat(balanceWei) / Math.pow(10, 18);
        console.log('✅ Etherscan successful');
        return await this.addPriceData(address, 'Ethereum', balanceEth, 'ETH', 'ethereum');
      }
    } catch (error) {
      console.warn('⚠️ Etherscan failed, trying BlockCypher...');
    }
    
    // Try BlockCypher API
    try {
      console.log('🔷 Trying BlockCypher API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get(`https://api.blockcypher.com/v1/eth/main/addrs/${address}/balance`, {
          timeout: 8000
        })
      );
      
      if (balanceResponse.data.balance !== undefined) {
        const balanceWei = balanceResponse.data.balance;
        const balanceEth = balanceWei / Math.pow(10, 18);
        console.log('✅ BlockCypher successful');
        return await this.addPriceData(address, 'Ethereum', balanceEth, 'ETH', 'ethereum');
      }
    } catch (error) {
      console.warn('⚠️ BlockCypher failed, trying Blockchair...');
    }
    
    // Fallback to Blockchair
    try {
      console.log('🔷 Trying Blockchair API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get(`https://api.blockchair.com/ethereum/dashboards/address/${address}`, {
          timeout: 10000
        })
      );
      
      if (balanceResponse.data?.data?.[address]) {
        const addressData = balanceResponse.data.data[address].address;
        const balanceWei = addressData.balance;
        const balanceEth = parseFloat(balanceWei) / Math.pow(10, 18);
        console.log('✅ Blockchair successful');
        return await this.addPriceData(address, 'Ethereum', balanceEth, 'ETH', 'ethereum');
      }
    } catch (error) {
      console.error('❌ All Ethereum APIs failed');
    }
    
    return null;
  }

  private static async getBitcoinBalanceWithRetry(address: string): Promise<WalletBalance | null> {
    // Try BlockCypher first (very reliable for Bitcoin)
    try {
      console.log('₿ Trying BlockCypher API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get(`https://api.blockcypher.com/v1/btc/main/addrs/${address}/balance`, {
          timeout: 8000
        })
      );
      
      if (balanceResponse.data.balance !== undefined) {
        const balanceSatoshi = balanceResponse.data.balance;
        const balanceBtc = balanceSatoshi / 100000000;
        console.log('✅ BlockCypher successful');
        return await this.addPriceData(address, 'Bitcoin', balanceBtc, 'BTC', 'bitcoin');
      }
    } catch (error) {
      console.warn('⚠️ BlockCypher failed, trying Blockstream...');
    }
    
    // Try Blockstream API
    try {
      console.log('₿ Trying Blockstream API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get(`https://blockstream.info/api/address/${address}`, {
          timeout: 8000
        })
      );
      
      const chainStats = balanceResponse.data.chain_stats;
      if (chainStats) {
        const balanceSatoshi = chainStats.funded_txo_sum - chainStats.spent_txo_sum;
        const balanceBtc = balanceSatoshi / 100000000;
        console.log('✅ Blockstream successful');
        return await this.addPriceData(address, 'Bitcoin', balanceBtc, 'BTC', 'bitcoin');
      }
    } catch (error) {
      console.warn('⚠️ Blockstream failed, trying Blockchair...');
    }
    
    // Fallback to Blockchair
    try {
      console.log('₿ Trying Blockchair API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get(`https://api.blockchair.com/bitcoin/dashboards/address/${address}`, {
          timeout: 10000
        })
      );
      
      if (balanceResponse.data?.data?.[address]) {
        const addressData = balanceResponse.data.data[address].address;
        const balanceSatoshi = addressData.balance;
        const balanceBtc = balanceSatoshi / 100000000;
        console.log('✅ Blockchair successful');
        return await this.addPriceData(address, 'Bitcoin', balanceBtc, 'BTC', 'bitcoin');
      }
    } catch (error) {
      console.error('❌ All Bitcoin APIs failed');
    }
    
    return null;
  }

  private static async getBSCBalanceWithRetry(address: string): Promise<WalletBalance | null> {
    // Try BSCScan API first
    try {
      console.log('🟡 Trying BSCScan API...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.get('https://api.bscscan.com/api', {
          params: {
            module: 'account',
            action: 'balance',
            address: address,
            tag: 'latest'
          },
          timeout: 8000
        })
      );
      
      if (balanceResponse.data.status === '1') {
        const balanceWei = balanceResponse.data.result;
        const balanceBnb = parseFloat(balanceWei) / Math.pow(10, 18);
        console.log('✅ BSCScan successful');
        return await this.addPriceData(address, 'BSC', balanceBnb, 'BNB', 'binancecoin');
      }
    } catch (error) {
      console.warn('⚠️ BSCScan failed, trying direct RPC...');
    }
    
    // Try direct RPC call to BSC node
    try {
      console.log('🟡 Trying BSC RPC...');
      const balanceResponse = await this.rateLimitedRequest(() =>
        axios.post('https://bsc-dataseed1.binance.org', {
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          id: 1
        }, {
          timeout: 8000,
          headers: { 'Content-Type': 'application/json' }
        })
      );
      
      if (balanceResponse.data.result) {
        const balanceWei = parseInt(balanceResponse.data.result, 16);
        const balanceBnb = balanceWei / Math.pow(10, 18);
        console.log('✅ BSC RPC successful');
        return await this.addPriceData(address, 'BSC', balanceBnb, 'BNB', 'binancecoin');
      }
    } catch (error) {
      console.error('❌ All BSC APIs failed');
    }
    
    return null;
  }

  private static async getSolanaBalanceWithRetry(address: string): Promise<WalletBalance | null> {
    const rpcEndpoints = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
      'https://rpc.ankr.com/solana'
    ];
    
    for (let i = 0; i < rpcEndpoints.length; i++) {
      try {
        console.log(`🟣 Trying Solana RPC ${i + 1}...`);
        const response = await this.rateLimitedRequest(() =>
          axios.post(rpcEndpoints[i], {
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [address]
          }, {
            timeout: 8000,
            headers: { 'Content-Type': 'application/json' }
          })
        );
        
        if (!response.data.error && response.data.result) {
          const balanceLamports = response.data.result.value;
          const balanceSol = balanceLamports / Math.pow(10, 9);
          console.log('✅ Solana RPC successful');
          return await this.addPriceData(address, 'Solana', balanceSol, 'SOL', 'solana');
        }
      } catch (error) {
        console.warn(`⚠️ Solana RPC ${i + 1} failed, trying next...`);
        if (i === rpcEndpoints.length - 1) {
          console.error('❌ All Solana RPCs failed');
        }
      }
    }
    
    return null;
  }
  
  private static async addPriceData(
    address: string, 
    network: string, 
    balance: number, 
    symbol: string, 
    coingeckoId: string
  ): Promise<WalletBalance> {
    try {
      const priceResponse = await this.rateLimitedRequest(() =>
        axios.get(`${this.COINGECKO_PRICE_API}?ids=${coingeckoId}&vs_currencies=usd,eur`, {
          timeout: 5000
        })
      );
      
      const priceData = priceResponse.data[coingeckoId];
      return {
        address,
        network,
        balance,
        balanceUsd: balance * priceData.usd,
        balanceEur: balance * priceData.eur,
        symbol
      };
    } catch (error) {
      console.warn('⚠️ Price fetch failed, using 0 prices');
      return {
        address,
        network,
        balance,
        balanceUsd: 0,
        balanceEur: 0,
        symbol
      };
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