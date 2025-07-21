import { PriceData, UserSettings } from '../interfaces';

export class MessageFormatter {
  static escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  static async formatPricesMessage(
    dataArray: PriceData[],
    userSettings: UserSettings
  ): Promise<string> {
    if (dataArray.length === 0) {
      return '❌ No price data available\\.';
    }

    const currency = userSettings.currency;
    const currencySymbol = currency === 'usd' ? '$' : '€';
    
    let message = `💰 *CRYPTO PRICES*\n\n`;
    
    for (const data of dataArray) {
      const price = currency === 'usd' ? data.priceUsd : data.priceEur;
      const change24h = currency === 'usd' ? data.change24hUsd : data.change24hEur;
      
      const changeEmoji = change24h >= 0 ? '📈' : '📉';
      const changeColor = change24h >= 0 ? '🟢' : '🔴';
      
      const priceFormatted = this.escapeMarkdown(price.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 8 
      }));
      
      const changeSign = change24h >= 0 ? '\\+' : '';
      const changeFormatted = changeSign + this.escapeMarkdown(change24h.toFixed(2));
      
      message += `${changeEmoji} *${this.escapeMarkdown(data.name)} \\(${this.escapeMarkdown(data.symbol)}\\)*\n`;
      message += `💵 ${currencySymbol}${priceFormatted}\n`;
      message += `${changeColor} ${changeFormatted}% \\(24h\\)\n\n`;
    }
    
    const timeFormatted = this.escapeMarkdown(dataArray[0].timestamp.toLocaleTimeString('en-US'));
    message += `🕐 *Updated:* ${timeFormatted}`;
    
    return message;
  }

}