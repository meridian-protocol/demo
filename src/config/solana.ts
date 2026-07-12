export const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

/** Explorer ?cluster= value: "devnet", "custom" (localnet) or "" (mainnet). */
export const EXPLORER_CLUSTER =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

export const X402_NETWORK =
  process.env.NEXT_PUBLIC_X402_NETWORK ??
  (EXPLORER_CLUSTER === "" ? "solana" : "solana-devnet");

export const USDC_DECIMALS = 6;

export function explorerTxUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (!EXPLORER_CLUSTER) return base;
  if (EXPLORER_CLUSTER === "custom") {
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  }
  return `${base}?cluster=${EXPLORER_CLUSTER}`;
}
