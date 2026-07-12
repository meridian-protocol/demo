"use client";

import dynamic from "next/dynamic";

// WalletMultiButton reads wallet state at render time; load it client-only to
// avoid hydration mismatches.
const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export function SolanaWalletConnect() {
  return <WalletMultiButton />;
}
