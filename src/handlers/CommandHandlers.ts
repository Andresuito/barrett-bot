import TelegramBot from 'node-telegram-bot-api';
import { Alert, UpdateInterval, UserSettings, PriceData, CryptoCurrency, Wallet, WalletBalance } from '../interfaces';
import { Alert as AlertModel } from '../models/Alert';
import { Wallet as WalletModel } from '../models/Wallet';
import { PortfolioEntry } from '../models/Portfolio';
import { PriceService, WalletService } from '../services';
import { MessageFormatter } from '../utils';

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
    this.setupWalletCommands();
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
        '/settings \\- Manage everything \\(cryptos\\, frequency\\, currency\\)\n' +
        '/alerts \\- Price alerts\n' +
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
        '*💼 Wallet Commands:*\n' +
        '/addwallet \\[address\\] \\- Add wallet to track \\(e\\.g\\. /addwallet 0x1234\\.\\.\\.\\)\n' +
        '/wallet \\[address\\] \\- Check wallet balance\n' +
        '/wallets \\- List your saved wallets\n\n' +
        '*📈 Portfolio Commands:*\n' +
        '/buy \\[crypto\\] \\[amount\\] \\[price\\] \\- Add purchase \\(e\\.g\\. /buy ETH 0\\.5 3800\\)\n' +
        '/sell \\[crypto\\] \\[amount\\] \\[price\\] \\- Add sale \\(e\\.g\\. /sell ETH 0\\.2 4000\\)\n' +
        '/portfolio \\- View your portfolio with P\\&L\n' +
        '/clearportfolio \\[crypto\\] \\- Clear portfolio entries\n\n' +
        '*🔔 Alerts:*\n' +
        '/alerts \\- Manage price alerts\n' +
        '/setalert \\[crypto\\] \\[price\\] \\- Create alert \\(e\\.g\\. /setalert BTC 50000\\)\n' +
        '/clearalerts \\- Delete all alerts\n\n' +
        '*⚙️ Settings \\& Management:*\n' +
        '/settings \\- All settings \\(currency\\, frequency\\, tracked cryptos\\)\n' +
        '/list \\- Show available cryptocurrencies\n\n' +
        '*🎛️ Controls:*\n' +
        '/start \\- Activate bot\n' +
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
        
        // Check if user has portfolio entries
        const portfolioEntries = await PortfolioEntry.find({ chatId });
        let message = await this.formatPricesMessage(pricesData, chatId);
        
        if (portfolioEntries.length > 0) {
          // Calculate portfolio holdings
          const holdings = new Map<string, { amount: number, totalCost: number, totalReceived: number }>();
          
          for (const entry of portfolioEntries) {
            const current = holdings.get(entry.cryptoId) || { amount: 0, totalCost: 0, totalReceived: 0 };
            
            if (entry.type === 'buy') {
              current.amount += entry.amount;
              current.totalCost += entry.amount * entry.price;
            } else {
              current.amount -= entry.amount;
              current.totalReceived += entry.amount * entry.price;
            }
            
            holdings.set(entry.cryptoId, current);
          }
          
          // Add portfolio summary for tracked cryptos that have holdings
          let portfolioSummary = '\n\n*💼 Your Holdings:*\n';
          let hasHoldings = false;
          const currencySymbol = settings.currency === 'usd' ? '$' : '€';
          
          for (const priceData of pricesData) {
            const crypto = PriceService.findCryptoBySymbol(priceData.symbol);
            if (!crypto) continue;
            
            const holding = holdings.get(crypto.id);
            if (holding && holding.amount > 0.000001) {
              const currentPrice = settings.currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
              const netCost = holding.totalCost - holding.totalReceived;
              const currentValue = holding.amount * currentPrice;
              const unrealizedPL = currentValue - netCost;
              const unrealizedPLPercent = netCost > 0 ? (unrealizedPL / netCost) * 100 : 0;
              
              const plEmoji = unrealizedPL >= 0 ? '📈' : '📉';
              const plSign = unrealizedPL >= 0 ? '+' : '';
              
              portfolioSummary += `${crypto.emoji} ${MessageFormatter.escapeMarkdown(holding.amount.toFixed(6))} ${crypto.symbol} `;
              portfolioSummary += `${plEmoji} ${plSign}${currencySymbol}${MessageFormatter.escapeMarkdown(Math.abs(unrealizedPL).toLocaleString())} \\(${plSign}${MessageFormatter.escapeMarkdown(unrealizedPLPercent.toFixed(1))}%\\)\n`;
              hasHoldings = true;
            }
          }
          
          if (hasHoldings) {
            portfolioSummary += '\n💡 Use `/portfolio` for detailed P\\&L analysis';
            message += portfolioSummary;
          }
        }
        
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
      
      let message = '🪙 *YOUR TRACKED CRYPTOCURRENCIES*\n\n';
      
      if (settings.trackedCryptos.length === 0) {
        message += 'No cryptocurrencies tracked\\.\n\n';
      } else {
        settings.trackedCryptos.forEach((cryptoId, index) => {
          const crypto = PriceService.findCryptoById(cryptoId);
          if (crypto) {
            message += `${index + 1}\\. ${crypto.emoji} ${MessageFormatter.escapeMarkdown(crypto.symbol)} \\- ${MessageFormatter.escapeMarkdown(crypto.name)}\n`;
          }
        });
        message += '\n';
      }
      
      message += '*Commands:*\n';
      message += '/settings \\- Manage tracked cryptocurrencies\n';
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
      
      this.bot.sendMessage(chatId, 
        `✅ *${MessageFormatter.escapeMarkdown(crypto.symbol)}* \\(${MessageFormatter.escapeMarkdown(crypto.name)}\\) added to tracking\\!`, 
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
      
      this.bot.sendMessage(chatId, 
        `🗑️ *${MessageFormatter.escapeMarkdown(crypto.symbol)}* removed from tracking\\.`, 
        { parse_mode: 'MarkdownV2' }
      );
    });

    this.bot.onText(/\/list/, (msg) => {
      const chatId = msg.chat.id;
      
      let message = '📋 *AVAILABLE CRYPTOCURRENCIES*\n\n';
      
      PriceService.SUPPORTED_CRYPTOS.forEach((crypto, index) => {
        message += `${crypto.emoji} ${MessageFormatter.escapeMarkdown(crypto.symbol)} \\- ${MessageFormatter.escapeMarkdown(crypto.name)}\n`;
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
          '/setalert BTC 50000 \\- Alert when BTC reaches $50000\n' +
          '/setalert ETH below 2500 \\- Alert when ETH drops below $2500',
          { parse_mode: 'MarkdownV2' }
        );
      } else {
          let message = '🔔 *YOUR ACTIVE ALERTS*\n\n';
        
        userAlerts.forEach((alert, index) => {
          const status = alert.active ? '✅' : '❌';
          const crypto = PriceService.findCryptoById(alert.cryptoId);
          const cryptoName = crypto ? crypto.symbol : alert.cryptoId.toUpperCase();
          message += `${index + 1}\\. ${status} ${crypto?.emoji || '🪙'} ${cryptoName} ${alert.type === 'above' ? '📈' : '📉'} ${MessageFormatter.escapeMarkdown(alert.price.toLocaleString())}\n`;
        });
        
        message += '\n/delalert \\[number\\] \\- Delete specific alert\n/clearalerts \\- Delete all';
        
        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      }
    });

    this.bot.onText(/\/setalert (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const input = match![1].trim();
      
      const parts = input.split(/\s+/);
      if (parts.length < 2) {
        this.bot.sendMessage(chatId, '❌ Invalid format\\. Examples:\n/setalert BTC 50000\n/setalert ETH below 2500', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const cryptoSymbol = parts[0].toUpperCase();
      const crypto = PriceService.findCryptoBySymbol(cryptoSymbol);
      
      if (!crypto) {
        this.bot.sendMessage(chatId, 
          `❌ Cryptocurrency *${cryptoSymbol}* not found\\.\n\nUse /list to see available cryptocurrencies\\.`, 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      
      const restInput = parts.slice(1).join(' ').toLowerCase();
      let price: number;
      let type: 'above' | 'below' = 'above';
      
      if (restInput.includes('below')) {
        type = 'below';
        price = parseFloat(restInput.replace(/below/g, '').trim());
      } else if (restInput.includes('above')) {
        type = 'above';
        price = parseFloat(restInput.replace(/above/g, '').trim());
      } else {
        price = parseFloat(restInput);
      }
      
      if (isNaN(price) || price <= 0) {
        this.bot.sendMessage(chatId, '❌ Invalid price\\. Examples:\n/setalert BTC 50000\n/setalert ETH below 2500', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const userAlerts = this.alerts.get(chatId) || [];
      
      if (userAlerts.length >= 5) {
        this.bot.sendMessage(chatId, '❌ Maximum 5 alerts allowed\\. Delete some alerts first with /delalert or /clearalerts', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      const newAlert: Alert = { chatId, cryptoId: crypto.id, type, price, active: true };
      userAlerts.push(newAlert);
      this.alerts.set(chatId, userAlerts);
      
      try {
        await AlertModel.create({ chatId, cryptoId: crypto.id, type, price, active: true });
        console.log(`✅ Alert saved: ${chatId}`);
      } catch (error) {
        console.error('❌ Error saving alert to database:', error);
      }
      
      const emoji = type === 'above' ? '📈' : '📉';
      this.bot.sendMessage(chatId, 
        `✅ *Alert created*\n\n${emoji} I'll notify you when *${MessageFormatter.escapeMarkdown(crypto.symbol)}* is *${type === 'above' ? 'above' : 'below'}* *${MessageFormatter.escapeMarkdown(price.toLocaleString())}*`,
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
          cryptoId: alertToDelete.cryptoId,
          active: true 
        });
        console.log(`✅ Alert deleted: ${chatId}`);
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
        console.log(`✅ Alerts cleared: ${chatId}`);
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
            { text: '🪙 Tracked Cryptos', callback_data: 'settings_cryptos' }
          ],
          [
            { text: '🚨 Emergency Alerts', callback_data: 'settings_emergency' }
          ],
          [
            { text: '✅ Done', callback_data: 'settings_done' }
          ]
        ]
      };
      
      const currencySymbol = settings.currency === 'usd' ? '$' : '€';
      
      let trackedCryptosText = '';
      if (settings.trackedCryptos.length > 0) {
        const trackedNames = settings.trackedCryptos.map(cryptoId => {
          const crypto = PriceService.findCryptoById(cryptoId);
          return crypto ? `${crypto.emoji} ${crypto.symbol}` : cryptoId;
        }).join(' ');
        trackedCryptosText = `🪙 *Tracked Cryptos:* ${MessageFormatter.escapeMarkdown(trackedNames)}\n`;
      } else {
        trackedCryptosText = `🪙 *Tracked Cryptos:* None selected\n`;
      }
      
      const emergencyStatus = settings.emergencyAlerts ? `ON \\(${settings.emergencyThreshold}%\\)` : 'OFF';
      
      this.bot.sendMessage(chatId, 
        `⚙️ *USER SETTINGS*\n\n` +
        `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n` +
        `⏰ *Update Frequency:* ${this.getIntervalText(settings.updateInterval)}\n` +
        `🚨 *Emergency Alerts:* ${emergencyStatus}\n` +
        trackedCryptosText + `\n` +
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
      } else if (data?.startsWith('emergency_')) {
        await this.handleEmergencyCallback(callbackQuery);
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
    } else if (setting === 'emergency') {
      await this.showEmergencySettings(chatId, message!.message_id);
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
          { text: '🪙 Tracked Cryptos', callback_data: 'settings_cryptos' }
        ],
        [
          { text: '🚨 Emergency Alerts', callback_data: 'settings_emergency' }
        ],
        [
          { text: '✅ Done', callback_data: 'settings_done' }
        ]
      ]
    };
    
    const currencySymbol = settings.currency === 'usd' ? '$' : '€';
    
    let trackedCryptosText = '';
    if (settings.trackedCryptos.length > 0) {
      const trackedNames = settings.trackedCryptos.map(cryptoId => {
        const crypto = PriceService.findCryptoById(cryptoId);
        return crypto ? `${crypto.emoji} ${crypto.symbol}` : cryptoId;
      }).join(' ');
      trackedCryptosText = `🪙 *Tracked Cryptos:* ${MessageFormatter.escapeMarkdown(trackedNames)}\n`;
    } else {
      trackedCryptosText = `🪙 *Tracked Cryptos:* None selected\n`;
    }
    
    const emergencyStatus = settings.emergencyAlerts ? `ON \\(${settings.emergencyThreshold}%\\)` : 'OFF';
    
    try {
      this.bot.editMessageText(
        `⚙️ *USER SETTINGS*\n\n` +
        `💰 *Currency:* ${currencySymbol} ${settings.currency.toUpperCase()}\n` +
        `⏰ *Update Frequency:* ${this.getIntervalText(settings.updateInterval)}\n` +
        `🚨 *Emergency Alerts:* ${emergencyStatus}\n` +
        trackedCryptosText + `\n` +
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
    
    let message = '🪙 *MANAGE TRACKED CRYPTOS*\n\n';
    
    if (settings.trackedCryptos.length === 0) {
      message += 'No cryptocurrencies tracked\n\n';
    } else {
      message += '*Currently tracking:*\n';
      settings.trackedCryptos.forEach((cryptoId, index) => {
        const crypto = PriceService.findCryptoById(cryptoId);
        if (crypto) {
          message += `${index + 1}\\. ${crypto.emoji} ${MessageFormatter.escapeMarkdown(crypto.symbol)} \\- ${MessageFormatter.escapeMarkdown(crypto.name)}\n`;
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
          row.push({ text: `❌ ${crypto1.emoji} ${crypto1.symbol}`, callback_data: `crypto_remove_${crypto1.id}` });
        }
        if (i + 1 < settings.trackedCryptos.length) {
          const crypto2 = PriceService.findCryptoById(settings.trackedCryptos[i + 1]);
          if (crypto2) {
            row.push({ text: `❌ ${crypto2.emoji} ${crypto2.symbol}`, callback_data: `crypto_remove_${crypto2.id}` });
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
        text: `${crypto?.emoji || ''} ${crypto?.symbol || 'Crypto'} removed` 
      });
      
      await this.showSettingsMenu(chatId, message!.message_id);
    } else if (data === 'crypto_add_menu') {
      await this.showAddCryptoMenu(chatId, message!.message_id);
    } else if (data?.startsWith('crypto_add_')) {
      const cryptoId = data.replace('crypto_add_', '');
      const settings = await this.getUserSettings(chatId);
      const newTrackedCryptos = [...settings.trackedCryptos, cryptoId];
      await this.updateUserSettings(chatId, { trackedCryptos: newTrackedCryptos });
      
      const crypto = PriceService.findCryptoById(cryptoId);
      this.bot.answerCallbackQuery(callbackQuery.id, { 
        text: `${crypto?.emoji || ''} ${crypto?.symbol || 'Crypto'} added` 
      });
      
      await this.showSettingsMenu(chatId, message!.message_id);
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
      row.push({ text: `${availableCryptos[i].emoji} ${availableCryptos[i].symbol}`, callback_data: `crypto_add_${availableCryptos[i].id}` });
      if (i + 1 < availableCryptos.length) {
        row.push({ text: `${availableCryptos[i + 1].emoji} ${availableCryptos[i + 1].symbol}`, callback_data: `crypto_add_${availableCryptos[i + 1].id}` });
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

  private async showEmergencySettings(chatId: number, messageId: number): Promise<void> {
    const settings = await this.getUserSettings(chatId);
    
    let message = '🚨 *EMERGENCY ALERT SETTINGS*\n\n';
    
    if (settings.emergencyAlerts) {
      message += `Status: *ON*\n`;
      message += `Threshold: *${settings.emergencyThreshold}%* drop triggers crash alert\n`;
      message += `Pump Alert: *${Math.round(settings.emergencyThreshold * 1.5)}%* gain triggers pump alert\n`;
      message += `Extreme: *20%* triggers volatility alert\n\n`;
    } else {
      message += `Status: *OFF*\n\n`;
    }
    
    message += '*Emergency alerts notify you when your tracked cryptos experience:*\n';
    message += `💥 Crash: ${settings.emergencyThreshold}%\\+ drop\n`;
    message += `🚀 Pump: ${Math.round(settings.emergencyThreshold * 1.5)}%\\+ gain\n`;
    message += `📈📉 Extreme: 20%\\+ volatility`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: settings.emergencyAlerts ? '❌ Turn OFF' : '✅ Turn ON', 
            callback_data: `emergency_toggle_${settings.emergencyAlerts ? 'off' : 'on'}` }
        ],
        ...(settings.emergencyAlerts ? [
          [
            { text: '📉 5%', callback_data: 'emergency_threshold_5' },
            { text: '📉 10%', callback_data: 'emergency_threshold_10' },
            { text: '📉 15%', callback_data: 'emergency_threshold_15' }
          ],
          [
            { text: '📉 20%', callback_data: 'emergency_threshold_20' },
            { text: '📉 25%', callback_data: 'emergency_threshold_25' }
          ]
        ] : []),
        [
          { text: '← Back', callback_data: 'settings_back' }
        ]
      ]
    };
    
    try {
      this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard
      });
    } catch (error: any) {
      console.error('Error editing emergency settings message:', error);
    }
  }

  private async handleEmergencyCallback(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message!.chat.id;
    
    if (data?.startsWith('emergency_toggle_')) {
      const newState = data.replace('emergency_toggle_', '') === 'on';
      await this.updateUserSettings(chatId, { emergencyAlerts: newState });
      
      this.bot.answerCallbackQuery(callbackQuery.id, { 
        text: `Emergency alerts ${newState ? 'enabled' : 'disabled'}` 
      });
      
      await this.showSettingsMenu(chatId, message!.message_id);
    } else if (data?.startsWith('emergency_threshold_')) {
      const threshold = parseInt(data.replace('emergency_threshold_', ''));
      await this.updateUserSettings(chatId, { emergencyThreshold: threshold });
      
      this.bot.answerCallbackQuery(callbackQuery.id, { 
        text: `Threshold set to ${threshold}%` 
      });
      
      await this.showEmergencySettings(chatId, message!.message_id);
    }
  }

  private setupWalletCommands(): void {
    // Add wallet command with auto-detection
    this.bot.onText(/\/addwallet(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const input = match?.[1]?.trim();

      if (!input) {
        this.bot.sendMessage(chatId, 
          'Please provide a wallet address\\.\n' +
          '*Usage:* `/addwallet [address]`\n' +
          '*Supported:* Bitcoin, Ethereum, BSC, Solana\n\n' +
          '*Examples:*\n' +
          '`/addwallet 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` \\(Bitcoin\\)\n' +
          '`/addwallet 0xB0Aa611f8a76C841B6Df59E41De02cCd5cb97527` \\(Ethereum\\)', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      // Auto-detect network
      const detectedNetwork = WalletService.detectAddressNetwork(input);
      if (!detectedNetwork) {
        this.bot.sendMessage(chatId, 
          '❌ Invalid or unsupported address format\\.\n' +
          '*Supported networks:* Bitcoin, Ethereum, BSC, Solana', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      try {
        const existingWallet = await WalletModel.findOne({ 
          chatId, 
          address: input.toLowerCase(), 
          network: detectedNetwork 
        });
        
        if (existingWallet) {
          this.bot.sendMessage(chatId, '⚠️ This wallet is already added\\!', { parse_mode: 'MarkdownV2' });
          return;
        }

        const wallet = new WalletModel({
          chatId,
          address: input.toLowerCase(),
          network: detectedNetwork
        });

        await wallet.save();
        
        const networkEmoji = this.getNetworkEmoji(detectedNetwork);
        this.bot.sendMessage(chatId, 
          `✅ Wallet added successfully\\!\n` +
          `${networkEmoji} *Network:* ${MessageFormatter.escapeMarkdown(detectedNetwork.toUpperCase())}\n` +
          `📍 *Address:* \`${MessageFormatter.escapeMarkdown(input.slice(0, 12) + '...' + input.slice(-8))}\``, 
          { parse_mode: 'MarkdownV2' }
        );
      } catch (error) {
        console.error('Error adding wallet:', error);
        this.bot.sendMessage(chatId, '❌ Error adding wallet\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    // Check wallet balance command
    this.bot.onText(/\/wallet(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const address = match?.[1]?.trim();

      if (!address) {
        this.bot.sendMessage(chatId, 
          'Please provide a wallet address\\.\n' +
          '*Usage:* `/wallet [address]`\n' +
          '*Supported:* Bitcoin, Ethereum, BSC, Solana', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      // Auto-detect network
      const detectedNetwork = WalletService.detectAddressNetwork(address);
      if (!detectedNetwork) {
        this.bot.sendMessage(chatId, 
          '❌ Invalid or unsupported address format\\.\n' +
          '*Supported networks:* Bitcoin, Ethereum, BSC, Solana', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      const networkEmoji = this.getNetworkEmoji(detectedNetwork);
      const loadingMsg = await this.bot.sendMessage(chatId, 
        `🔍 Checking ${networkEmoji} ${detectedNetwork.toUpperCase()} balance\\.\\.\\.`, 
        { parse_mode: 'MarkdownV2' }
      );

      try {
        const balance = await WalletService.getWalletBalance(address, detectedNetwork);
        
        if (!balance) {
          await this.bot.editMessageText('❌ Unable to fetch wallet balance\\. This could be due to API rate limits\\. Please try again in a few moments\\.', {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'MarkdownV2'
          });
          return;
        }

        const settings = await this.getUserSettings(chatId);
        const currencySymbol = settings.currency === 'usd' ? '$' : '€';
        const fiatValue = settings.currency === 'usd' ? balance.balanceUsd : balance.balanceEur;

        const shortAddress = address.length > 20 ? 
          `${address.slice(0, 8)}...${address.slice(-6)}` : address;

        const message = 
          `💰 *Wallet Balance*\n\n` +
          `${networkEmoji} *Network:* ${MessageFormatter.escapeMarkdown(balance.network)}\\n` +
          `📍 *Address:* \`${MessageFormatter.escapeMarkdown(shortAddress)}\`\\n` +
          `🪙 *Balance:* ${MessageFormatter.escapeMarkdown(balance.balance.toFixed(6))} ${balance.symbol}\\n` +
          `💵 *Value:* ${currencySymbol}${MessageFormatter.escapeMarkdown(fiatValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`;

        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'MarkdownV2'
        });
      } catch (error) {
        console.error('Error fetching wallet balance:', error);
        await this.bot.editMessageText('❌ Error fetching wallet balance\\. Please try again later\\.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'MarkdownV2'
        });
      }
    });

    // List saved wallets command
    this.bot.onText(/\/wallets/, async (msg) => {
      const chatId = msg.chat.id;

      try {
        const wallets = await WalletModel.find({ chatId });

        if (wallets.length === 0) {
          this.bot.sendMessage(chatId, '📪 No wallets added yet\\. Use `/addwallet` to add one\\!', { parse_mode: 'MarkdownV2' });
          return;
        }

        let message = '💼 *Your Wallets*\n\n';
        
        for (const wallet of wallets) {
          const shortAddress = wallet.address.length > 20 ? 
            `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}` : wallet.address;
          const networkEmoji = this.getNetworkEmoji(wallet.network);
          message += `${networkEmoji} ${MessageFormatter.escapeMarkdown(wallet.network.toUpperCase())} \`${MessageFormatter.escapeMarkdown(shortAddress)}\`\\n`;
        }

        message += `\\n💡 Use \`/wallet [address]\` to check balance`;

        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      } catch (error) {
        console.error('Error fetching wallets:', error);
        this.bot.sendMessage(chatId, '❌ Error fetching wallets\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    // Portfolio buy command
    this.bot.onText(/\/buy (\w+) ([0-9.]+) ([0-9.]+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match![1].toUpperCase();
      const amount = parseFloat(match![2]);
      const price = parseFloat(match![3]);

      try {
        const crypto = PriceService.findCryptoBySymbol(symbol);
        if (!crypto) {
          this.bot.sendMessage(chatId, `❌ Cryptocurrency *${MessageFormatter.escapeMarkdown(symbol)}* not found\\. Use \`/list\` to see available cryptos\\.`, { parse_mode: 'MarkdownV2' });
          return;
        }

        if (amount <= 0 || price <= 0) {
          this.bot.sendMessage(chatId, '❌ Amount and price must be positive numbers\\.', { parse_mode: 'MarkdownV2' });
          return;
        }

        const portfolioEntry = new PortfolioEntry({
          chatId,
          cryptoId: crypto.id,
          type: 'buy',
          amount,
          price
        });

        await portfolioEntry.save();

        this.bot.sendMessage(chatId, 
          `✅ *Purchase Added*\n\n` +
          `${crypto.emoji} *${crypto.symbol}:* ${amount} at $${price.toLocaleString()}\n` +
          `💰 *Total Cost:* $${(amount * price).toLocaleString()}\n\n` +
          `Use \`/portfolio\` to view your complete portfolio\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      } catch (error) {
        console.error('Error adding purchase:', error);
        this.bot.sendMessage(chatId, '❌ Error adding purchase\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    // Portfolio sell command
    this.bot.onText(/\/sell (\w+) ([0-9.]+) ([0-9.]+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match![1].toUpperCase();
      const amount = parseFloat(match![2]);
      const price = parseFloat(match![3]);

      try {
        const crypto = PriceService.findCryptoBySymbol(symbol);
        if (!crypto) {
          this.bot.sendMessage(chatId, `❌ Cryptocurrency *${MessageFormatter.escapeMarkdown(symbol)}* not found\\. Use \`/list\` to see available cryptos\\.`, { parse_mode: 'MarkdownV2' });
          return;
        }

        if (amount <= 0 || price <= 0) {
          this.bot.sendMessage(chatId, '❌ Amount and price must be positive numbers\\.', { parse_mode: 'MarkdownV2' });
          return;
        }

        const portfolioEntry = new PortfolioEntry({
          chatId,
          cryptoId: crypto.id,
          type: 'sell',
          amount,
          price
        });

        await portfolioEntry.save();

        this.bot.sendMessage(chatId, 
          `✅ *Sale Added*\n\n` +
          `${crypto.emoji} *${crypto.symbol}:* ${amount} at $${price.toLocaleString()}\n` +
          `💰 *Total Received:* $${(amount * price).toLocaleString()}\n\n` +
          `Use \`/portfolio\` to view your complete portfolio\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      } catch (error) {
        console.error('Error adding sale:', error);
        this.bot.sendMessage(chatId, '❌ Error adding sale\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    // Portfolio view command
    this.bot.onText(/\/portfolio$/, async (msg) => {
      const chatId = msg.chat.id;

      try {
        const entries = await PortfolioEntry.find({ chatId }).sort({ timestamp: -1 });
        
        if (entries.length === 0) {
          this.bot.sendMessage(chatId, 
            '📈 *Your Portfolio*\n\n' +
            '📪 No portfolio entries yet\\.\n\n' +
            '*Get Started:*\n' +
            '• `/buy ETH 0.5 3800` \\- Add a purchase\n' +
            '• `/sell BTC 0.1 65000` \\- Add a sale',
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }

        // Calculate holdings per crypto
        const holdings = new Map<string, { amount: number, totalCost: number, totalReceived: number }>();
        
        for (const entry of entries) {
          const current = holdings.get(entry.cryptoId) || { amount: 0, totalCost: 0, totalReceived: 0 };
          
          if (entry.type === 'buy') {
            current.amount += entry.amount;
            current.totalCost += entry.amount * entry.price;
          } else {
            current.amount -= entry.amount;
            current.totalReceived += entry.amount * entry.price;
          }
          
          holdings.set(entry.cryptoId, current);
        }

        // Get current prices for P&L calculation
        const cryptoIds = Array.from(holdings.keys());
        const pricesData = await this.getCryptoPrices(cryptoIds);
        const settings = await this.getUserSettings(chatId);
        
        let message = '📈 *Your Portfolio*\n\n';
        let totalInvestment = 0;
        let totalCurrentValue = 0;
        let totalRealized = 0;

        for (const [cryptoId, holding] of holdings.entries()) {
          if (holding.amount <= 0.000001 && holding.totalCost === 0) continue; // Skip zero holdings
          
          const crypto = PriceService.findCryptoById(cryptoId);
          const priceData = pricesData.find(p => PriceService.findCryptoBySymbol(p.symbol)?.id === cryptoId);
          
          if (!crypto || !priceData) continue;
          
          const currentPrice = settings.currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
          const currencySymbol = settings.currency === 'usd' ? '$' : '€';
          
          const currentValue = holding.amount * currentPrice;
          const netCost = holding.totalCost - holding.totalReceived;
          const unrealizedPL = currentValue - netCost;
          const unrealizedPLPercent = netCost > 0 ? (unrealizedPL / netCost) * 100 : 0;
          const avgBuyPrice = holding.totalCost > 0 ? holding.totalCost / Math.max(holding.amount + (holding.totalReceived / currentPrice), holding.amount) : 0;
          
          totalInvestment += netCost;
          totalCurrentValue += currentValue;
          totalRealized += holding.totalReceived;
          
          const plEmoji = unrealizedPL >= 0 ? '📈' : '📉';
          const plSign = unrealizedPL >= 0 ? '+' : '';
          
          message += `${crypto.emoji} *${crypto.symbol}*\n`;
          message += `📊 Amount: ${MessageFormatter.escapeMarkdown(holding.amount.toFixed(6))}\n`;
          message += `💰 Avg Price: ${currencySymbol}${MessageFormatter.escapeMarkdown(avgBuyPrice.toFixed(2))}\n`;
          message += `🔥 Current: ${currencySymbol}${MessageFormatter.escapeMarkdown(currentPrice.toLocaleString())}\n`;
          message += `💵 Value: ${currencySymbol}${MessageFormatter.escapeMarkdown(currentValue.toLocaleString())}\n`;
          message += `${plEmoji} P&L: ${plSign}${currencySymbol}${MessageFormatter.escapeMarkdown(Math.abs(unrealizedPL).toLocaleString())} \\(${plSign}${MessageFormatter.escapeMarkdown(unrealizedPLPercent.toFixed(1))}%\\)\n\n`;
        }
        
        // Portfolio summary
        const totalPL = (totalCurrentValue + totalRealized) - totalInvestment;
        const totalPLPercent = totalInvestment > 0 ? (totalPL / totalInvestment) * 100 : 0;
        const plEmoji = totalPL >= 0 ? '🚀' : '💥';
        const plSign = totalPL >= 0 ? '+' : '';
        const currencySymbol = settings.currency === 'usd' ? '$' : '€';
        
        message += '*📊 Portfolio Summary*\n';
        message += `💰 Total Invested: ${currencySymbol}${MessageFormatter.escapeMarkdown(totalInvestment.toLocaleString())}\n`;
        message += `💵 Current Value: ${currencySymbol}${MessageFormatter.escapeMarkdown(totalCurrentValue.toLocaleString())}\n`;
        message += `💸 Total Realized: ${currencySymbol}${MessageFormatter.escapeMarkdown(totalRealized.toLocaleString())}\n`;
        message += `${plEmoji} Total P&L: ${plSign}${currencySymbol}${MessageFormatter.escapeMarkdown(Math.abs(totalPL).toLocaleString())} \\(${plSign}${MessageFormatter.escapeMarkdown(totalPLPercent.toFixed(1))}%\\)`;

        this.bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
      } catch (error) {
        console.error('Error fetching portfolio:', error);
        this.bot.sendMessage(chatId, '❌ Error fetching portfolio\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });

    // Clear portfolio command
    this.bot.onText(/\/clearportfolio(?:\s+(\w+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const symbol = match?.[1]?.toUpperCase();

      try {
        if (symbol) {
          const crypto = PriceService.findCryptoBySymbol(symbol);
          if (!crypto) {
            this.bot.sendMessage(chatId, `❌ Cryptocurrency *${MessageFormatter.escapeMarkdown(symbol)}* not found\\. Use \`/list\` to see available cryptos\\.`, { parse_mode: 'MarkdownV2' });
            return;
          }
          
          const result = await PortfolioEntry.deleteMany({ chatId, cryptoId: crypto.id });
          this.bot.sendMessage(chatId, 
            `✅ Cleared ${result.deletedCount} ${crypto.emoji} *${crypto.symbol}* portfolio entries\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        } else {
          const result = await PortfolioEntry.deleteMany({ chatId });
          this.bot.sendMessage(chatId, 
            `✅ Cleared all portfolio entries \\(${result.deletedCount} entries\\)\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        }
      } catch (error) {
        console.error('Error clearing portfolio:', error);
        this.bot.sendMessage(chatId, '❌ Error clearing portfolio\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
      }
    });
  }

  private getNetworkEmoji(network: string): string {
    switch (network.toLowerCase()) {
      case 'ethereum':
        return '🔷';
      case 'bitcoin':
        return '₿';
      case 'bsc':
        return '🟡';
      case 'solana':
        return '🟣';
      default:
        return '🔗';
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