# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Telegram Bot**: node-telegram-bot-api (polling mode)

## Features

### Telegram Bot (`@workspace/api-server` + `artifacts/api-server/src/bot/`)
A Telegram bot for selling Telegram Stars (⭐) with:
- **Channel subscription verification** — users must subscribe to a configured channel before using the bot
- **Main menu**: ⭐ Купити Зірки, 💬 Відгуки, 🛟 Служба Підтримки
- **Star packages**: 50/100/200/500 stars with fixed UAH prices + custom amount input
- **Order flow**: Creates unique order (ORD-YYMMDD-XXXX), shows card number from settings, asks for payment proof
- **Proof handling**: Users send screenshot → bot saves it + notifies admin chat with inline buttons
- **Admin Telegram buttons**: ✅ Виконано / ❌ Скасувати — sends notification to buyer
- **Support**: @obnali4it, @donnyadm

### Admin Panel (`artifacts/admin-panel`)
React + Vite web dashboard at `/admin-panel/`:
- **Login**: Password-protected (default: `admin123`, set `ADMIN_SECRET` env var to change)
- **Dashboard stats**: Total/pending/proof/completed orders + user count
- **Orders table**: Filter by status, view order details with proof status, update status, add notes
- **Settings page**: Configure card number, verification channel, reviews channel, admin chat ID

### API Routes (`artifacts/api-server/src/routes/admin.ts`)
- `GET /api/admin/orders` — list all orders
- `GET /api/admin/orders/:id` — get single order
- `PATCH /api/admin/orders/:id` — update order status/note
- `GET /api/admin/stats` — dashboard statistics
- `GET /api/admin/settings` — bot settings
- `PUT /api/admin/settings` — update bot settings

All admin routes require `x-admin-secret` header.

## Database Schema (`lib/db/src/schema/`)

### `orders`
- orderNumber (unique, ORD-YYMMDD-XXXX)
- telegramUserId, telegramUsername, telegramFirstName
- starsAmount, priceUah
- status: pending | proof_submitted | completed | cancelled
- proofFileId, proofCaption, adminNote

### `users`
- telegramUserId (unique), username, firstName, lastName, isVerified

### `settings`
- key/value store: card_number, verification_channel, reviews_channel, admin_chat_id

## Configuration (via Admin Panel Settings or DB)

| Key | Description |
|-----|-------------|
| `card_number` | Card number shown to buyers |
| `verification_channel` | Telegram channel users must follow (e.g. `@mychannel`) |
| `reviews_channel` | Link to reviews channel |
| `admin_chat_id` | Telegram chat ID for admin notifications |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ADMIN_SECRET` | Admin panel password (default: `admin123`) |
| `DATABASE_URL` | PostgreSQL connection string (auto-provided) |

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server + Telegram bot
│   │   └── src/bot/        # Bot logic
│   └── admin-panel/        # React admin dashboard
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
└── scripts/
```
