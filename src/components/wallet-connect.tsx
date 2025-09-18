"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export function WalletConnect() {
  const { address, isConnected } = useAccount();

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-gray-50 rounded-lg">
      <ConnectButton />

      {isConnected && address && (
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-2">Connected Wallet:</p>
          <p className="font-mono text-sm bg-gray-200 px-2 py-1 rounded">
            {address.slice(0, 6)}...{address.slice(-4)}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Wallet connected successfully
          </p>
        </div>
      )}
    </div>
  );
}
