import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { connectToDatabase } from './database';
import { Alert as AlertModel, IAlert } from './models/Alert';
import { UserSettings as UserSettingsModel, IUserSettings } from './models/UserSettings';
import { PriceData, Alert, UserSettings, UpdateInterval } from './interfaces';
import { PriceService } from './services';
import { CommandHandlers } from './handlers';
import { MessageFormatter } from './utils';

dotenv.config();

class BarrettBot {
  private bot: TelegramBot;
  private subscribedChats: Set<number> = new Set();
  private alerts: Map<number, Alert[]> = new Map();
  private userSettings: Map<number, UserSettings> = new Map();
  private commandHandlers!: CommandHandlers;
  private scheduledJobs: Map<string, any> = new Map();
  private recentEmergencyAlerts: Map<string, number> = new Map();

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
          cryptoId: alertDoc.cryptoId,
          type: alertDoc.type,
          price: alertDoc.price,
          active: alertDoc.active
        });
        this.alerts.set(alertDoc.chatId, userAlerts);
      });
      
      console.log(`✅ ${alertDocs.length} alerts loaded`);
    } catch (error) {
      console.error('❌ Error loading alerts from database:', error);
    }
  }

  private async loadUserSettingsFromDatabase(): Promise<void> {
    try {
      const settingsDocs = await UserSettingsModel.find({});
      this.userSettings.clear();
      this.subscribedChats.clear();
      
      settingsDocs.forEach((settingsDoc: IUserSettings) => {
        this.userSettings.set(settingsDoc.chatId, {
          currency: settingsDoc.currency,
          trackedCryptos: settingsDoc.trackedCryptos || ['ethereum'],
          updateInterval: settingsDoc.updateInterval || '1h',
          emergencyAlerts: settingsDoc.emergencyAlerts ?? true,
          emergencyThreshold: settingsDoc.emergencyThreshold || 10
        });
        this.subscribedChats.add(settingsDoc.chatId);
      });
      
      console.log(`✅ ${settingsDocs.length} settings loaded, ${this.subscribedChats.size} chats subscribed`);
    } catch (error) {
      console.error('❌ Error loading user settings from database:', error);
    }
  }

  private async getUserSettings(chatId: number): Promise<UserSettings> {
    let settings = this.userSettings.get(chatId);
    
    if (!settings) {

      settings = { 
        currency: 'usd',
        trackedCryptos: ['ethereum'],
        updateInterval: '1h',
        emergencyAlerts: true,
        emergencyThreshold: 10
      };
      try {
        await UserSettingsModel.findOneAndUpdate(
          { chatId },
          { chatId, ...settings },
          { upsert: true, new: true }
        );
        this.userSettings.set(chatId, settings);
        console.log(`✅ Default settings: ${chatId}`);
      } catch (error) {
        console.error('❌ Error creating default user settings:', error);
      }
    }
    
    return settings;
  }

  private async updateUserSettings(chatId: number, updates: Partial<UserSettings>): Promise<void> {
    try {
      const currentSettings = await this.getUserSettings(chatId);
      const newSettings = { ...currentSettings, ...updates };
      
      await UserSettingsModel.findOneAndUpdate(
        { chatId },
        { chatId, ...newSettings },
        { upsert: true, new: true }
      );
      
      this.userSettings.set(chatId, newSettings);
      console.log(`✅ Settings: ${chatId}`);
    } catch (error) {
      console.error('❌ Error updating user settings:', error);
    }
  }

  private setupCommands(): void {
    this.commandHandlers = new CommandHandlers(
      this.bot,
      this.subscribedChats,
      this.alerts,
      this.getUserSettings.bind(this),
      this.updateUserSettings.bind(this),
      this.formatPricesMessage.bind(this),
      this.getCryptoPrices.bind(this)
    );
    this.commandHandlers.setupCommands();
  }

  private async getCryptoPrices(cryptoIds: string[]): Promise<PriceData[]> {
    return PriceService.getCryptoPrices(cryptoIds);
  }

  private async formatPricesMessage(data: PriceData[], chatId: number): Promise<string> {
    const settings = await this.getUserSettings(chatId);
    return MessageFormatter.formatPricesMessage(data, settings);
  }


  private async checkEmergencyAlerts(pricesData: PriceData[]): Promise<void> {
    if (this.subscribedChats.size === 0) return;

    for (const chatId of this.subscribedChats) {
      try {
        const settings = await this.getUserSettings(chatId);
        
        if (!settings.emergencyAlerts) continue;

        for (const priceData of pricesData) {
          const crypto = PriceService.findCryptoBySymbol(priceData.symbol);
          if (!crypto || !settings.trackedCryptos.includes(crypto.id)) continue;

          const change24h = settings.currency === 'usd' ? priceData.change24hUsd : priceData.change24hEur;
          const currencySymbol = settings.currency === 'usd' ? '$' : '€';
          const currentPrice = settings.currency === 'usd' ? priceData.priceUsd : priceData.priceEur;

          // Check for emergency conditions
          let shouldAlert = false;
          let alertType = '';
          let emoji = '';
          
          if (change24h <= -settings.emergencyThreshold) {
            shouldAlert = true;
            alertType = 'CRASH';
            emoji = '💥';
          } else if (change24h >= settings.emergencyThreshold * 1.5) {
            shouldAlert = true;
            alertType = 'PUMP';
            emoji = '🚀';
          } else if (Math.abs(change24h) >= 20) {
            shouldAlert = true;
            alertType = 'EXTREME VOLATILITY';
            emoji = change24h > 0 ? '📈' : '📉';
          }

          if (shouldAlert) {
            const alertKey = `${chatId}-${crypto.id}-${alertType}`;
            const now = Date.now();
            const lastAlert = this.recentEmergencyAlerts.get(alertKey);
            
            if (lastAlert && (now - lastAlert) < 3600000) { 
              continue;
            }
            
            const absChange = Math.abs(change24h).toFixed(1);
            const direction = change24h > 0 ? 'UP' : 'DOWN';
            
            let alertMessage = `🚨 *${alertType} ALERT*\\n\\n${emoji} ${crypto.emoji} *${MessageFormatter.escapeMarkdown(crypto.symbol)}* moved *${absChange}%* ${direction}\\!\\n\\n`;
            alertMessage += `💰 Current: ${currencySymbol}${MessageFormatter.escapeMarkdown(currentPrice.toLocaleString())}\\n`;
            alertMessage += `📊 24h: ${change24h > 0 ? '\\+' : ''}${change24h.toFixed(1)}%`;
            
            try {
              await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
              this.recentEmergencyAlerts.set(alertKey, now);
              console.log(`🚨 Emergency alert: ${crypto.symbol} ${change24h.toFixed(1)}% for ${chatId}`);
            } catch (error) {
              console.error(`Emergency alert error ${chatId}:`, error);
              this.subscribedChats.delete(chatId);
            }
          }
        }
      } catch (error) {
        console.error(`Error checking emergency alerts for ${chatId}:`, error);
      }
    }
  }

  private async checkPriceAlerts(pricesData: PriceData[]): Promise<void> {
    if (this.alerts.size === 0) return;

    for (const [chatId, userAlerts] of this.alerts.entries()) {
      for (let i = userAlerts.length - 1; i >= 0; i--) {
        const alert = userAlerts[i];
        
        if (!alert.active) continue;

        const priceData = pricesData.find(p => {
          const crypto = PriceService.findCryptoBySymbol(p.symbol);
          return crypto?.id === alert.cryptoId;
        });

        if (!priceData) continue;

        try {
          const settings = await this.getUserSettings(chatId);
          const currentPrice = settings.currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
          const currencySymbol = settings.currency === 'usd' ? '$' : '€';
          
          let shouldTrigger = false;
          let alertMessage = '';
          const crypto = PriceService.findCryptoById(alert.cryptoId);
          const cryptoName = crypto ? `${crypto.emoji} ${crypto.symbol}` : alert.cryptoId.toUpperCase();
          
          if (alert.type === 'above' && currentPrice >= alert.price) {
            shouldTrigger = true;
            alertMessage = `🚨 *PRICE ALERT*\\n\\n📈 ${cryptoName} is now *above* ${currencySymbol}${MessageFormatter.escapeMarkdown(alert.price.toLocaleString())}\\n💰 Current: ${currencySymbol}${MessageFormatter.escapeMarkdown(currentPrice.toLocaleString())}`;
          } else if (alert.type === 'below' && currentPrice <= alert.price) {
            shouldTrigger = true;
            alertMessage = `🚨 *PRICE ALERT*\\n\\n📉 ${cryptoName} is now *below* ${currencySymbol}${MessageFormatter.escapeMarkdown(alert.price.toLocaleString())}\\n💰 Current: ${currencySymbol}${MessageFormatter.escapeMarkdown(currentPrice.toLocaleString())}`;
          }
          
          if (shouldTrigger) {
            try {
              await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
              console.log(`🚨 Alert triggered: ${crypto?.symbol || alert.cryptoId} ${alert.type} ${alert.price} for ${chatId}`);
              
              userAlerts.splice(i, 1);
              if (userAlerts.length === 0) {
                this.alerts.delete(chatId);
              } else {
                this.alerts.set(chatId, userAlerts);
              }
              
              await AlertModel.deleteOne({ 
                chatId: alert.chatId, 
                type: alert.type, 
                price: alert.price,
                cryptoId: alert.cryptoId,
                active: true 
              });
            } catch (error) {
              console.error(`Alert send error ${chatId}:`, error);
            }
          }
        } catch (error) {
          console.error(`Error checking alert for chat ${chatId}:`, error);
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
        await this.processPriceUpdate(interval as UpdateInterval);
      });
      
      this.scheduledJobs.set(interval, job);
    });

    cron.schedule('*/5 * * * *', async () => {
      await this.checkForExtremeMovements();
    });

    // Clean up old emergency alert cache every hour
    cron.schedule('0 * * * *', () => {
      const now = Date.now();
      const fourHoursAgo = now - 14400000; // 4 hours
      for (const [key, timestamp] of this.recentEmergencyAlerts.entries()) {
        if (timestamp < fourHoursAgo) {
          this.recentEmergencyAlerts.delete(key);
        }
      }
    });

    console.log('🕐 Schedulers active');
  }

  private async processPriceUpdate(intervalType: UpdateInterval): Promise<void> {
    const targetChats: number[] = [];
    for (const chatId of this.subscribedChats) {
      const settings = await this.getUserSettings(chatId);
      if (settings.updateInterval === intervalType) {
        targetChats.push(chatId);
      }
    }

    if (targetChats.length === 0) return;

    try {
      const allTrackedCryptos = new Set<string>();
      for (const chatId of targetChats) {
        const settings = await this.getUserSettings(chatId);
        settings.trackedCryptos.forEach(crypto => allTrackedCryptos.add(crypto));
      }
      
      for (const userAlerts of this.alerts.values()) {
        userAlerts.forEach(alert => {
          if (alert.active) {
            allTrackedCryptos.add(alert.cryptoId);
          }
        });
      }
      
      const pricesData = await this.getCryptoPrices(Array.from(allTrackedCryptos));
      
      await this.checkEmergencyAlerts(pricesData);
      await this.checkPriceAlerts(pricesData);
      
      const messages = await Promise.all(
        targetChats.map(async (chatId) => {
          const settings = await this.getUserSettings(chatId);
          const userPricesData = pricesData.filter(p => settings.trackedCryptos.includes(PriceService.findCryptoBySymbol(p.symbol)?.id || ''));
          const message = await this.formatPricesMessage(userPricesData, chatId);
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

      console.log(`📊 ${intervalType}: ${targetChats.length} chats`);
    } catch (error) {
      console.error(`Error in ${intervalType} price update:`, error);
    }
  }

  private async checkForExtremeMovements(): Promise<void> {
    try {
      const allCryptoIds = PriceService.SUPPORTED_CRYPTOS.map(c => c.id);
      const pricesData = await this.getCryptoPrices(allCryptoIds);
      await this.checkEmergencyAlerts(pricesData);
    } catch (error) {
      console.error('Movement check error:', error);
    }
  }


  public start(): void {
    console.log('🤖 Barrett Crypto Bot started');
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in environment variables');
  process.exit(1);
}

const barrettBot = new BarrettBot(token);
barrettBot.start();

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});