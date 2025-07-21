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
  private priceHistory: Map<string, PriceData[]> = new Map();
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
          cryptoId: alertDoc.cryptoId,
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
          currency: settingsDoc.currency,
          trackedCryptos: settingsDoc.trackedCryptos || ['ethereum'],
          updateInterval: settingsDoc.updateInterval || '1h'
        });
      });
      
      console.log(`✅ Loaded ${settingsDocs.length} user settings from database`);
    } catch (error) {
      console.error('❌ Error loading user settings from database:', error);
    }
  }

  private async getUserSettings(chatId: number): Promise<UserSettings> {
    let settings = this.userSettings.get(chatId);
    
    if (!settings) {
      // Create default settings for new user
      settings = { 
        currency: 'usd',
        trackedCryptos: ['ethereum'],
        updateInterval: '1h'
      };
      try {
        await UserSettingsModel.findOneAndUpdate(
          { chatId },
          { chatId, ...settings },
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
      console.log(`✅ Updated settings for chat ${chatId}:`, updates);
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


  private async checkCrashAlerts(pricesData: PriceData[]): Promise<void> {
    // Simplified crash alert system - can be enhanced later
    for (const priceData of pricesData) {
      if (Math.abs(priceData.change24hUsd) > 15) { // Alert on 15%+ moves
        const alertMessage = `🚨 *EXTREME MOVEMENT ALERT*\n\n${priceData.name} \\(${priceData.symbol}\\) moved ${priceData.change24hUsd > 0 ? '📈' : '📉'} ${Math.abs(priceData.change24hUsd).toFixed(2)}% in 24h\\!`;
        
        for (const chatId of this.subscribedChats) {
          try {
            await this.bot.sendMessage(chatId, alertMessage, { parse_mode: 'MarkdownV2' });
          } catch (error) {
            console.error(`Error sending crash alert to chat ${chatId}:`, error);
          }
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

    console.log('🕐 Price schedulers started for all intervals');
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
      // Get all unique cryptos for target chats
      const allTrackedCryptos = new Set<string>();
      for (const chatId of targetChats) {
        const settings = await this.getUserSettings(chatId);
        settings.trackedCryptos.forEach(crypto => allTrackedCryptos.add(crypto));
      }
      
      const pricesData = await this.getCryptoPrices(Array.from(allTrackedCryptos));
      
      // Store price history for each crypto
      pricesData.forEach(priceData => {
        if (!this.priceHistory.has(priceData.symbol)) {
          this.priceHistory.set(priceData.symbol, []);
        }
        const history = this.priceHistory.get(priceData.symbol)!;
        history.push(priceData);
        if (history.length > 50) {
          this.priceHistory.set(priceData.symbol, history.slice(-25));
        }
      });
      
      // Check for extreme movements
      await this.checkCrashAlerts(pricesData);
      
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

      console.log(`${intervalType} price update sent to ${targetChats.length} chats`);
    } catch (error) {
      console.error(`Error in ${intervalType} price update:`, error);
    }
  }

  private async checkForExtremeMovements(): Promise<void> {
    try {
      // Get prices for all supported cryptocurrencies for extreme movement detection
      const allCryptoIds = PriceService.SUPPORTED_CRYPTOS.map(c => c.id);
      const pricesData = await this.getCryptoPrices(allCryptoIds);
      await this.checkCrashAlerts(pricesData);
    } catch (error) {
      console.error('Error checking extreme movements:', error);
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