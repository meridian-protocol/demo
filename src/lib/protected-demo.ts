// Same-chain x402 reference config, mirroring the Quickstart docs.
// Base Sepolia values from docs/api-reference/supported-networks.mdx.
export const NETWORK = {
  id: "base-sepolia",
  chainId: 84532,
  name: "Base Sepolia",
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const, // USDC
  tokenName: "USDC", // EIP-712 domain name of the token
  tokenVersion: "2", // EIP-712 domain version of the token
  facilitator: "0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A" as const,
  rpcUrls: ["https://sepolia.base.org"] as const,
  explorerUrl: "https://sepolia.basescan.org",
};

export const PROTECTED_DEMO_AMOUNT = "10000"; // $0.01 in USDC base units (6 decimals)

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  extra?: {
    name?: string;
    version?: string;
  };
}

export function buildPaymentRequirements(
  resource: string,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK.id,
    asset: NETWORK.token,
    payTo: NETWORK.facilitator,
    maxAmountRequired: process.env.PROTECTED_DEMO_AMOUNT ?? PROTECTED_DEMO_AMOUNT,
    resource,
    description: "Developer demo: same-chain x402 payment on Base Sepolia",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { name: NETWORK.tokenName, version: NETWORK.tokenVersion },
  };
}
