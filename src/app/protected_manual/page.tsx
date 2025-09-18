"use client";
import { createWalletClient, custom, WalletClient } from "viem";
import { baseSepolia } from "viem/chains";
import { useState } from "react";
import axios from "axios";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { ChainIdToNetwork, PaymentRequirementsSchema } from "x402/types";
import Image from "next/image";
import Link from "next/link";
import { Github, Book, Twitter, Telegram } from "iconoir-react";

// Define the PaymentRequirements interface locally since it's not exported from x402/types
interface PaymentRequirements {
  amount: string;
  recipient: string;
  network: string;
  scheme: string;
  maxAmountRequired: string;
  resource: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

// Extend the existing Window interface locally to avoid conflicts
interface ExtendedWindow extends Window {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (
      event: string,
      callback: (...args: unknown[]) => void
    ) => void;
  };
}

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [client, setClient] = useState<WalletClient | null>(null);
  const [sampleResponse, setSampleResponse] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Type assertion for window with extended interface - only on client side
  const getExtendedWindow = (): ExtendedWindow | null => {
    if (typeof window !== "undefined") {
      return window as ExtendedWindow;
    }
    return null;
  };

  const connectWallet = async () => {
    const extendedWindow = getExtendedWindow();
    if (extendedWindow?.ethereum) {
      try {
        // Request account access
        const accounts = (await extendedWindow.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];

        if (accounts.length > 0) {
          const account = accounts[0] as `0x${string}`;
          setAccount(account);

          // Create wallet client with browser wallet
          const walletClient = createWalletClient({
            account,
            transport: custom(extendedWindow.ethereum),
            chain: baseSepolia,
          });

          setClient(walletClient);
          setIsConnected(true);
          console.log("Connected to wallet:", account);
        }
      } catch (error) {
        console.error("Error connecting to wallet:", error);
      }
    } else {
      alert("Please install MetaMask or another wallet extension");
    }
  };

  const requestSample = async () => {
    const extendedWindow = getExtendedWindow();
    if (!client || !account || !extendedWindow?.ethereum) {
      alert("Please connect your wallet first");
      return;
    }

    setIsLoading(true);
    setSampleResponse(null);

    try {
      // Make a regular API request to the facilitator with forwarding headers
      const response = await axios.get("https://api.mrdn.finance/v1/samples", {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
        },
      });

      console.log("Sample response:", response.data);
      setSampleResponse(response.data);

      // Check if payment is required
      console.log("Status:", response.status);
      if (response.status === 402) {
        // Handle payment manually
        console.log("Payment required:", response.data.accepts[0]);
        await handlePayment(
          response.data.accepts[0],
          response.data.x402Version,
          response.data.accepts
        );
      }
    } catch (error) {
      console.error("Error requesting sample:", error);
      if (axios.isAxiosError(error) && error.response?.status === 402) {
        // Handle payment requirement
        console.log("Payment required:", error.response.data.accepts[0]);
        await handlePayment(
          error.response.data.accepts[0],
          error.response.data.x402Version,
          error.response.data.accepts
        );
      } else {
        alert("Error requesting sample. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async (
    paymentDetails: PaymentRequirements,
    x402Version: number,
    accepts: PaymentRequirements[]
  ) => {
    const extendedWindow = getExtendedWindow();
    if (!client || !account || !extendedWindow?.ethereum) {
      alert("Wallet not connected");
      return;
    }

    try {
      const parsed = accepts.map((x) => PaymentRequirementsSchema.parse(x));

      // Get chain ID from the client's chain property
      const chainId = client.chain?.id;

      const selectedPaymentRequirements = selectPaymentRequirements(
        parsed,
        chainId ? ChainIdToNetwork[chainId] : undefined,
        "exact"
      );

      console.log("selectedPaymentRequirements", selectedPaymentRequirements);

      const paymentHeader = await createPaymentHeader(
        client as unknown as Parameters<typeof createPaymentHeader>[0],
        x402Version,
        selectedPaymentRequirements
      );

      console.log("Payment header:", paymentHeader);

      // send the payment header to our facilitator
      const facilitatorResponse = await axios.get(
        "https://api.mrdn.finance/v1/settle",
        {
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
            "X-PAYMENT": paymentHeader,
            "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
          },
        }
      );

      console.log("Facilitator response:", facilitatorResponse.data);

      // request the sample again with the payment header
      const response = await axios.get("https://api.mrdn.finance/v1/samples", {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
          "X-PAYMENT": paymentHeader,
          "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
        },
      });
      console.log("Sample response:", response.data);
      setSampleResponse(response.data);
    } catch (error: unknown) {
      console.error("Payment error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      alert("Payment failed: " + errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-[#0C0C0D] text-white flex flex-col p-4 sm:p-6 relative">
      {/* Back to Home link - top left */}
      <div className="absolute top-4 sm:top-6 left-4 sm:left-6">
        <Link
          href="/"
          className="text-white/70 hover:text-white transition-colors font-mono text-sm"
        >
          ← Back to Home
        </Link>
      </div>

      {/* Top right social links */}
      <div className="absolute top-4 sm:top-6 right-4 sm:right-6 flex gap-3 sm:gap-4">
        <a
          href="https://github.com/meridian-protocol/demo"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/70 hover:text-white transition-colors"
        >
          <Github className="w-5 h-5 sm:w-6 sm:h-6" />
        </a>
        <a
          href="https://docs.mrdn.finance/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/70 hover:text-white transition-colors"
        >
          <Book className="w-5 h-5 sm:w-6 sm:h-6" />
        </a>
        <a
          href="https://x.com/mrdn_finance"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/70 hover:text-white transition-colors"
        >
          <Twitter className="w-5 h-5 sm:w-6 sm:h-6" />
        </a>
        <a
          href="https://t.me/mrdnfinance"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/70 hover:text-white transition-colors"
        >
          <Telegram className="w-5 h-5 sm:w-6 sm:h-6" />
        </a>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center flex flex-col items-center w-full max-w-4xl">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-light mb-6 sm:mb-8 lg:mb-12 text-white px-4">
            <span className="font-funnel-display font-light">Meridian</span>{" "}
            x402 Demo
          </h1>

          <div className="bg-[#1F1F1F] rounded-xl shadow-lg p-6 sm:p-8 w-full max-w-2xl">
            <main className="flex flex-col items-center justify-center">
              {!isConnected ? (
                <div className="flex flex-col gap-4 mb-8 text-center">
                  <p className="text-white/80 mb-4">
                    Connect your browser wallet to get started.
                  </p>
                  <button
                    onClick={connectWallet}
                    type="button"
                    className="px-6 sm:px-8 py-3 sm:py-4 text-[#34D399] bg-emerald-500/10 hover:bg-emerald-500/5 rounded-lg font-mono transition-colors text-sm sm:text-lg"
                  >
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-6 mb-8 text-center">
                  <p className="text-[#34D399] text-lg font-mono">
                    Connected: {account?.slice(0, 6)}...{account?.slice(-4)}
                  </p>
                  <div className="flex flex-col gap-4">
                    <p className="text-white/80 mb-4">
                      Request a sample from the API to test x402 payments.
                    </p>
                    <button
                      onClick={requestSample}
                      type="button"
                      disabled={isLoading}
                      className="px-6 sm:px-8 py-3 sm:py-4 text-[#34D399] bg-emerald-500/10 hover:bg-emerald-500/5 rounded-lg font-mono transition-colors text-sm sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? "Loading..." : "Request Sample"}
                    </button>
                  </div>

                  {/* Display Sample Response */}
                  {sampleResponse && (
                    <div className="mt-8 p-4 bg-[#0C0C0D] rounded-lg w-full">
                      <h3 className="text-lg font-semibold mb-4 text-[#34D399] font-mono">
                        Sample Response:
                      </h3>
                      <pre className="bg-black/50 p-4 rounded-lg border border-white/10 overflow-x-auto text-sm text-white/90 font-mono">
                        {JSON.stringify(sampleResponse, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-4 py-8">
        <Image
          src="/logo-white.svg"
          alt="Logo"
          width={48}
          height={48}
          className="w-10 h-10 sm:w-12 sm:h-12 logo-spin"
        />
        <a
          href="https://www.mrdn.finance/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#36D98D] hover:opacity-80 transition-opacity font-mono text-sm"
        >
          mrdn.finance
        </a>
      </footer>
    </div>
  );
}
