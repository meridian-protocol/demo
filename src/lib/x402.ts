// Minimal x402 protocol helpers built on viem only — no SDK required.
// This mirrors the Manual Integration guide at
// https://docs.mrdn.finance/api-reference/manual-integration: the wire
// format is plain JSON, payments are EIP-3009 transferWithAuthorization
// signatures, and headers are base64-encoded JSON.

import { getAddress, toHex, type Hex, type WalletClient } from "viem";

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: {
    // EIP-712 domain of the token contract.
    name?: string;
    version?: string;
    // Cross-chain settlement target (see docs: Payment Types).
    destinationChainId?: number;
    // Optional marketplace/platform payout override.
    creditedRecipient?: string;
    // Solana requirements additionally carry the facilitator's on-chain
    // settlement config (feePayer, programId, configPda, usdcMint, ...);
    // see src/lib/solana-x402.ts.
    [key: string]: unknown;
  };
}

export interface ExactEvmAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: ExactEvmAuthorization;
  };
}

export interface SettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function safeBase64Encode(data: string): string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(data);
  }
  return Buffer.from(data).toString("base64");
}

export function safeBase64Decode(data: string): string {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(data);
  }
  return Buffer.from(data, "base64").toString("utf-8");
}

// Converts bigint values to strings so payloads survive JSON.stringify.
export function toJsonSafe<T extends object>(data: T): object {
  function convert(value: unknown): unknown {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, convert(val)]),
      );
    }
    if (Array.isArray(value)) {
      return value.map(convert);
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  }

  return convert(data) as object;
}

// ---------------------------------------------------------------------------
// Buyer (browser) helpers
// ---------------------------------------------------------------------------

const REQUIRED_REQUIREMENT_FIELDS = [
  "scheme",
  "network",
  "maxAmountRequired",
  "resource",
  "payTo",
  "asset",
] as const;

// Light structural validation of a seller `accepts` entry.
export function parsePaymentRequirements(entry: unknown): PaymentRequirements {
  if (entry === null || typeof entry !== "object") {
    throw new Error("Payment requirement must be an object");
  }

  const record = entry as Record<string, unknown>;
  for (const field of REQUIRED_REQUIREMENT_FIELDS) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new Error(`Payment requirement is missing "${field}"`);
    }
  }

  return entry as PaymentRequirements;
}

// Picks the `accepts` entry matching the buyer's network and scheme.
export function selectPaymentRequirements(
  paymentRequirements: PaymentRequirements[],
  network: string,
  scheme = "exact",
): PaymentRequirements | undefined {
  return paymentRequirements.find(
    (requirement) =>
      requirement.scheme === scheme && requirement.network === network,
  );
}

function createNonce(): Hex {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Signs an EIP-3009 transferWithAuthorization for the selected requirement
// and encodes it into the base64 `X-PAYMENT` header value.
export async function createPaymentHeader(
  client: WalletClient,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  chainId: number,
): Promise<string> {
  const account = client.account;
  if (!account) {
    throw new Error("Wallet client has no connected account");
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization: ExactEvmAuthorization = {
    from: account.address,
    to: paymentRequirements.payTo,
    value: paymentRequirements.maxAmountRequired,
    validAfter: String(now - 600), // allow modest clock drift
    validBefore: String(now + paymentRequirements.maxTimeoutSeconds),
    nonce: createNonce(),
  };

  const signature = await client.signTypedData({
    account,
    types: authorizationTypes,
    domain: {
      name: paymentRequirements.extra?.name,
      version: paymentRequirements.extra?.version,
      chainId,
      verifyingContract: getAddress(paymentRequirements.asset),
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
  });

  const paymentPayload: PaymentPayload = {
    x402Version,
    scheme: paymentRequirements.scheme,
    network: paymentRequirements.network,
    payload: { signature, authorization },
  };

  return safeBase64Encode(JSON.stringify(paymentPayload));
}

// ---------------------------------------------------------------------------
// Seller (server) helpers
// ---------------------------------------------------------------------------

// Decodes the `X-PAYMENT` header into an EIP-3009 payment payload.
export function decodePayment(paymentHeader: string): PaymentPayload {
  let parsed: PaymentPayload;
  try {
    parsed = JSON.parse(safeBase64Decode(paymentHeader)) as PaymentPayload;
  } catch {
    throw new Error("X-PAYMENT header is not valid base64-encoded JSON");
  }

  const authorization = parsed?.payload?.authorization;
  if (
    typeof parsed?.scheme !== "string" ||
    typeof parsed?.network !== "string" ||
    typeof parsed?.payload?.signature !== "string" ||
    typeof authorization?.from !== "string" ||
    typeof authorization?.to !== "string" ||
    typeof authorization?.value !== "string" ||
    typeof authorization?.validAfter !== "string" ||
    typeof authorization?.validBefore !== "string" ||
    typeof authorization?.nonce !== "string"
  ) {
    throw new Error("X-PAYMENT header is not an EIP-3009 payment payload");
  }

  return parsed;
}

export function findMatchingPaymentRequirements(
  paymentRequirements: PaymentRequirements[],
  payment: PaymentPayload,
): PaymentRequirements | undefined {
  return paymentRequirements.find(
    (requirement) =>
      requirement.scheme === payment.scheme &&
      requirement.network === payment.network,
  );
}
