import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

interface PriceData {
  price: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume24h: number;
  timestamp: Date;
}

interface Alert {
  chatId: number;
  type: 'above' | 'below';
  price: number;
  active: boolean;
}

class EthereumBot {
  private bot: TelegramBot;
  private subscribedChats: Set<number> = new Set();
  private lastPrice: number = 0;
  private alerts: Map<number, Alert[]> = new Map();
  private userUpdateIntervals: Map<number, '15min' | '30min' | '1h' | '2h'> = new Map();
  private priceHistory: PriceData[] = [];
  private scheduledJobs: Map<string, any> = new Map();

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.setupCommands();
    this.startPriceUpdates();
  }

  private setupCommands(): void {
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      this.subscribedChats.add(chatId);
      
      this.bot.sendMessage(chatId, 
        '🚀 *Ethereum Bot Activated\\!*\n\n' +
        'You will receive hourly price updates\\.\n\n' +
        '*Commands:*\n' +
        '/price \\- Current price\n' +
        '/alerts \\- Manage alerts\n' +
        '/setalert \\[price\\] \\- Create alert\n' +
        '/interval \\- Set update frequency\n' +
        '/help \\- All commands\n' +
        '/stop \\- Stop updates',
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      
      this.bot.sendMessage(chatId,
        '📖 *AVAILABLE COMMANDS*\n\n' +
        '/price \\- Current ETH price\n' +
        '/alerts \\- Manage price alerts\n' +
        '/setalert \\[price\\] \\- Create alert\n' +
        '/delalert \\[number\\] \\- Delete specific alert\n' +
        '/clearalerts \\- Delete all alerts\n' +
        '/interval \\- Set update frequency \\(15min/30min/1h/2h\\)\n' +
        '/stop \\- Stop updates',
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/stop/, (msg) => {
      const chatId = msg.chat.id;
      this.subscribedChats.delete(chatId);
      this.alerts.delete(chatId);
      
      this.bot.sendMessage(chatId, '⏹️ Updates and alerts stopped\\. Use /start to reactivate\\.', { parse_mode: 'MarkdownV2' });
    });

    this.bot.onText(/\/price/, async (msg) => {
      const chatId = msg.chat.id;
      
      try {
        const priceData = await this.getEthereumPrice();
        const message = this.formatPriceMessage(priceData);
        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      } catch (error) {
        this.bot.sendMessage(chatId, '❌ Error fetching price\\. Try again later\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    this.bot.onText(/\/alerts/, (msg) => {
      const chatId = msg.chat.id;
      const userAlerts = this.alerts.get(chatId) || [];
      
      if (userAlerts.length === 0) {
        this.bot.sendMessage(chatId, 
          '🔔 *PRICE ALERTS*\n\n' +
          'No active alerts\\.\n\n' +
          '*Create new alert:*\n' +
          '/setalert 3000 \\- Alert when ETH reaches $3000\n' +
          '/setalert below 2500 \\- Alert when drops below $2500',
          { parse_mode: 'MarkdownV2' }
        );
      } else {
        const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        let message = '🔔 *YOUR ACTIVE ALERTS*\n\n';
        
        userAlerts.forEach((alert, index) => {
          const status = alert.active ? '✅' : '❌';
          message += `${index + 1}\\. ${status} ${alert.type === 'above' ? '📈' : '📉'} ${escapeText(alert.price.toLocaleString())}\n`;
        });
        
        message += '\n/delalert \\[number\\] \\- Delete specific alert\n/clearalerts \\- Delete all';
        
        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      }
    });

    this.bot.onText(/\/setalert (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const input = match![1].trim().toLowerCase();
      
      let price: number;
      let type: 'above' | 'below' = 'above';
      
      if (input.includes('below')) {
        type = 'below';
        price = parseFloat(input.replace(/below/g, '').trim());
      } else if (input.includes('above')) {
        type = 'above';
        price = parseFloat(input.replace(/above/g, '').trim());
      } else {
        price = parseFloat(input);
      }
      
      if (isNaN(price) || price <= 0) {
        this.bot.sendMessage(chatId, '❌ Invalid price\\. Examples:\n/setalert 3000\n/setalert below 2500', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const userAlerts = this.alerts.get(chatId) || [];
      const newAlert: Alert = { chatId, type, price, active: true };
      userAlerts.push(newAlert);
      this.alerts.set(chatId, userAlerts);
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      const emoji = type === 'above' ? '📈' : '📉';
      this.bot.sendMessage(chatId, 
        `✅ *Alert created*\n\n${emoji} I'll notify you when ETH is *${type === 'above' ? 'above' : 'below'}* *${escapeText(price.toLocaleString())}*`,
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/delalert (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      const alertNumber = parseInt(match![1]);
      const userAlerts = this.alerts.get(chatId) || [];
      
      if (isNaN(alertNumber) || alertNumber < 1 || alertNumber > userAlerts.length) {
        this.bot.sendMessage(chatId, '❌ Invalid alert number\\. Use /alerts to see the list\\.', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      userAlerts.splice(alertNumber - 1, 1);
      
      if (userAlerts.length === 0) {
        this.alerts.delete(chatId);
      } else {
        this.alerts.set(chatId, userAlerts);
      }
      
      this.bot.sendMessage(chatId, '🗑️ *Alert deleted*', { parse_mode: 'MarkdownV2' });
    });

    this.bot.onText(/\/clearalerts/, (msg) => {
      const chatId = msg.chat.id;
      this.alerts.delete(chatId);
      this.bot.sendMessage(chatId, '🗑️ All alerts deleted\\.', { parse_mode: 'MarkdownV2' });
    });

    this.bot.onText(/\/interval/, (msg) => {
      const chatId = msg.chat.id;
      const currentInterval = this.userUpdateIntervals.get(chatId) || '1h';
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '⚡ Every 15min', callback_data: 'interval_15min' },
            { text: '🕐 Every 30min', callback_data: 'interval_30min' }
          ],
          [
            { text: '⏰ Every hour', callback_data: 'interval_1h' },
            { text: '🕑 Every 2 hours', callback_data: 'interval_2h' }
          ]
        ]
      };
      
      this.bot.sendMessage(chatId, 
        `⚙️ *UPDATE FREQUENCY*\n\nCurrent: *${this.getIntervalText(currentInterval)}*\n\nSelect new frequency:`,
        { parse_mode: 'MarkdownV2', reply_markup: keyboard }
      );
    });

    this.bot.on('callback_query', (callbackQuery) => {
      const message = callbackQuery.message;
      const data = callbackQuery.data;
      const chatId = message!.chat.id;
      
      if (data?.startsWith('interval_')) {
        const newInterval = data.replace('interval_', '') as '15min' | '30min' | '1h' | '2h';
        this.userUpdateIntervals.set(chatId, newInterval);
        
        this.bot.answerCallbackQuery(callbackQuery.id, { 
          text: `Frequency changed to ${this.getIntervalText(newInterval)}` 
        });
        
        this.bot.editMessageText(
          `✅ *Frequency updated*\n\nNew frequency: *${this.getIntervalText(newInterval)}*\n\nYou will now receive updates every ${this.getIntervalText(newInterval).toLowerCase()}\\.`,
          {
            chat_id: chatId,
            message_id: message!.message_id,
            parse_mode: 'MarkdownV2'
          }
        );
      }
    });
  }

  private async getEthereumPrice(): Promise<PriceData> {
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true'
      );

      const ethData = response.data.ethereum;
      
      return {
        price: ethData.usd,
        change24h: ethData.usd_24h_change || 0,
        change7d: ethData.usd_7d_change || 0,
        marketCap: ethData.usd_market_cap || 0,
        volume24h: ethData.usd_24h_vol || 0,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error fetching Ethereum price:', error);
      throw error;
    }
  }

  private formatPriceMessage(data: PriceData): string {
    const { price, change24h, timestamp } = data;
    const changeEmoji = change24h >= 0 ? '📈' : '📉';
    const changeColor = change24h >= 0 ? '🟢' : '🔴';
    
    let trendEmoji = '➡️';
    if (this.lastPrice > 0) {
      if (price > this.lastPrice) trendEmoji = '⬆️';
      else if (price < this.lastPrice) trendEmoji = '⬇️';
    }

    const escapeMarkdown = (text: string) => {
      return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    };
    
    const priceFormatted = escapeMarkdown(price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }));
    
    const changeSign = change24h >= 0 ? '\\+' : '';
    const changeFormatted = changeSign + escapeMarkdown(change24h.toFixed(2));
    const timeFormatted = escapeMarkdown(timestamp.toLocaleTimeString('en-US'));

    const message = 
      `${changeEmoji} *ETHEREUM \\(ETH\\)*\n\n` +
      `💰 *Price:* $${priceFormatted}\n\n` +
      `${changeColor} *24h:* ${changeFormatted}%\n\n` +
      `${trendEmoji} *Trend:* ${this.getTrendText(price)}\n\n` +
      `🕐 *Updated:* ${timeFormatted}`;

    this.lastPrice = price;
    return message;
  }

  private getTrendText(currentPrice: number): string {
    if (this.lastPrice === 0) return 'Initial';
    
    const diff = currentPrice - this.lastPrice;
    const diffPercent = (diff / this.lastPrice) * 100;
    
    if (Math.abs(diffPercent) < 0.1) return 'Stable';
    return diff > 0 ? 'Rising' : 'Falling';
  }

  private async checkAlerts(priceData: PriceData): Promise<void> {
    for (const [chatId, userAlerts] of this.alerts.entries()) {
      for (let i = userAlerts.length - 1; i >= 0; i--) {
        const alert = userAlerts[i];
        
        if (!alert.active) continue;
        
        let shouldTrigger = false;
        let alertMessage = '';
        
        if (alert.type === 'above' && priceData.price >= alert.price) {
          shouldTrigger = true;
          alertMessage = `🚨 *PRICE ALERT*\n\n📈 ETH is now *above* $${alert.price.toLocaleString()}\n💰 Current: $${priceData.price.toLocaleString()}`;
        } else if (alert.type === 'below' && priceData.price <= alert.price) {
          shouldTrigger = true;
          alertMessage = `🚨 *PRICE ALERT*\n\n📉 ETH is now *below* $${alert.price.toLocaleString()}\n💰 Current: $${priceData.price.toLocaleString()}`;
        }
        
        if (shouldTrigger) {
          try {
            await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
            userAlerts.splice(i, 1);
            if (userAlerts.length === 0) {
              this.alerts.delete(chatId);
            } else {
              this.alerts.set(chatId, userAlerts);
            }
          } catch (error) {
            console.error(`Error sending alert to chat ${chatId}:`, error);
            this.subscribedChats.delete(chatId);
            this.alerts.delete(chatId);
          }
        }
      }
    }
  }

  private async checkCrashAlerts(priceData: PriceData): Promise<void> {
    if (this.lastPrice === 0 || this.priceHistory.length < 2) return;
    
    const priceChange = ((priceData.price - this.lastPrice) / this.lastPrice) * 100;
    const abs24hChange = Math.abs(priceData.change24h);
    
    let shouldAlert = false;
    let alertMessage = '';
    
    if (priceChange <= -10) {
      shouldAlert = true;
      alertMessage = `🚨 *CRASH ALERT*\n\n💥 ETH dropped *${Math.abs(priceChange).toFixed(2)}%* since last update\\!\n\n💰 From: $${this.lastPrice.toLocaleString()}\n💰 To: $${priceData.price.toLocaleString()}\n\n📉 24h change: ${priceData.change24h.toFixed(2)}%`;
    } else if (priceChange >= 15) {
      shouldAlert = true;
      alertMessage = `🚀 *PUMP ALERT*\n\n🚀 ETH pumped *${priceChange.toFixed(2)}%* since last update\\!\n\n💰 From: $${this.lastPrice.toLocaleString()}\n💰 To: $${priceData.price.toLocaleString()}\n\n📈 24h change: ${priceData.change24h.toFixed(2)}%`;
    } else if (abs24hChange >= 20) {
      shouldAlert = true;
      const direction = priceData.change24h > 0 ? 'UP' : 'DOWN';
      const emoji = priceData.change24h > 0 ? '🚀' : '💥';
      alertMessage = `${emoji} *EXTREME VOLATILITY*\n\n⚠️ ETH moved *${abs24hChange.toFixed(2)}%* ${direction} in 24h\\!\n\n💰 Current: $${priceData.price.toLocaleString()}\n📊 24h change: ${priceData.change24h > 0 ? '+' : ''}${priceData.change24h.toFixed(2)}%`;
    }
    
    if (shouldAlert) {
      for (const chatId of this.subscribedChats) {
        try {
          await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
        } catch (error) {
          console.error(`Error sending crash alert to chat ${chatId}:`, error);
        }
      }
    }
  }

  private startPriceUpdates(): void {
    const schedules = {
      '15min': '*/15 * * * *',
      '30min': '*/30 * * * *', 
      '1h': '0 * * * *',
      '2h': '0 */2 * * *'
    };

    Object.entries(schedules).forEach(([interval, cronPattern]) => {
      const job = cron.schedule(cronPattern, async () => {
        await this.processPriceUpdate(interval as '15min' | '30min' | '1h' | '2h');
      });
      
      this.scheduledJobs.set(interval, job);
    });

    cron.schedule('*/5 * * * *', async () => {
      await this.checkForExtremeMovements();
    });

    console.log('🕐 Price schedulers started for all intervals');
  }

  private async processPriceUpdate(intervalType: '15min' | '30min' | '1h' | '2h'): Promise<void> {
    const targetChats = Array.from(this.subscribedChats).filter(chatId => {
      const userInterval = this.userUpdateIntervals.get(chatId) || '1h';
      return userInterval === intervalType;
    });

    if (targetChats.length === 0) return;

    try {
      const priceData = await this.getEthereumPrice();
      this.priceHistory.push(priceData);
      
      if (this.priceHistory.length > 50) {
        this.priceHistory = this.priceHistory.slice(-25);
      }
      
      await this.checkAlerts(priceData);
      
      const message = this.formatPriceMessage(priceData);

      for (const chatId of targetChats) {
        try {
          await this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
        } catch (error) {
          console.error(`Error sending to chat ${chatId}:`, error);
          this.subscribedChats.delete(chatId);
        }
      }

      console.log(`${intervalType} price update sent to ${targetChats.length} chats`);
    } catch (error) {
      console.error(`Error in ${intervalType} price update:`, error);
    }
  }

  private async checkForExtremeMovements(): Promise<void> {
    try {
      const priceData = await this.getEthereumPrice();
      await this.checkCrashAlerts(priceData);
      this.lastPrice = priceData.price;
    } catch (error) {
      console.error('Error checking extreme movements:', error);
    }
  }

  private getIntervalText(interval: '15min' | '30min' | '1h' | '2h'): string {
    switch (interval) {
      case '15min': return 'Every 15 minutes';
      case '30min': return 'Every 30 minutes';
      case '1h': return 'Every hour';
      case '2h': return 'Every 2 hours';
      default: return 'Every hour';
    }
  }

  public start(): void {
    console.log('🤖 Ethereum Telegram Bot started');
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in environment variables');
  process.exit(1);
}

const ethBot = new EthereumBot(token);
ethBot.start();

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});