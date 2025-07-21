import TelegramBot from 'node-telegram-bot-api';
import { Alert, UpdateInterval, UserSettings, PriceData, CryptoCurrency } from '../interfaces';
import { Alert as AlertModel } from '../models/Alert';
import { PriceService } from '../services';

export class CommandHandlers {
  private bot: TelegramBot;
  private subscribedChats: Set<number>;
  private alerts: Map<number, Alert[]>;
  private getUserSettings: (chatId: number) => Promise<UserSettings>;
  private updateUserSettings: (chatId: number, updates: Partial<UserSettings>) => Promise<void>;
  private formatPricesMessage: (data: PriceData[], chatId: number) => Promise<string>;
  private getCryptoPrices: (cryptoIds: string[]) => Promise<PriceData[]>;

  constructor(
    bot: TelegramBot,
    subscribedChats: Set<number>,
    alerts: Map<number, Alert[]>,
    getUserSettings: (chatId: number) => Promise<UserSettings>,
    updateUserSettings: (chatId: number, updates: Partial<UserSettings>) => Promise<void>,
    formatPricesMessage: (data: PriceData[], chatId: number) => Promise<string>,
    getCryptoPrices: (cryptoIds: string[]) => Promise<PriceData[]>
  ) {
    this.bot = bot;
    this.subscribedChats = subscribedChats;
    this.alerts = alerts;
    this.getUserSettings = getUserSettings;
    this.updateUserSettings = updateUserSettings;
    this.formatPricesMessage = formatPricesMessage;
    this.getCryptoPrices = getCryptoPrices;
  }

  setupCommands(): void {
    this.setupStartCommand();
    this.setupHelpCommand();
    this.setupStopCommand();
    this.setupPriceCommand();
    this.setupCryptoCommands();
    this.setupAlertsCommands();
    this.setupSettingsCommands();
    this.setupCallbackHandlers();
  }

  private setupStartCommand(): void {
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      this.subscribedChats.add(chatId);
      
      const settings = await this.getUserSettings(chatId);
      const interval = this.getIntervalText(settings.updateInterval);
      
      this.bot.sendMessage(chatId, 
        '🚀 *Barrett Crypto Bot Activated\\!*\n\n' +
        `You will receive ${interval.toLowerCase()} updates for your tracked cryptocurrencies\\.\n\n` +
        '*Quick Commands:*\n' +
        '/prices \\- Current prices\n' +
        '/cryptos \\- Manage tracked coins\n' +
        '/alerts \\- Price alerts\n' +
        '/settings \\- Configure bot\n' +
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
        '📖 *BARRETT CRYPTO BOT*\n\n' +
        '*📊 Price Commands:*\n' +
        '/prices \\- Current prices of tracked cryptos\n' +
        '/price \\[symbol\\] \\- Single crypto price \\(e\\.g\\. /price BTC\\)\n\n' +
        '*🪙 Crypto Management:*\n' +
        '/cryptos \\- Manage tracked cryptocurrencies\n' +
        '/add \\[symbol\\] \\- Add crypto to tracking \\(e\\.g\\. /add BTC\\)\n' +
        '/remove \\[symbol\\] \\- Remove crypto from tracking\n' +
        '/list \\- Available cryptocurrencies\n\n' +
        '*🔔 Alerts:*\n' +
        '/alerts \\- Manage price alerts\n' +
        '/setalert \\[symbol\\] \\[price\\] \\- Create alert \\(e\\.g\\. /setalert BTC 50000\\)\n' +
        '/clearalerts \\- Delete all alerts\n\n' +
        '*⚙️ Settings:*\n' +
        '/settings \\- Configure currency\\, interval\\, cryptos\n' +
        '/stop \\- Stop all updates',
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
    this.bot.onText(/\/prices$/, async (msg) => {
      const chatId = msg.chat.id;
      
      try {
        const settings = await this.getUserSettings(chatId);
        const pricesData = await this.getCryptoPrices(settings.trackedCryptos);
        const message = await this.formatPricesMessage(pricesData, chatId);
        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      } catch (error) {
        this.bot.sendMessage(chatId, '❌ Error fetching prices\\. Try again later\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    this.bot.onText(/\/price (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match![1].trim().toUpperCase();
      
      try {
        const crypto = PriceService.findCryptoBySymbol(symbol);
        if (!crypto) {
          this.bot.sendMessage(chatId, 
            `❌ Cryptocurrency *${symbol}* not found\\.\n\nUse /list to see available cryptocurrencies\\.`, 
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
        
        const pricesData = await this.getCryptoPrices([crypto.id]);
        const message = await this.formatPricesMessage(pricesData, chatId);
        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      } catch (error) {
        this.bot.sendMessage(chatId, '❌ Error fetching price\\. Try again later\\.', { parse_mode: 'MarkdownV2' });
      }
    });
  }

  private setupCryptoCommands(): void {
    this.bot.onText(/\/cryptos/, async (msg) => {
      const chatId = msg.chat.id;
      const settings = await this.getUserSettings(chatId);
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      let message = '🪙 *YOUR TRACKED CRYPTOCURRENCIES*\n\n';
      
      if (settings.trackedCryptos.length === 0) {
        message += 'No cryptocurrencies tracked\\.\n\n';
      } else {
        settings.trackedCryptos.forEach((cryptoId, index) => {
          const crypto = PriceService.findCryptoById(cryptoId);
          if (crypto) {
            message += `${index + 1}\\. ${escapeText(crypto.symbol)} \\- ${escapeText(crypto.name)}\n`;
          }
        });
        message += '\n';
      }
      
      message += '*Commands:*\n';
      message += '/add \\[symbol\\] \\- Add cryptocurrency\n';
      message += '/remove \\[symbol\\] \\- Remove cryptocurrency\n';
      message += '/list \\- Show available cryptocurrencies';
      
      this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
    });

    this.bot.onText(/\/add (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match![1].trim().toUpperCase();
      
      const crypto = PriceService.findCryptoBySymbol(symbol);
      if (!crypto) {
        this.bot.sendMessage(chatId, 
          `❌ Cryptocurrency *${symbol}* not found\\.\n\nUse /list to see available cryptocurrencies\\.`, 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      const settings = await this.getUserSettings(chatId);
      
      if (settings.trackedCryptos.includes(crypto.id)) {
        this.bot.sendMessage(chatId, 
          `❌ *${crypto.symbol}* is already being tracked\\.`, 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      if (settings.trackedCryptos.length >= 5) {
        this.bot.sendMessage(chatId, 
          '❌ Maximum 5 cryptocurrencies allowed\\. Remove some first with /remove\\.', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      const newTrackedCryptos = [...settings.trackedCryptos, crypto.id];
      await this.updateUserSettings(chatId, { trackedCryptos: newTrackedCryptos });
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      this.bot.sendMessage(chatId, 
        `✅ *${escapeText(crypto.symbol)}* \\(${escapeText(crypto.name)}\\) added to tracking\\!`, 
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/remove (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match![1].trim().toUpperCase();
      
      const crypto = PriceService.findCryptoBySymbol(symbol);
      if (!crypto) {
        this.bot.sendMessage(chatId, 
          `❌ Cryptocurrency *${symbol}* not found\\.`, 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      const settings = await this.getUserSettings(chatId);
      
      if (!settings.trackedCryptos.includes(crypto.id)) {
        this.bot.sendMessage(chatId, 
          `❌ *${crypto.symbol}* is not being tracked\\.`, 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      const newTrackedCryptos = settings.trackedCryptos.filter(id => id !== crypto.id);
      await this.updateUserSettings(chatId, { trackedCryptos: newTrackedCryptos });
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      this.bot.sendMessage(chatId, 
        `🗑️ *${escapeText(crypto.symbol)}* removed from tracking\\.`, 
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/list/, (msg) => {
      const chatId = msg.chat.id;
      
      const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      let message = '📋 *AVAILABLE CRYPTOCURRENCIES*\n\n';
      
      PriceService.SUPPORTED_CRYPTOS.forEach((crypto, index) => {
        message += `${escapeText(crypto.symbol)} \\- ${escapeText(crypto.name)}\n`;
      });
      
      message += '\n*Usage:* /add \\[SYMBOL\\] to start tracking';
      
      this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
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
      
      const newAlert: Alert = { chatId, cryptoId: 'ethereum', type, price, active: true };
      userAlerts.push(newAlert);
      this.alerts.set(chatId, userAlerts);
      
      try {
        await AlertModel.create({ chatId, cryptoId: 'ethereum', type, price, active: true });
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
    this.bot.onText(/\/interval/, async (msg) => {
      const chatId = msg.chat.id;
      const settings = await this.getUserSettings(chatId);
      
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
        `⚙️ *UPDATE FREQUENCY*\n\nCurrent: *${this.getIntervalText(settings.updateInterval)}*\n\nSelect new frequency:`,
        { parse_mode: 'MarkdownV2', reply_markup: keyboard }
      );
    });

    this.bot.onText(/\/settings/, async (msg) => {
      const chatId = msg.chat.id;
      const settings = await this.getUserSettings(chatId);
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '💰 Currency', callback_data: 'settings_currency' },
            { text: '⏰ Update Frequency', callback_data: 'settings_interval' }
          ],
          [
            { text: '✅ Done', callback_data: 'settings_done' }
          ]
        ]
      };
      
      const currencySymbol = settings.currency === 'usd' ? '$' : '€';
      
      this.bot.sendMessage(chatId, 
        `⚙️ *USER SETTINGS*\n\n` +
        `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n` +
        `⏰ *Update Frequency:* ${this.getIntervalText(settings.updateInterval)}\n\n` +
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
        await this.updateUserSettings(chatId, { updateInterval: newInterval });
        
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
      } else if (data?.startsWith('interval_') && callbackQuery.message?.text?.includes('UPDATE FREQUENCY')) {
        await this.handleIntervalFromSettings(callbackQuery);
      } else if (data?.startsWith('crypto_')) {
        await this.handleCryptoCallback(callbackQuery);
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
    } else if (setting === 'interval') {
      const keyboard = {
        inline_keyboard: [
          [
            { text: '⚡ Every 15min', callback_data: 'interval_15min' },
            { text: '🕐 Every 30min', callback_data: 'interval_30min' }
          ],
          [
            { text: '⏰ Every hour', callback_data: 'interval_1h' },
            { text: '🕑 Every 2 hours', callback_data: 'interval_2h' }
          ],
          [
            { text: '← Back', callback_data: 'settings_back' }
          ]
        ]
      };
      
      this.bot.editMessageText(
        `⏰ *UPDATE FREQUENCY*\n\nChoose how often you want to receive price updates:`,
        {
          chat_id: chatId,
          message_id: message!.message_id,
          parse_mode: 'MarkdownV2',
          reply_markup: keyboard
        }
      );
    } else if (setting === 'cryptos') {
      await this.showCryptoSettings(chatId, message!.message_id);
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
          { text: '💰 Currency', callback_data: 'settings_currency' },
          { text: '⏰ Update Frequency', callback_data: 'settings_interval' }
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
        `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n` +
        `⏰ *Update Frequency:* ${this.getIntervalText(settings.updateInterval)}\n\n` +
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

  private async handleIntervalFromSettings(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message!.chat.id;
    const newInterval = data?.replace('interval_', '') as UpdateInterval;
    
    await this.updateUserSettings(chatId, { updateInterval: newInterval });
    
    this.bot.answerCallbackQuery(callbackQuery.id, { 
      text: `Frequency changed to ${this.getIntervalText(newInterval)}` 
    });
    
    await this.showSettingsMenu(chatId, message!.message_id);
  }

  private async showCryptoSettings(chatId: number, messageId: number): Promise<void> {
    const settings = await this.getUserSettings(chatId);
    const escapeText = (text: string) => text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    
    let message = '🪙 *MANAGE TRACKED CRYPTOS*\n\n';
    
    if (settings.trackedCryptos.length === 0) {
      message += 'No cryptocurrencies tracked\n\n';
    } else {
      message += '*Currently tracking:*\n';
      settings.trackedCryptos.forEach((cryptoId, index) => {
        const crypto = PriceService.findCryptoById(cryptoId);
        if (crypto) {
          message += `${index + 1}\\. ${escapeText(crypto.symbol)} \\- ${escapeText(crypto.name)}\n`;
        }
      });
      message += '\n';
    }
    
    // Available cryptos to add
    const availableCryptos = PriceService.SUPPORTED_CRYPTOS.filter(
      crypto => !settings.trackedCryptos.includes(crypto.id)
    );
    
    const keyboard: any = { inline_keyboard: [] };
    
    // Remove buttons for tracked cryptos
    if (settings.trackedCryptos.length > 0) {
      const removeButtons = [];
      for (let i = 0; i < settings.trackedCryptos.length; i += 2) {
        const row = [];
        const crypto1 = PriceService.findCryptoById(settings.trackedCryptos[i]);
        if (crypto1) {
          row.push({ text: `❌ ${crypto1.symbol}`, callback_data: `crypto_remove_${crypto1.id}` });
        }
        if (i + 1 < settings.trackedCryptos.length) {
          const crypto2 = PriceService.findCryptoById(settings.trackedCryptos[i + 1]);
          if (crypto2) {
            row.push({ text: `❌ ${crypto2.symbol}`, callback_data: `crypto_remove_${crypto2.id}` });
          }
        }
        removeButtons.push(row);
      }
      keyboard.inline_keyboard.push(...removeButtons);
    }
    
    // Add buttons for available cryptos (if not at limit)
    if (settings.trackedCryptos.length < 5 && availableCryptos.length > 0) {
      keyboard.inline_keyboard.push([{ text: '➕ Add Crypto', callback_data: 'crypto_add_menu' }]);
    }
    
    // Back button
    keyboard.inline_keyboard.push([{ text: '← Back', callback_data: 'settings_back' }]);
    
    try {
      this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard
      });
    } catch (error: any) {
      console.error('Error editing crypto settings message:', error);
    }
  }

  private async handleCryptoCallback(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message!.chat.id;
    
    if (data?.startsWith('crypto_remove_')) {
      const cryptoId = data.replace('crypto_remove_', '');
      const settings = await this.getUserSettings(chatId);
      const newTrackedCryptos = settings.trackedCryptos.filter(id => id !== cryptoId);
      await this.updateUserSettings(chatId, { trackedCryptos: newTrackedCryptos });
      
      const crypto = PriceService.findCryptoById(cryptoId);
      this.bot.answerCallbackQuery(callbackQuery.id, { 
        text: `${crypto?.symbol || 'Crypto'} removed` 
      });
      
      await this.showCryptoSettings(chatId, message!.message_id);
    } else if (data === 'crypto_add_menu') {
      await this.showAddCryptoMenu(chatId, message!.message_id);
    } else if (data?.startsWith('crypto_add_')) {
      const cryptoId = data.replace('crypto_add_', '');
      const settings = await this.getUserSettings(chatId);
      const newTrackedCryptos = [...settings.trackedCryptos, cryptoId];
      await this.updateUserSettings(chatId, { trackedCryptos: newTrackedCryptos });
      
      const crypto = PriceService.findCryptoById(cryptoId);
      this.bot.answerCallbackQuery(callbackQuery.id, { 
        text: `${crypto?.symbol || 'Crypto'} added` 
      });
      
      await this.showCryptoSettings(chatId, message!.message_id);
    }
  }

  private async showAddCryptoMenu(chatId: number, messageId: number): Promise<void> {
    const settings = await this.getUserSettings(chatId);
    const availableCryptos = PriceService.SUPPORTED_CRYPTOS.filter(
      crypto => !settings.trackedCryptos.includes(crypto.id)
    );
    
    let message = '➕ *ADD CRYPTOCURRENCY*\n\nSelect a cryptocurrency to add:';
    
    const keyboard: any = { inline_keyboard: [] };
    
    // Add buttons in rows of 2
    for (let i = 0; i < availableCryptos.length; i += 2) {
      const row = [];
      row.push({ text: availableCryptos[i].symbol, callback_data: `crypto_add_${availableCryptos[i].id}` });
      if (i + 1 < availableCryptos.length) {
        row.push({ text: availableCryptos[i + 1].symbol, callback_data: `crypto_add_${availableCryptos[i + 1].id}` });
      }
      keyboard.inline_keyboard.push(row);
    }
    
    // Back button
    keyboard.inline_keyboard.push([{ text: '← Back', callback_data: 'settings_cryptos' }]);
    
    try {
      this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard
      });
    } catch (error: any) {
      console.error('Error editing add crypto menu:', error);
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