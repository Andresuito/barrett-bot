import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { connectToDatabase } from './database';
import { Alert as AlertModel, IAlert } from './models/Alert';
import { UserSettings as UserSettingsModel, IUserSettings } from './models/UserSettings';
import { PriceData, Alert, UserSettings, UpdateInterval } from './interfaces';
import { PriceService, AlertService } from './services';
import { CommandHandlers } from './handlers';
import { MessageFormatter } from './utils';

dotenv.config();

class EthereumBot {
  private bot: TelegramBot;
  private subscribedChats: Set<number> = new Set();
  private lastPriceUsd: number = 0;
  private lastPriceEur: number = 0;
  private alerts: Map<number, Alert[]> = new Map();
  private userUpdateIntervals: Map<number, UpdateInterval> = new Map();
  private userSettings: Map<number, UserSettings> = new Map();
  private commandHandlers!: CommandHandlers;
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

  private async getUserSettings(chatId: number): Promise<UserSettings> {
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
      this.userUpdateIntervals,
      this.getUserSettings.bind(this),
      this.updateUserSettings.bind(this),
      this.formatPriceMessage.bind(this),
      this.getEthereumPrice.bind(this)
    );
    this.commandHandlers.setupCommands();
  }

  private async getEthereumPrice(): Promise<PriceData> {
    return PriceService.getEthereumPrice();
  }

  private async formatPriceMessage(data: PriceData, chatId: number): Promise<string> {
    const settings = await this.getUserSettings(chatId);
    const message = await MessageFormatter.formatPriceMessage(
      data,
      settings,
      this.lastPriceUsd,
      this.lastPriceEur
    );
    
    // Update last prices after formatting
    if (settings.currency === 'usd') {
      this.lastPriceUsd = data.priceUsd;
    } else {
      this.lastPriceEur = data.priceEur;
    }
    
    return message;
  }


  private async checkAlerts(priceData: PriceData): Promise<void> {
    const triggeredAlerts = await AlertService.checkAlerts(
      this.alerts,
      priceData,
      this.getUserSettings.bind(this)
    );
    
    for (const { chatId, message, alertIndex } of triggeredAlerts) {
      try {
        await this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
        console.log(`✅ Alert sent successfully to chat ${chatId}`);
        
        const userAlerts = this.alerts.get(chatId)!;
        const alert = userAlerts[alertIndex];
        
        await AlertService.deleteTriggeredAlert(alert);
        
        // Remove from memory
        userAlerts.splice(alertIndex, 1);
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

  private async checkCrashAlerts(priceData: PriceData): Promise<void> {
    const crashAlerts = await AlertService.checkCrashAlerts(
      this.subscribedChats,
      priceData,
      this.lastPriceUsd,
      this.lastPriceEur,
      this.priceHistory,
      this.getUserSettings.bind(this)
    );
    
    for (const { chatId, message } of crashAlerts) {
      try {
        await this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
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