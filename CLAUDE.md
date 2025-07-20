# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start development server with nodemon (watches for changes)
- `pnpm start` - Run the bot directly with ts-node
- `pnpm build` - Compile TypeScript to JavaScript (outputs to `dist/`)
- `pnpm prod` - Run the compiled JavaScript from `dist/bot.js`

## Project Architecture

This is a TypeScript-based Telegram bot that provides Ethereum price tracking and alerts. The bot is implemented as a single class `EthereumBot` in `src/bot.ts`.

### Core Components

- **EthereumBot Class**: Main bot implementation with command handlers and price monitoring
- **Price Data Management**: Fetches from CoinGecko API, stores historical data in memory
- **Alert System**: User-configurable price alerts with threshold notifications
- **Subscription System**: Users can subscribe/unsubscribe to automated updates
- **Cron Scheduling**: Automated price updates using node-cron

### Key Features

- Real-time Ethereum price tracking
- Customizable update intervals (15min, 30min, hourly)
- Price alerts (above/below thresholds)
- Portfolio calculations
- Price predictions based on historical trends
- Detailed market statistics
- Multi-language support (Spanish)

### Dependencies

- `node-telegram-bot-api` - Telegram Bot API wrapper
- `axios` - HTTP client for API calls
- `node-cron` - Scheduled tasks
- `dotenv` - Environment variable management

### Environment Setup

Requires `TELEGRAM_BOT_TOKEN` in `.env` file (not committed to repo).

### Bot Commands Architecture

Commands are organized into categories:
- Price information: `/price`, `/stats`, `/history`
- Alerts: `/alerts`, `/setalert`, `/clearalerts`
- Tools: `/portfolio`, `/convert`, `/prediction`
- Configuration: `/interval`, `/status`, `/start`, `/stop`

### Data Flow

1. Bot fetches price data from CoinGecko API
2. Data is formatted and stored in memory (`priceHistory`)
3. Scheduled updates broadcast to subscribed chats
4. Alert system checks thresholds and notifies users
5. All messages use MarkdownV2 formatting for Telegram

### Error Handling

- API failures are caught and user-friendly messages sent
- Invalid chat IDs are automatically removed from subscriptions
- Process-level error handlers for unhandled rejections/exceptions