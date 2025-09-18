# Meridian Demo Application

This is a Next.js demo application showcasing Meridian payment integration with X402 protocol.

## Prerequisites

Before running this application, you need to set up your Meridian account and obtain API credentials.

### Step 1: Create a Meridian Account

1. Visit [www.mrdn.finance](https://www.mrdn.finance)
2. Connect your wallet to create an account
3. Once your account is created, you'll be able to create your `MERIDIAN_PK` (Public Key) and `MERIDIAN_SK` (Secret Key)

### Step 2: Generate API Key

1. After creating your account, proceed to create an API Key in your Meridian dashboard
2. Copy the generated API key

### Step 3: Configure Environment Variables

1. Create a `.env.local` file in the root directory of this demo application
2. Add your Meridian API key to the file:

```bash
NEXT_PUBLIC_MERIDIAN_PK=pk_...
MERIDIAN_SK=sk_...
```

## Getting Started

Once you have configured your environment variables, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3005](http://localhost:3005) with your browser to see the result.

## Features

This demo application showcases:

- Meridian payment integration
- X402 protocol implementation
- Wallet connection functionality
- Protected routes with payment verification
- Integration with [x402-next](https://www.npmjs.com/package/x402-next)
- Manual DIY x402 Integration

## Learn More

- [Meridian Finance](https://docs.mrdn.finance) - Learn more about Meridian
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
