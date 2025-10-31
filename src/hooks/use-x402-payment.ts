"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

interface PaymentRequirements {
  amount: string;
  recipient: string;
  network: string;
  description?: string;
}

interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer: string;
}

// Types based on the working example
interface X402PaymentRequirements {
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

export function useX402Payment() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signAndVerifyPayment = async (
    requirements: PaymentRequirements
  ): Promise<VerifyResponse | null> => {
    if (!isConnected || !address) {
      setError("Wallet not connected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Create payment requirements that match the x402 library format
      const x402PaymentRequirements: X402PaymentRequirements[] = [
        {
          amount: (parseFloat(requirements.amount) * 10 ** 6).toString(),
          recipient: requirements.recipient,
          network: requirements.network,
          scheme: "exact",
          maxAmountRequired: (
            parseFloat(requirements.amount) *
            10 ** 6
          ).toString(),
          resource: "https://demo.meridian.com/access",
          mimeType: "application/json",
          payTo: requirements.recipient,
          maxTimeoutSeconds: 3600,
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
        },
      ];

      console.log("Payment requirements:", x402PaymentRequirements);

      // Create a message to sign
      const message = `X402 Payment Authorization
Amount: ${requirements.amount} USDC
Recipient: ${requirements.recipient}
Network: ${requirements.network}
Description: ${requirements.description || "Access to protected content"}
Timestamp: ${Date.now()}`;

      // Sign the message
      const signature = await signMessageAsync({ message });

      // Since we don't have the x402 client library, let's try to create a simple payload
      // that matches what the working example would generate
      const paymentPayload = {
        x402Version: 1,
        scheme: "exact" as const,
        network: "base-sepolia" as const,
        payload: {
          signature, // Use the actual signature
          authorization: {
            from: address,
            to: requirements.recipient,
            value: (parseFloat(requirements.amount) * 10 ** 6).toString(),
            validAfter: (Math.floor(Date.now() / 1000) - 60).toString(),
            validBefore: (Math.floor(Date.now() / 1000) + 3600).toString(),
            nonce: `0x${Date.now().toString(16).padStart(64, "0")}`,
          },
        },
      };

      console.log("Payment payload:", paymentPayload);

      // Call the facilitator directly
  const facilitatorUrl = "https://api.mrdn.finance";

      const response = await fetch(`${facilitatorUrl}/v1/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentPayload,
          paymentRequirements: x402PaymentRequirements[0], // Use the first one
        }),
      });

      console.log("Response status:", response.status);
      console.log(
        "Response headers:",
        Object.fromEntries(response.headers.entries())
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Facilitator error:", errorData);
        throw new Error(
          errorData.invalidReason || "Payment verification failed"
        );
      }

      const verifyResult: VerifyResponse = await response.json();
      console.log("Verification result:", verifyResult);
      return verifyResult;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Payment verification failed";
      console.error("Payment verification error:", err);
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isConnected,
    address,
    isLoading,
    error,
    signAndVerifyPayment,
    clearError: () => setError(null),
  };
}
