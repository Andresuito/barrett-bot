import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { connectToDatabase } from './database';
import { Alert as AlertModel, IAlert } from './models/Alert';
import { UserSettings as UserSettingsModel, IUserSettings } from './models/UserSettings';

dotenv.config();

interface PriceData {
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

interface Alert {
  chatId: number;
  type: 'above' | 'below';
  price: number;
  active: boolean;
}

class EthereumBot {
  private bot: TelegramBot;
  private subscribedChats: Set<number> = new Set();
  private lastPriceUsd: number = 0;
  private lastPriceEur: number = 0;
  private alerts: Map<number, Alert[]> = new Map();
  private userUpdateIntervals: Map<number, '15min' | '30min' | '1h' | '2h'> = new Map();
  private userSettings: Map<number, { currency: 'usd' | 'eur' }> = new Map();
  private priceHistory: PriceData[] = [];
  private scheduledJobs: Map<string, any> = new Map();
  

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.initializeBot();
  }

  private async initializeBot(): Promise<void> {
    try {
      await connectToDatabase();
      await this.loadAlertsFromDatabase();
      await this.loadUserSettingsFromDatabase();
      this.setupCommands();
      this.startPriceUpdates();
    } catch (error) {
      console.error('❌ Error initializing bot:', error);
    }
  }

  private async loadAlertsFromDatabase(): Promise<void> {
    try {
      const alertDocs = await AlertModel.find({ active: true });
      this.alerts.clear();
      
      alertDocs.forEach((alertDoc: IAlert) => {
        const userAlerts = this.alerts.get(alertDoc.chatId) || [];
        userAlerts.push({
          chatId: alertDoc.chatId,
          type: alertDoc.type,
          price: alertDoc.price,
          active: alertDoc.active
        });
        this.alerts.set(alertDoc.chatId, userAlerts);
      });
      
      console.log(`✅ Loaded ${alertDocs.length} alerts from database`);
    } catch (error) {
      console.error('❌ Error loading alerts from database:', error);
    }
  }

  private async loadUserSettingsFromDatabase(): Promise<void> {
    try {
      const settingsDocs = await UserSettingsModel.find({});
      this.userSettings.clear();
      
      settingsDocs.forEach((settingsDoc: IUserSettings) => {
        this.userSettings.set(settingsDoc.chatId, {
          currency: settingsDoc.currency
        });
      });
      
      console.log(`✅ Loaded ${settingsDocs.length} user settings from database`);
    } catch (error) {
      console.error('❌ Error loading user settings from database:', error);
    }
  }

  private async getUserSettings(chatId: number): Promise<{ currency: 'usd' | 'eur' }> {
    let settings = this.userSettings.get(chatId);
    
    if (!settings) {
      // Create default settings for new user
      settings = { currency: 'usd' };
      try {
        await UserSettingsModel.findOneAndUpdate(
          { chatId },
          { chatId, currency: settings.currency },
          { upsert: true, new: true }
        );
        this.userSettings.set(chatId, settings);
        console.log(`✅ Created default settings for chat ${chatId}`);
      } catch (error) {
        console.error('❌ Error creating default user settings:', error);
      }
    }
    
    return settings;
  }

  private async updateUserSettings(chatId: number, updates: Partial<{ currency: 'usd' | 'eur' }>): Promise<void> {
    try {
      const currentSettings = await this.getUserSettings(chatId);
      const newSettings = { ...currentSettings, ...updates };
      
      await UserSettingsModel.findOneAndUpdate(
        { chatId },
        { chatId, ...newSettings },
        { upsert: true, new: true }
      );
      
      this.userSettings.set(chatId, newSettings);
      console.log(`✅ Updated settings for chat ${chatId}:`, updates);
    } catch (error) {
      console.error('❌ Error updating user settings:', error);
    }
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
        '/settings \\- Configure currency\n' +
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
        '/settings \\- Configure currency\n' +
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
        const message = await this.formatPriceMessage(priceData, chatId);
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

    this.bot.onText(/\/setalert (.+)/, async (msg, match) => {
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
      
      // Check if user already has 3 alerts (maximum allowed)
      if (userAlerts.length >= 3) {
        this.bot.sendMessage(chatId, '❌ Maximum 3 alerts allowed\\. Delete some alerts first with /delalert or /clearalerts', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const newAlert: Alert = { chatId, type, price, active: true };
      userAlerts.push(newAlert);
      this.alerts.set(chatId, userAlerts);
      
      try {
        await AlertModel.create({ chatId, type, price, active: true });
        console.log(`✅ Alert saved to database for chat ${chatId}`);
      } catch (error) {
        console.error('❌ Error saving alert to database:', error);
      }
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      const emoji = type === 'above' ? '📈' : '📉';
      this.bot.sendMessage(chatId, 
        `✅ *Alert created*\n\n${emoji} I'll notify you when ETH is *${type === 'above' ? 'above' : 'below'}* *${escapeText(price.toLocaleString())}*`,
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/delalert (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const alertNumber = parseInt(match![1]);
      const userAlerts = this.alerts.get(chatId) || [];
      
      if (isNaN(alertNumber) || alertNumber < 1 || alertNumber > userAlerts.length) {
        this.bot.sendMessage(chatId, '❌ Invalid alert number\\. Use /alerts to see the list\\.', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const alertToDelete = userAlerts[alertNumber - 1];
      userAlerts.splice(alertNumber - 1, 1);
      
      if (userAlerts.length === 0) {
        this.alerts.delete(chatId);
      } else {
        this.alerts.set(chatId, userAlerts);
      }
      
      try {
        await AlertModel.deleteOne({ 
          chatId: alertToDelete.chatId, 
          type: alertToDelete.type, 
          price: alertToDelete.price,
          active: true 
        });
        console.log(`✅ Alert deleted from database for chat ${chatId}`);
      } catch (error) {
        console.error('❌ Error deleting alert from database:', error);
      }
      
      this.bot.sendMessage(chatId, '🗑️ *Alert deleted*', { parse_mode: 'MarkdownV2' });
    });

    this.bot.onText(/\/clearalerts/, async (msg) => {
      const chatId = msg.chat.id;
      this.alerts.delete(chatId);
      
      try {
        await AlertModel.deleteMany({ chatId, active: true });
        console.log(`✅ All alerts deleted from database for chat ${chatId}`);
      } catch (error) {
        console.error('❌ Error clearing alerts from database:', error);
      }
      
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

    this.bot.onText(/\/settings/, async (msg) => {
      const chatId = msg.chat.id;
      const settings = await this.getUserSettings(chatId);
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '💰 Currency', callback_data: 'settings_currency' }
          ],
          [
            { text: '✅ Done', callback_data: 'settings_done' }
          ]
        ]
      };
      
      const currencySymbol = settings.currency === 'usd' ? '$' : '€';
      
      this.bot.sendMessage(chatId, 
        `⚙️ *USER SETTINGS*\n\n` +
        `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n\n` +
        `Select what you want to change:`,
        { parse_mode: 'MarkdownV2', reply_markup: keyboard }
      );
    });

    this.bot.on('callback_query', async (callbackQuery) => {
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
      } else if (data?.startsWith('settings_')) {
        const setting = data.replace('settings_', '');
        
        if (setting === 'currency') {
          const keyboard = {
            inline_keyboard: [
              [
                { text: '🇺🇸 USD ($)', callback_data: 'curr_usd' },
                { text: '🇪🇺 EUR (€)', callback_data: 'curr_eur' }
              ],
              [
                { text: '← Back', callback_data: 'settings_back' }
              ]
            ]
          };
          
          this.bot.editMessageText(
            `💰 *SELECT CURRENCY*\n\nChoose your preferred currency:`,
            {
              chat_id: chatId,
              message_id: message!.message_id,
              parse_mode: 'MarkdownV2',
              reply_markup: keyboard
            }
          );
        } else if (setting === 'done') {
          // Close settings - delete the message
          try {
            await this.bot.deleteMessage(chatId, message!.message_id);
            this.bot.answerCallbackQuery(callbackQuery.id, { 
              text: 'Settings saved!' 
            });
          } catch (error: any) {
            console.error('Error closing settings:', error);
          }
        } else if (setting === 'back') {
          const settings = await this.getUserSettings(chatId);
          const keyboard = {
            inline_keyboard: [
              [
                { text: '💰 Currency', callback_data: 'settings_currency' }
              ],
              [
                { text: '✅ Done', callback_data: 'settings_done' }
              ]
            ]
          };
          
          const currencySymbol = settings.currency === 'usd' ? '$' : '€';
          
          try {
            this.bot.editMessageText(
              `⚙️ *USER SETTINGS*\n\n` +
              `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n\n` +
              `Select what you want to change:`,
              {
                chat_id: chatId,
                message_id: message!.message_id,
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
              }
            );
          } catch (error: any) {
            if (error.code !== 'ETELEGRAM' || !error.response?.body?.description?.includes('message is not modified')) {
              console.error('Error editing settings message:', error);
            }
          }
        }
      } else if (data?.startsWith('curr_')) {
        const currency = data.replace('curr_', '') as 'usd' | 'eur';
        await this.updateUserSettings(chatId, { currency });
        
        this.bot.answerCallbackQuery(callbackQuery.id, { 
          text: `Currency changed to ${currency.toUpperCase()}` 
        });
        
        // Go back to settings menu
        const settings = await this.getUserSettings(chatId);
        const keyboard = {
          inline_keyboard: [
            [
              { text: '💰 Currency', callback_data: 'settings_currency' }
            ],
            [
              { text: '✅ Done', callback_data: 'settings_done' }
            ]
          ]
        };
        
        const currencySymbol = settings.currency === 'usd' ? '$' : '€';
        
        try {
          this.bot.editMessageText(
            `⚙️ *USER SETTINGS*\n\n` +
            `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n\n` +
            `Select what you want to change:`,
            {
              chat_id: chatId,
              message_id: message!.message_id,
              parse_mode: 'MarkdownV2',
              reply_markup: keyboard
            }
          );
        } catch (error: any) {
          if (error.code !== 'ETELEGRAM' || !error.response?.body?.description?.includes('message is not modified')) {
            console.error('Error editing settings message:', error);
          }
        }
      }
    });
  }

  private async getEthereumPrice(): Promise<PriceData> {
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true'
      );

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

  private async formatPriceMessage(data: PriceData, chatId: number): Promise<string> {
    const settings = await this.getUserSettings(chatId);
    const currency = settings.currency;
    
    const price = currency === 'usd' ? data.priceUsd : data.priceEur;
    const change24h = currency === 'usd' ? data.change24hUsd : data.change24hEur;
    const lastPrice = currency === 'usd' ? this.lastPriceUsd : this.lastPriceEur;
    
    const changeEmoji = change24h >= 0 ? '📈' : '📉';
    const changeColor = change24h >= 0 ? '🟢' : '🔴';
    const currencySymbol = currency === 'usd' ? '$' : '€';
    
    let trendEmoji = '➡️';
    if (lastPrice > 0) {
      if (price > lastPrice) trendEmoji = '⬆️';
      else if (price < lastPrice) trendEmoji = '⬇️';
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
    const timeFormatted = escapeMarkdown(data.timestamp.toLocaleTimeString('en-US'));

    const message = 
      `${changeEmoji} *ETHEREUM \\(ETH\\)*\n\n` +
      `💰 *Price:* ${currencySymbol}${priceFormatted}\n\n` +
      `${changeColor} *24h:* ${changeFormatted}%\n\n` +
      `${trendEmoji} *Trend:* ${this.getTrendText(price, lastPrice)}\n\n` +
      `🕐 *Updated:* ${timeFormatted}`;

    if (currency === 'usd') {
      this.lastPriceUsd = price;
    } else {
      this.lastPriceEur = price;
    }
    
    return message;
  }

  private getTrendText(currentPrice: number, lastPrice: number): string {
    if (lastPrice === 0) return 'Initial';
    
    const diff = currentPrice - lastPrice;
    const diffPercent = (diff / lastPrice) * 100;
    
    if (Math.abs(diffPercent) < 0.1) return 'Stable';
    return diff > 0 ? 'Rising' : 'Falling';
  }

  private async checkAlerts(priceData: PriceData): Promise<void> {
    if (this.alerts.size > 0) {
      console.log(`Checking alerts for price USD: $${priceData.priceUsd.toLocaleString()}, EUR: €${priceData.priceEur.toLocaleString()}`);
    }
    
    for (const [chatId, userAlerts] of this.alerts.entries()) {
      for (let i = userAlerts.length - 1; i >= 0; i--) {
        const alert = userAlerts[i];
        
        if (!alert.active) continue;
        
        // Get user settings to determine which price to use
        const userSettings = await this.getUserSettings(chatId);
        const currentPrice = userSettings.currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
        const currencySymbol = userSettings.currency === 'usd' ? '$' : '€';
        
        let shouldTrigger = false;
        let alertMessage = '';
        
        if (alert.type === 'above' && currentPrice >= alert.price) {
          shouldTrigger = true;
          const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
          alertMessage = `🚨 *PRICE ALERT*\n\n📈 ETH is now *above* ${currencySymbol}${escapeText(alert.price.toLocaleString())}\n💰 Current: ${currencySymbol}${escapeText(currentPrice.toLocaleString())}`;
        } else if (alert.type === 'below' && currentPrice <= alert.price) {
          shouldTrigger = true;
          const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
          alertMessage = `🚨 *PRICE ALERT*\n\n📉 ETH is now *below* ${currencySymbol}${escapeText(alert.price.toLocaleString())}\n💰 Current: ${currencySymbol}${escapeText(currentPrice.toLocaleString())}`;
        }
        
        if (shouldTrigger) {
          console.log(`🚨 Alert triggered for chat ${chatId}: ${alert.type} $${alert.price}`);
          try {
            await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
            console.log(`✅ Alert sent successfully to chat ${chatId}`);
            
            // Delete alert from database when triggered
            try {
              await AlertModel.deleteOne({ 
                chatId: alert.chatId, 
                type: alert.type, 
                price: alert.price,
                active: true 
              });
              console.log(`✅ Triggered alert deleted from database for chat ${chatId}`);
            } catch (dbError) {
              console.error('❌ Error deleting triggered alert from database:', dbError);
            }
            
            // Remove from memory
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
    if ((this.lastPriceUsd === 0 && this.lastPriceEur === 0) || this.priceHistory.length < 2) return;
    
    // Send alerts to all subscribed chats with their preferred currency
    for (const chatId of this.subscribedChats) {
      try {
        const userSettings = await this.getUserSettings(chatId);
        const currency = userSettings.currency;
        const currentPrice = currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
        const lastPrice = currency === 'usd' ? this.lastPriceUsd : this.lastPriceEur;
        const change24h = currency === 'usd' ? priceData.change24hUsd : priceData.change24hEur;
        const currencySymbol = currency === 'usd' ? '$' : '€';
        
        if (lastPrice === 0) continue;
        
        const priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;
        const abs24hChange = Math.abs(change24h);
        
        let shouldAlert = false;
        let alertMessage = '';
        
        if (priceChange <= -10) {
          shouldAlert = true;
          alertMessage = `🚨 *CRASH ALERT*\\n\\n💥 ETH dropped *${Math.abs(priceChange).toFixed(2)}%* since last update\\!\\n\\n💰 From: ${currencySymbol}${lastPrice.toLocaleString()}\\n💰 To: ${currencySymbol}${currentPrice.toLocaleString()}\\n\\n📉 24h change: ${change24h.toFixed(2)}%`;
        } else if (priceChange >= 15) {
          shouldAlert = true;
          alertMessage = `🚀 *PUMP ALERT*\\n\\n🚀 ETH pumped *${priceChange.toFixed(2)}%* since last update\\!\\n\\n💰 From: ${currencySymbol}${lastPrice.toLocaleString()}\\n💰 To: ${currencySymbol}${currentPrice.toLocaleString()}\\n\\n📈 24h change: ${change24h.toFixed(2)}%`;
        } else if (abs24hChange >= 20) {
          shouldAlert = true;
          const direction = change24h > 0 ? 'UP' : 'DOWN';
          const emoji = change24h > 0 ? '🚀' : '💥';
          alertMessage = `${emoji} *EXTREME VOLATILITY*\\n\\n⚠️ ETH moved *${abs24hChange.toFixed(2)}%* ${direction} in 24h\\!\\n\\n💰 Current: ${currencySymbol}${currentPrice.toLocaleString()}\\n📊 24h change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`;
        }
        
        if (shouldAlert) {
          await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
        }
      } catch (error) {
        console.error(`Error sending crash alert to chat ${chatId}:`, error);
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
      
      const messages = await Promise.all(
        targetChats.map(async (chatId) => {
          const message = await this.formatPriceMessage(priceData, chatId);
          return { chatId, message };
        })
      );

      for (const { chatId, message } of messages) {
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
      await this.checkAlerts(priceData);
      await this.checkCrashAlerts(priceData);
      this.lastPriceUsd = priceData.priceUsd;
      this.lastPriceEur = priceData.priceEur;
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