import TelegramBot from 'node-telegram-bot-api';
import { Alert, UpdateInterval, UserSettings } from '../interfaces';
import { Alert as AlertModel } from '../models/Alert';

export class CommandHandlers {
  private bot: TelegramBot;
  private subscribedChats: Set<number>;
  private alerts: Map<number, Alert[]>;
  private userUpdateIntervals: Map<number, UpdateInterval>;
  private getUserSettings: (chatId: number) => Promise<UserSettings>;
  private updateUserSettings: (chatId: number, updates: Partial<UserSettings>) => Promise<void>;
  private formatPriceMessage: (data: any, chatId: number) => Promise<string>;
  private getEthereumPrice: () => Promise<any>;

  constructor(
    bot: TelegramBot,
    subscribedChats: Set<number>,
    alerts: Map<number, Alert[]>,
    userUpdateIntervals: Map<number, UpdateInterval>,
    getUserSettings: (chatId: number) => Promise<UserSettings>,
    updateUserSettings: (chatId: number, updates: Partial<UserSettings>) => Promise<void>,
    formatPriceMessage: (data: any, chatId: number) => Promise<string>,
    getEthereumPrice: () => Promise<any>
  ) {
    this.bot = bot;
    this.subscribedChats = subscribedChats;
    this.alerts = alerts;
    this.userUpdateIntervals = userUpdateIntervals;
    this.getUserSettings = getUserSettings;
    this.updateUserSettings = updateUserSettings;
    this.formatPriceMessage = formatPriceMessage;
    this.getEthereumPrice = getEthereumPrice;
  }

  setupCommands(): void {
    this.setupStartCommand();
    this.setupHelpCommand();
    this.setupStopCommand();
    this.setupPriceCommand();
    this.setupAlertsCommands();
    this.setupSettingsCommands();
    this.setupCallbackHandlers();
  }

  private setupStartCommand(): void {
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
  }

  private setupHelpCommand(): void {
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
  }

  private setupStopCommand(): void {
    this.bot.onText(/\/stop/, (msg) => {
      const chatId = msg.chat.id;
      this.subscribedChats.delete(chatId);
      this.alerts.delete(chatId);
      
      this.bot.sendMessage(chatId, '⏹️ Updates and alerts stopped\\. Use /start to reactivate\\.', { parse_mode: 'MarkdownV2' });
    });
  }

  private setupPriceCommand(): void {
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
  }

  private setupAlertsCommands(): void {
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
  }

  private setupSettingsCommands(): void {
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
  }

  private setupCallbackHandlers(): void {
    this.bot.on('callback_query', async (callbackQuery) => {
      const message = callbackQuery.message;
      const data = callbackQuery.data;
      const chatId = message!.chat.id;
      
      if (data?.startsWith('interval_')) {
        const newInterval = data.replace('interval_', '') as UpdateInterval;
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
        await this.handleSettingsCallback(callbackQuery);
      } else if (data?.startsWith('curr_')) {
        await this.handleCurrencyCallback(callbackQuery);
      }
    });
  }

  private async handleSettingsCallback(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message!.chat.id;
    const setting = data?.replace('settings_', '');
    
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
      try {
        await this.bot.deleteMessage(chatId, message!.message_id);
        this.bot.answerCallbackQuery(callbackQuery.id, { 
          text: 'Settings saved!' 
        });
      } catch (error: any) {
        console.error('Error closing settings:', error);
      }
    } else if (setting === 'back') {
      await this.showSettingsMenu(chatId, message!.message_id);
    }
  }

  private async handleCurrencyCallback(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message!.chat.id;
    const currency = data?.replace('curr_', '') as 'usd' | 'eur';
    
    await this.updateUserSettings(chatId, { currency });
    
    this.bot.answerCallbackQuery(callbackQuery.id, { 
      text: `Currency changed to ${currency.toUpperCase()}` 
    });
    
    await this.showSettingsMenu(chatId, message!.message_id);
  }

  private async showSettingsMenu(chatId: number, messageId: number): Promise<void> {
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
          message_id: messageId,
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

  private getIntervalText(interval: UpdateInterval): string {
    switch (interval) {
      case '15min': return 'Every 15 minutes';
      case '30min': return 'Every 30 minutes';
      case '1h': return 'Every hour';
      case '2h': return 'Every 2 hours';
      default: return 'Every hour';
    }
  }
}