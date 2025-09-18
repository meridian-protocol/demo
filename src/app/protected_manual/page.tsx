"use client";
import { createWalletClient, custom, WalletClient } from "viem";
import { baseSepolia } from "viem/chains";
import { useState } from "react";
import axios from "axios";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { ChainIdToNetwork, PaymentRequirementsSchema } from "x402/types";

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
      const response = await axios.get("http://localhost:4021/v1/samples", {
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
        "http://localhost:4021/v1/settle",
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
      const response = await axios.get("http://localhost:4021/v1/samples", {
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
    <div className="flex flex-col items-center justify-center h-screen">
      <main className="flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold mb-8">
          x402 Demo with Browser Wallet
        </h1>

        {!isConnected ? (
          <div className="flex flex-col gap-4 mb-8">
            <p>Connect your browser wallet to get started.</p>
            <button
              onClick={connectWallet}
              type="button"
              className="rounded-md bg-green-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-green-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 mb-8">
            <p className="text-green-600">
              Connected: {account?.slice(0, 6)}...{account?.slice(-4)}
            </p>
            <ol className="list-decimal">
              <li>
                <div className="flex flex-col gap-4 mb-8">
                  <p>Request a sample from the API.</p>
                  <button
                    onClick={requestSample}
                    type="button"
                    disabled={isLoading}
                    className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? "Loading..." : "Request a sample"}
                  </button>
                </div>
              </li>
            </ol>

            {/* Display Sample Response */}
            {sampleResponse && (
              <div className="mt-8 p-4 bg-gray-100 rounded-lg max-w-2xl">
                <h3 className="text-lg font-semibold mb-2">Sample Response:</h3>
                <pre className="bg-white p-3 rounded border overflow-x-auto text-sm">
                  {JSON.stringify(sampleResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
