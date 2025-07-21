# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start development server with nodemon (watches for changes)
- `pnpm start` - Run the bot directly with ts-node
- `pnpm build` - Compile TypeScript to JavaScript (outputs to `dist/`)
- `pnpm prod` - Run the compiled JavaScript from `dist/bot.js`

## Project Architecture

This is a modular TypeScript-based Telegram bot that provides Ethereum price tracking and alerts with MongoDB persistence.

### Core Components

- **EthereumBot Class** (`src/bot.ts`): Main bot orchestrator with initialization and scheduling
- **CommandHandlers** (`src/handlers/CommandHandlers.ts`): All bot command implementations
- **Database Models** (`src/models/`): MongoDB schemas for alerts and user settings
- **Services** (`src/services/`): Business logic for price fetching and alert processing
- **Interfaces** (`src/interfaces/`): TypeScript type definitions
- **Utils** (`src/utils/`): Message formatting utilities

### Architecture Pattern

The project follows a clean, modular architecture:
- **Database Layer**: MongoDB with Mongoose for data persistence
- **Service Layer**: PriceService (API calls), AlertService (alert logic)
- **Handler Layer**: CommandHandlers for bot interactions
- **Core Layer**: EthereumBot orchestrates all components

### Key Features

- Real-time Ethereum price tracking with MongoDB persistence
- Customizable update intervals (15min, 30min, 1h, 2h)
- Price alerts (above/below thresholds) with database storage
- Crash detection alerts for extreme price movements
- User settings persistence (currency preferences)
- Multi-currency support (USD/EUR)
- Automatic cleanup of invalid chat IDs

### Dependencies

- `node-telegram-bot-api` - Telegram Bot API wrapper
- `mongoose` - MongoDB object modeling
- `axios` - HTTP client for API calls
- `node-cron` - Scheduled tasks and job management
- `dotenv` - Environment variable management
- `ts-node` & `typescript` - TypeScript runtime and compiler
- `nodemon` - Development file watching

### Environment Setup

Requires environment variables:
- `TELEGRAM_BOT_TOKEN` - Bot token from BotFather
- MongoDB connection string (configured in `src/database.ts`)

### Database Schema

- **Alerts**: chatId, type (above/below), price threshold, active status
- **UserSettings**: chatId, currency preference (usd/eur)

### Bot Commands Structure

Commands are handled in `src/handlers/CommandHandlers.ts`:
- **Core**: `/start`, `/stop`, `/help`
- **Price Info**: `/price`, real-time updates
- **Alerts**: `/setalert`, `/alerts`, `/clearalerts`
- **Settings**: Currency and interval configuration

### Data Flow

1. Bot initializes, connects to MongoDB, loads persisted data
2. Multiple cron jobs run for different update intervals
3. PriceService fetches data from CoinGecko API
4. AlertService checks thresholds and triggers notifications
5. MessageFormatter creates MarkdownV2-formatted responses
6. Invalid chats are automatically cleaned from subscriptions

### Error Handling & Resilience

- Database connection errors with graceful degradation
- API failures with user-friendly error messages
- Automatic chat cleanup for invalid/blocked users
- Process-level handlers for unhandled exceptions
- Job scheduling with error isolation per interval

### Cron Schedule

- Price updates: 15min, 30min, 1h, 2h intervals
- Extreme movement checks: Every 5 minutes
- Users can customize their update frequency