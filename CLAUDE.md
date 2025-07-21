# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start development server with nodemon (watches for changes)
- `pnpm start` - Run the bot directly with ts-node
- `pnpm build` - Compile TypeScript to JavaScript (outputs to `dist/`)
- `pnpm prod` - Run the compiled JavaScript from `dist/bot.js`

## Project Architecture

Barrett is a modular TypeScript-based Telegram bot that provides multi-cryptocurrency price tracking and alerts with MongoDB persistence.

### Core Components

- **BarrettBot Class** (`src/bot.ts`): Main bot orchestrator with initialization and scheduling
- **CommandHandlers** (`src/handlers/CommandHandlers.ts`): All bot command implementations
- **Database Models** (`src/models/`): MongoDB schemas for alerts and user settings
- **Services** (`src/services/`): Business logic for price fetching and alert processing
- **Interfaces** (`src/interfaces/`): TypeScript type definitions
- **Utils** (`src/utils/`): Message formatting utilities

### Architecture Pattern

The project follows a clean, modular architecture:
- **Database Layer**: MongoDB with Mongoose for data persistence
- **Service Layer**: PriceService (multi-crypto API calls), AlertService (alert logic)
- **Handler Layer**: CommandHandlers for bot interactions
- **Core Layer**: BarrettBot orchestrates all components

### Key Features

- **Multi-Cryptocurrency Support**: Track up to 5 cryptocurrencies simultaneously
- **Supported Cryptocurrencies**: ETH, BTC, BNB, ADA, SOL, LINK, MATIC, DOGE, SHIB, AVAX
- **Flexible User Configuration**: Each user can select their own tracked cryptos and update intervals
- **Customizable Update Intervals**: 15min, 30min, 1h, 2h per user
- **Price Alerts**: Multi-crypto alerts (above/below thresholds) with database storage
- **Extreme Movement Detection**: Automatic alerts for 15%+ price movements
- **User Settings Persistence**: Currency preferences, tracked cryptos, update intervals
- **Multi-Currency Support**: USD/EUR with proper formatting
- **Automatic Chat Cleanup**: Invalid chat IDs removed automatically

### Dependencies

- `node-telegram-bot-api` - Telegram Bot API wrapper
- `mongoose` - MongoDB object modeling
- `axios` - HTTP client for CoinGecko API calls
- `node-cron` - Scheduled tasks and job management
- `dotenv` - Environment variable management
- `ts-node` & `typescript` - TypeScript runtime and compiler
- `nodemon` - Development file watching

### Environment Setup

Requires environment variables:
- `TELEGRAM_BOT_TOKEN` - Bot token from BotFather
- MongoDB connection string (configured in `src/database.ts`)

### Database Schema

- **Alerts**: chatId, cryptoId, type (above/below), price threshold, active status
- **UserSettings**: chatId, currency preference (usd/eur), trackedCryptos array, updateInterval

### Bot Commands Structure

Commands are handled in `src/handlers/CommandHandlers.ts`:

**Core Commands:**
- `/start` - Activate bot with personalized setup
- `/stop` - Stop all updates and alerts
- `/help` - Complete command reference

**Price Commands:**
- `/prices` - Show all tracked cryptocurrencies
- `/price [SYMBOL]` - Single cryptocurrency price (e.g., `/price BTC`)

**Crypto Management:**
- `/cryptos` - Manage tracked cryptocurrencies
- `/add [SYMBOL]` - Add crypto to tracking (e.g., `/add BTC`)
- `/remove [SYMBOL]` - Remove crypto from tracking
- `/list` - Show all available cryptocurrencies

**Alert Commands:**
- `/alerts` - View and manage price alerts
- `/setalert [SYMBOL] [PRICE]` - Create price alert
- `/clearalerts` - Delete all alerts

**Settings:**
- `/settings` - Configure currency, interval, and tracked cryptos
- `/interval` - Set update frequency

### Data Flow

1. Bot initializes, connects to MongoDB, loads user settings and alerts
2. Multiple cron jobs run for different update intervals
3. For each interval, determine which users need updates
4. Fetch prices for all unique cryptocurrencies being tracked
5. PriceService fetches batch data from CoinGecko API
6. Check for extreme movements (15%+ changes) across all cryptos
7. Format personalized messages for each user based on their tracked cryptos
8. AlertService checks thresholds and triggers notifications
9. MessageFormatter creates MarkdownV2-formatted responses
10. Invalid chats are automatically cleaned from subscriptions

### Error Handling & Resilience

- Database connection errors with graceful degradation
- API failures with user-friendly error messages
- Automatic chat cleanup for invalid/blocked users
- Process-level handlers for unhandled exceptions
- Job scheduling with error isolation per interval
- Batch API calls to minimize rate limiting

### Cron Schedule

- **Price Updates**: 15min, 30min, 1h, 2h intervals (user-configurable)
- **Extreme Movement Checks**: Every 5 minutes across all supported cryptocurrencies
- **Batch Processing**: Efficient handling of multiple users and cryptocurrencies

### Supported Cryptocurrencies

Barrett supports 10 major cryptocurrencies:
- **ETH** - Ethereum
- **BTC** - Bitcoin  
- **BNB** - BNB
- **ADA** - Cardano
- **SOL** - Solana
- **LINK** - Chainlink
- **MATIC** - Polygon
- **DOGE** - Dogecoin
- **SHIB** - Shiba Inu
- **AVAX** - Avalanche