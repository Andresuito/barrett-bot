import { Alert, PriceData, UserSettings } from '../interfaces';
import { Alert as AlertModel } from '../models/Alert';

export class AlertService {
  static async checkAlerts(
    alerts: Map<number, Alert[]>,
    priceData: PriceData,
    getUserSettings: (chatId: number) => Promise<UserSettings>
  ): Promise<{ chatId: number; message: string; alertIndex: number }[]> {
    const triggeredAlerts: { chatId: number; message: string; alertIndex: number }[] = [];
    
    if (alerts.size === 0) return triggeredAlerts;
    
    console.log(`Checking alerts for price USD: $${priceData.priceUsd.toLocaleString()}, EUR: €${priceData.priceEur.toLocaleString()}`);
    
    for (const [chatId, userAlerts] of alerts.entries()) {
      for (let i = userAlerts.length - 1; i >= 0; i--) {
        const alert = userAlerts[i];
        
        if (!alert.active) continue;
        
        const userSettings = await getUserSettings(chatId);
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
          triggeredAlerts.push({ chatId, message: alertMessage, alertIndex: i });
        }
      }
    }
    
    return triggeredAlerts;
  }

  static async checkCrashAlerts(
    subscribedChats: Set<number>,
    priceData: PriceData,
    lastPriceUsd: number,
    lastPriceEur: number,
    priceHistory: PriceData[],
    getUserSettings: (chatId: number) => Promise<UserSettings>
  ): Promise<{ chatId: number; message: string }[]> {
    if ((lastPriceUsd === 0 && lastPriceEur === 0) || priceHistory.length < 2) return [];
    
    const crashAlerts: { chatId: number; message: string }[] = [];
    
    for (const chatId of subscribedChats) {
      try {
        const userSettings = await getUserSettings(chatId);
        const currency = userSettings.currency;
        const currentPrice = currency === 'usd' ? priceData.priceUsd : priceData.priceEur;
        const lastPrice = currency === 'usd' ? lastPriceUsd : lastPriceEur;
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
          crashAlerts.push({ chatId, message: alertMessage });
        }
      } catch (error) {
        console.error(`Error checking crash alerts for chat ${chatId}:`, error);
      }
    }
    
    return crashAlerts;
  }

  static async deleteTriggeredAlert(alert: Alert): Promise<void> {
    try {
      await AlertModel.deleteOne({ 
        chatId: alert.chatId, 
        type: alert.type, 
        price: alert.price,
        active: true 
      });
      console.log(`✅ Triggered alert deleted from database for chat ${alert.chatId}`);
    } catch (dbError) {
      console.error('❌ Error deleting triggered alert from database:', dbError);
    }
  }
}