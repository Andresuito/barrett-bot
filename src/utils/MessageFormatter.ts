import { PriceData, UserSettings } from '../interfaces';

export class MessageFormatter {
  static escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  static async formatPriceMessage(
    data: PriceData,
    userSettings: UserSettings,
    lastPriceUsd: number,
    lastPriceEur: number
  ): Promise<string> {
    const currency = userSettings.currency;
    
    const price = currency === 'usd' ? data.priceUsd : data.priceEur;
    const change24h = currency === 'usd' ? data.change24hUsd : data.change24hEur;
    const lastPrice = currency === 'usd' ? lastPriceUsd : lastPriceEur;
    
    const changeEmoji = change24h >= 0 ? '📈' : '📉';
    const changeColor = change24h >= 0 ? '🟢' : '🔴';
    const currencySymbol = currency === 'usd' ? '$' : '€';
    
    let trendEmoji = '➡️';
    if (lastPrice > 0) {
      if (price > lastPrice) trendEmoji = '⬆️';
      else if (price < lastPrice) trendEmoji = '⬇️';
    }
    
    const priceFormatted = this.escapeMarkdown(price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }));
    
    const changeSign = change24h >= 0 ? '\\+' : '';
    const changeFormatted = changeSign + this.escapeMarkdown(change24h.toFixed(2));
    const timeFormatted = this.escapeMarkdown(data.timestamp.toLocaleTimeString('en-US'));

    const message = 
      `${changeEmoji} *ETHEREUM \\(ETH\\)*\n\n` +
      `💰 *Price:* ${currencySymbol}${priceFormatted}\n\n` +
      `${changeColor} *24h:* ${changeFormatted}%\n\n` +
      `${trendEmoji} *Trend:* ${this.getTrendText(price, lastPrice)}\n\n` +
      `🕐 *Updated:* ${timeFormatted}`;

    return message;
  }

  private static getTrendText(currentPrice: number, lastPrice: number): string {
    if (lastPrice === 0) return 'Initial';
    
    const diff = currentPrice - lastPrice;
    const diffPercent = (diff / lastPrice) * 100;
    
    if (Math.abs(diffPercent) < 0.1) return 'Stable';
    return diff > 0 ? 'Rising' : 'Falling';
  }
}