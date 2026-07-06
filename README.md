# Meridian x402 Demo

A Next.js reference application showing how to accept [x402](https://docs.mrdn.finance) payments with Meridian — using nothing but [viem](https://viem.sh). No payment SDK is required: the browser signs an EIP-3009 authorization, and your server settles it through Meridian's facilitator API.

## What's inside

| Route | What it shows |
| --- | --- |
| `/protected` | Same-chain x402 payment on **Base Sepolia** (testnet). The server route `/api/protected` returns the 402 challenge, validates the signed payload, and settles server-side. Start here. |
| `/cross-chain` | Cross-chain x402 payment. The seller returns multiple `paymentRequirements` entries (Base, Ink, Optimism as source chains), the buyer pays from whichever chain their wallet is on, and Meridian settles to Base (`extra.destinationChainId = 8453`). |

Both flows follow the same shape:

1. The browser requests the resource and receives `402 Payment Required` with an `accepts` array.
2. The buyer signs an EIP-3009 `transferWithAuthorization` for the selected requirement (an off-chain signature — no gas, no transaction).
3. The server validates the signed payload against its own requirements, then calls Meridian's `POST /v1/settle` with its API key. The key never reaches the browser.

The small protocol helpers live in [`src/lib/x402.ts`](src/lib/x402.ts) — they match the [Manual Integration guide](https://docs.mrdn.finance/api-reference/manual-integration) and are meant to be read and copied.

## Prerequisites

- Node.js 20+
- A wallet extension (MetaMask or similar)
- A Meridian account: visit [www.mrdn.finance](https://www.mrdn.finance), connect your wallet, and create an API key in the dashboard
- For `/protected`: Base Sepolia USDC (available from the [Circle faucet](https://faucet.circle.com))
- For `/cross-chain`: a small USDC balance on Base, Ink, or Optimism mainnet (the demo defaults to $0.01)

## Setup

Install dependencies and configure your environment:

```bash
pnpm install   # or npm / yarn / bun
```

Create `.env.local` in the project root:

```bash
# Required: your Meridian API key (server-side only)
MERIDIAN_API_KEY=pk_test_...

# Optional: override the facilitator endpoint.
# Defaults to https://api.mrdn.finance
# NEXT_PUBLIC_FACILITATOR_URL=https://api.mrdn.finance

# Optional: cross-chain demo price in USDC base units (default 10000 = $0.01)
# CROSS_CHAIN_DEMO_AMOUNT=10000

# Optional: marketplace/platform recipient override for the cross-chain demo.
# Merchants should normally configure the payout recipient in Meridian
# organization settings instead.
# CROSS_CHAIN_CREDITED_RECIPIENT=0x...
```

## Run

```bash
pnpm dev
```

Open [http://localhost:3005](http://localhost:3005), pick a demo, connect your wallet, and pay.

## Project layout

```
src/
  app/
    protected/page.tsx        # Buyer UI: same-chain flow (Base Sepolia)
    api/protected/route.ts    # Seller: 402 challenge + settlement
    cross-chain/page.tsx      # Buyer UI: multi-source-chain flow
    api/cross-chain/route.ts  # Seller: multi-entry accepts + settlement
  lib/
    x402.ts                   # viem-only protocol helpers (types, signing, header codecs)
    protected-demo.ts         # Base Sepolia network + pricing config
    cross-chain-demo.ts       # Source-chain configs (Base, Ink, Optimism)
    cross-chain-requirements.ts  # Builds the seller accepts array
    facilitator-base-url.ts   # Facilitator endpoint resolution
```

## Security notes

- The Meridian API key is only read server-side (`MERIDIAN_API_KEY`). Never expose it with a `NEXT_PUBLIC_` prefix in production.
- The server never trusts buyer-supplied pricing, recipient, network, or token data — it rebuilds the payment requirements on every request and validates the signed payload against them before settling.

## Learn more

- [Meridian documentation](https://docs.mrdn.finance) — quickstart, manual integration, API reference
- [Supported networks](https://docs.mrdn.finance/api-reference/supported-networks)
- [x402 protocol](https://www.x402.org) — the open payment-required standard
