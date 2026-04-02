# Project Plan: Robux Selling Platform

## 📋 Project Goal
Build a modern, secure, full-stack application for Robux sales with Tinkoff integration and automated fulfillment.

## 🛠 Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js
- **Styling**: Tailwind CSS
- **Payments**: Tinkoff Merchant API
- **Verification**: Roblox API (Gamepass & Username check)
- **Fulfillment**: Webhook to n8n automation

## 🏗 Architectural Components
1. **Frontend (Next.js App)**
   - `/`: Landing page + Robux Calculator.
   - `/checkout`: User input, method selection, payment redirect.
   - `/payment/status`: Redirect listener + status polling.
   - `/admin`: Management dashboard.
   
2. **Backend (API Routes)**
   - `POST /api/orders/create`: Order creation & Tinkoff Init.
   - `POST /api/webhooks/tinkoff`: Payment verification.
   - `GET /api/orders/[id]`: Status check for frontend.
   - `POST /api/orders/webhook-to-automation`: Trigger external bots.

3. **External Services**
   - **Roblox API**: Verify gamepass existance and user validity.
   - **Tinkoff API**: Handle RUB payments.
   - **n8n**: Handle fulfillment via automated bots.

## 📅 Roadmap
- **Step 1**: Planning & Database Initialisation (Current).
- **Step 2**: Core UI (Calculator, Grid, Checkout).
- **Step 3**: Tinkoff & Roblox Logic.
- **Step 4**: Automation & Webhooks.
- **Step 5**: Admin Panel & Refinement.

## 🛡 Security Strategy
- Zod schema validation for all API inputs.
- Tinkoff signature verification for webhooks.
- Admin protection via NextAuth session.
- Rate limiting for order creation API.
