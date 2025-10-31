"use client";

import { useState, useEffect } from "react";
import { useAccount, useWaitForTransactionReceipt, useChainId, useSwitchChain } from "wagmi";
import { WalletConnect } from "@/components/wallet-connect";
import Link from "next/link";
import { ArrowLeft, CheckCircle, XmarkCircle, Clock, Flash, ArrowRight } from "iconoir-react";
import { CheckCircle as PhosphorCheckCircle, XCircle as PhosphorXCircle } from "@phosphor-icons/react";
import { parseUnits, createWalletClient, custom } from "viem";
import { getAcrossQuote, getDepositParams, type AcrossQuoteResponse } from "@/utils/across-api";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { ChainIdToNetwork, PaymentRequirementsSchema } from "x402/types";
import axios from "axios";

// Contract addresses from the specification
// Using V2 proxy with cross-chain support (from b.md)
const PROXY_ADDRESS = "0xe72163ccCD6e7E2d5aC27a23A9496c481080AcA1"; // V2 proxy with Across support
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
const BACKEND_SIGNER = "0x9f205c5F8D3635261a87bb60d7E62d3a7E5E5DbF"; // Backend address from example
const FACILITATOR_URL = "https://api.mrdn.finance"; // Hard-coded facilitator base URL

// Chain configurations
const SUPPORTED_CHAINS = {
  "base-sepolia": {
    id: 84532,
    name: "Base Sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    proxy: "0xe72163ccCD6e7E2d5aC27a23A9496c481080AcA1", // V2 proxy with cross-chain support
    explorer: "https://sepolia.basescan.org"
  },
  "optimism-sepolia": {
    id: 11155420,
    name: "Optimism Sepolia", 
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    proxy: "0xe72163ccCD6e7E2d5aC27a23A9496c481080AcA1", // V2 proxy with cross-chain support
    explorer: "https://sepolia-optimism.etherscan.io"
  }
};

// Credited recipient (merchant) address for demo – NOT the proxy
// This must be the address that gets credited in the proxy ledger
const CREDITED_RECIPIENT = "0x85B7B882EeCDfC709EF167Ec8D350064E85F1b07";

interface PaymentForm {
  amount: string;
  sourceChain: keyof typeof SUPPORTED_CHAINS;
  destinationChain: keyof typeof SUPPORTED_CHAINS;
  description: string;
}

// Use the AcrossQuoteResponse from the utility
type AcrossQuote = AcrossQuoteResponse;

interface TransactionStatus {
  step: 'idle' | 'signing' | 'bridging' | 'settling' | 'completed' | 'error';
  txHash?: string;
  error?: string;
  bridgeStatus?: 'pending' | 'filled' | 'completed';
  executedExplorer?: string; // exact explorer base URL for the chain the tx was sent on
  executedChainName?: string; // human name for link label
}

// Contract ABI - includes both V1 and V2 signatures (overloaded)
const PROXY_ABI = [
  // V1 (same-chain) signature
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
      { name: "recipient", type: "address" },
      { name: "platform", type: "address" },
      { name: "platformFeeBps", type: "uint256" }
    ],
    outputs: []
  },
  // V2 (cross-chain) signature
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
      { name: "recipient", type: "address" },
      { name: "platform", type: "address" },
      { name: "platformFeeBps", type: "uint256" },
      { 
        name: "depositParams", 
        type: "tuple",
        components: [
          { name: "destinationChainId", type: "uint256" },
          { name: "outputAmount", type: "uint256" },
          { name: "quoteTimestamp", type: "uint32" },
          { name: "fillDeadline", type: "uint32" }
        ]
      },
      { name: "backendMessageSig", type: "bytes" }
    ],
    outputs: []
  }
] as const;

// Type for the deposit params tuple
type DepositParams = {
  destinationChainId: bigint;
  outputAmount: bigint;
  quoteTimestamp: number;
  fillDeadline: number;
};

// EIP-712 Domain for backend message signing - EXACT match with contract
// NOTE: This is what the BACKEND should use when signing the AcrossMessage
// CRITICAL: chainId must be DESTINATION chain, not source chain!
// The signature is verified on the destination chain where the contract receives the Across message
const createEIP712Domain = (destinationChainId: number, proxyAddress: string) => ({
  name: "X402ProxyFacilitatorV2", // Must match contract exactly
  version: "1",
  chainId: destinationChainId, // MUST be destination chain (where signature is verified)
  verifyingContract: proxyAddress as `0x${string}` // V2 proxy on destination chain
});

// EIP-712 Types for AcrossMessage - EXACT match with contract
const ACROSS_MESSAGE_TYPES = {
  AcrossMessage: [
    { name: "originalSender", type: "address" },
    { name: "creditedRecipient", type: "address" },
    { name: "platform", type: "address" },
    { name: "expectedAmount", type: "uint256" },
    { name: "platformFeeBps", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "sourceChainId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "token", type: "address" },
    { name: "recipientContract", type: "address" }
  ]
} as const;

export default function AcrossDemo() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [form, setForm] = useState<PaymentForm>({
    amount: "1.0",
    sourceChain: "base-sepolia",
    destinationChain: "optimism-sepolia",
    description: "Cross-chain demo payment via Across",
  });

  const [quote, setQuote] = useState<AcrossQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [status, setStatus] = useState<TransactionStatus>({ step: 'idle' });
  const [isLoading, setIsLoading] = useState(false);

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: status.txHash as `0x${string}` | undefined,
  });

  // Check if this is a cross-chain transfer
  const isCrossChain = form.sourceChain !== form.destinationChain;

  // The recipient is always the proxy contract - no user input needed

  // Get Across quote
  const fetchAcrossQuote = async (): Promise<AcrossQuote | null> => {
    try {
      const sourceChainConfig = SUPPORTED_CHAINS[form.sourceChain];
      const destChainConfig = SUPPORTED_CHAINS[form.destinationChain];
      const inputAmount = parseUnits(form.amount, 6).toString();

      // Always require a real Across quote for cross-chain mode (no fallback)
      const realQuote = await getAcrossQuote({
        inputToken: sourceChainConfig.usdc,
        outputToken: destChainConfig.usdc,
        inputAmount,
        originChainId: sourceChainConfig.id,
        destinationChainId: destChainConfig.id,
        recipient: PROXY_ADDRESS
      });
      return realQuote;
    } catch (error) {
      console.error("Failed to get Across quote:", error);
      return null;
    }
  };

  // Update quote when form changes
  useEffect(() => {
    if (form.amount && parseFloat(form.amount) > 0) {
      if (isCrossChain) {
        setQuoteLoading(true);
        setQuoteError(null);
        fetchAcrossQuote().then((result) => {
          if (result) {
            setQuote(result);
            setQuoteError(null);
          } else {
            setQuote(null);
            setQuoteError("Failed to get quote from Across API");
          }
          setQuoteLoading(false);
        });
      } else {
        // For same-chain transfers, create a simple quote (no bridge needed)
        const inputAmount = parseUnits(form.amount, 6).toString();
        setQuote({
          outputAmount: inputAmount,
          bridgeFee: "0",
          lpFee: "0",
          relayerCapitalFee: "0",
          relayerGasFee: "0",
          totalRelayFee: "0",
          quoteTimestamp: Math.floor(Date.now() / 1000),
          fillDeadline: 0,
          exclusivityDeadline: 0,
          suggestedRelayerFeePct: "0",
          isAmountTooLow: false,
          spokePoolAddress: ""
        });
        setQuoteError(null);
      }
    } else {
      setQuote(null);
      setQuoteError(null);
    }
  }, [form.amount, form.sourceChain, form.destinationChain, isCrossChain]);

  // Watch for transaction confirmation
  useEffect(() => {
    if (receipt && status.step === 'settling') {
      // Transaction confirmed, now wait for potential cross-chain completion
      const completionTime = isCrossChain ? 30000 : 1000; // 30s for cross-chain, 1s for same-chain
      setTimeout(() => {
        setStatus(prev => ({ ...prev, step: 'completed' }));
      }, completionTime);
    }
  }, [receipt, status.step, isCrossChain]);

  /**
   * Execute transfer via backend using x402 payment protocol
   * 
   * BACKEND IMPLEMENTATION REQUIREMENTS:
   * ====================================
   * 
   * For V2 cross-chain transfers, the backend MUST:
   * 
   * 1. Generate EIP-712 signature for AcrossMessage using the DESTINATION chain domain:
   * 
   *    import { privateKeyToAccount } from 'viem/accounts';
   *    
   *    const account = privateKeyToAccount(BACKEND_PRIVATE_KEY);
   *    const signature = await account.signTypedData({
   *      domain: paymentRequirements.extra.eip712Domain, // Uses DESTINATION chain!
   *      types: {
   *        AcrossMessage: [
   *          { name: "originalSender", type: "address" },
   *          { name: "creditedRecipient", type: "address" },
   *          { name: "platform", type: "address" },
   *          { name: "expectedAmount", type: "uint256" },
   *          { name: "platformFeeBps", type: "uint256" },
   *          { name: "nonce", type: "bytes32" },
   *          { name: "sourceChainId", type: "uint256" },
   *          { name: "destinationChainId", type: "uint256" },
   *          { name: "token", type: "address" },
   *          { name: "recipientContract", type: "address" }
   *        ]
   *      },
   *      primaryType: "AcrossMessage",
   *      message: {
   *        originalSender: from,
   *        creditedRecipient: recipient,
   *        platform: platform,
   *        expectedAmount: depositParams.outputAmount,
   *        platformFeeBps: platformFeeBps,
   *        nonce: nonce,
   *        sourceChainId: sourceChainId,
   *        destinationChainId: destinationChainId,
   *        token: destinationUsdcAddress,
   *        recipientContract: destinationProxyAddress
   *      }
   *    });
   * 
   * 2. Call the appropriate contract function:
   *    - If isCrossChain === false: Call V1 function (10 params, no backendMessageSig)
   *    - If isCrossChain === true: Call V2 function (12 params, include backendMessageSig)
   * 
   * See test implementation in contract tests for exact reference.
   */
  const executeTransferViaBackend = async (
    value: bigint,
    depositParams: DepositParams
  ): Promise<{ txHash: string; chainId: number }> => {
    const sourceChainId = SUPPORTED_CHAINS[form.sourceChain].id;
    
    // Payment requirements (same as protected_manual)
    // CRITICAL: Must include 'extra' field with USDC token info!
    // resource must be an API endpoint (not frontend URL)
    // For cross-chain, we need to pass depositParams to the backend
    const destinationChainId = depositParams.destinationChainId.toString();
    const isCrossChainTransfer = destinationChainId !== sourceChainId.toString();
    
    const paymentRequirements: any = {
      amount: value.toString(),
      recipient: CREDITED_RECIPIENT, // credited recipient per spec
      network: form.sourceChain,
      scheme: "exact",
      maxAmountRequired: value.toString(),
      resource: "https://api.mrdn.finance/v1/samples", // Use actual API endpoint like protected_manual
      description: `Payment for ${form.amount} USDC`,
      mimeType: "application/json",
      payTo: PROXY_ADDRESS,
      maxTimeoutSeconds: 60, // Match protected_manual
      asset: SUPPORTED_CHAINS[form.sourceChain].usdc,
      extra: {
        name: "USDC",
        version: "2",
        // keep platform fee disabled as per spec
        platform: "0x0000000000000000000000000000000000000000",
        platformFeeBps: 0,
        // Include deposit params for backend to process cross-chain
        depositParams: {
          destinationChainId: destinationChainId,
          outputAmount: depositParams.outputAmount.toString(),
          quoteTimestamp: depositParams.quoteTimestamp,
          fillDeadline: depositParams.fillDeadline
        },
        destinationChain: form.destinationChain,
        isCrossChain: isCrossChainTransfer,
        // CRITICAL: Backend needs destination proxy address for EIP-712 domain
        destinationProxyAddress: SUPPORTED_CHAINS[form.destinationChain].proxy,
        // EIP-712 domain info for backend signature (MUST use DESTINATION chain!)
        eip712Domain: {
          name: "X402ProxyFacilitatorV2",
          version: "1",
          chainId: Number(destinationChainId), // DESTINATION chain for signature verification
          verifyingContract: SUPPORTED_CHAINS[form.destinationChain].proxy
        }
      }
    };

    try {
      // Create wallet client (same as protected_manual)
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        throw new Error("Ethereum provider not found");
      }

    const walletClient = createWalletClient({
      account: address!,
      chain: sourceChainId === 84532 ? 
        { id: 84532, name: "Base Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as any : 
        { id: 11155420, name: "Optimism Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as any,
      transport: custom((window as any).ethereum)
    });

    // Parse and select requirements (EXACT copy from protected_manual)
    const parsed = [paymentRequirements].map((x: any) => PaymentRequirementsSchema.parse(x));
    
    const selectedPaymentRequirements = selectPaymentRequirements(
      parsed,
      ChainIdToNetwork[sourceChainId],
      "exact"
    );

    console.log("selectedPaymentRequirements", selectedPaymentRequirements);
    console.log("original paymentRequirements", paymentRequirements);

    // Create payment header using x402 library with SELECTED requirements
    const paymentHeader = await createPaymentHeader(
      walletClient as any,
      1, // x402Version
      selectedPaymentRequirements
    );

    console.log("Payment header created:", paymentHeader);

    // Decode the X-PAYMENT header into a JSON payload for backend body requirements
    const decodeBase64Url = (value: string) => {
      try {
        const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
        return atob(padded);
      } catch {
        return "";
      }
    };

    let paymentPayload: any = null;
    try {
      const decoded = decodeBase64Url(paymentHeader);
      if (decoded) paymentPayload = JSON.parse(decoded);
    } catch {
      paymentPayload = null;
    }

    // POST request via Next.js API proxy to avoid CORS issues
    const facilitatorResponse = await axios.post(
      '/api/settle',
      {
        paymentRequirements: selectedPaymentRequirements,
        originalPaymentRequirements: paymentRequirements,
        ...(paymentPayload ? { paymentPayload } : {})
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
          "X-PAYMENT": paymentHeader,
          "Content-Type": "application/json"
        }
      }
    );

      console.log("Facilitator response:", facilitatorResponse.data);
      console.log("Facilitator response type:", typeof facilitatorResponse.data);
      console.log("Facilitator response keys:", Object.keys(facilitatorResponse.data || {}));

      const result = facilitatorResponse.data;

      // Check if this is API documentation (wrong response)
      if (result.endpoint || result.description) {
        console.error("Backend returned API documentation instead of executing transaction!");
        console.error("This means the backend needs to be updated to handle V2 cross-chain transfers.");
        console.error("See BACKEND_V2_REQUIREMENTS.md for implementation details.");
        throw new Error("Backend returned API docs instead of transaction - backend needs V2 implementation");
      }

      if (!result.success || !result.transaction) {
        throw new Error(result.errorReason || "No transaction hash returned");
      }

      return {
        txHash: result.transaction,
        chainId: sourceChainId
      };
    } catch (error: any) {
      console.error("Execute transfer error:", error);
      console.error("Error response:", error.response?.data);
      console.error("Payment requirements sent:", paymentRequirements);
      throw error;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address || !quote) return;

    setIsLoading(true);
    setStatus({ step: 'signing' });

    try {
      // Ensure we're on the correct source chain
      const sourceChainConfig = SUPPORTED_CHAINS[form.sourceChain];
      if (chainId !== sourceChainConfig.id) {
        await switchChain({ chainId: sourceChainConfig.id });
      }

      const value = parseUnits(form.amount, 6);
      const executedExplorer = SUPPORTED_CHAINS[form.sourceChain].explorer;
      const executedChainName = SUPPORTED_CHAINS[form.sourceChain].name;
      setStatus({ step: 'bridging', executedExplorer, executedChainName });

      const destinationChainId = SUPPORTED_CHAINS[form.destinationChain].id;

      // Deposit params: for cross-chain, use Across quote; for same-chain, pass minimal values.
      const depositParams: DepositParams = isCrossChain
        ? await getDepositParams(
            quote!,
            destinationChainId,
            SUPPORTED_CHAINS[form.sourceChain].id
          )
        : {
            destinationChainId: BigInt(SUPPORTED_CHAINS[form.sourceChain].id),
            outputAmount: value,
            quoteTimestamp: Math.floor(Date.now() / 1000),
            fillDeadline: Math.floor(Date.now() / 1000) + 600
          };

      // x402 library handles everything (same as protected_manual)
      const result = await executeTransferViaBackend(value, depositParams);

      setStatus({ 
        step: 'settling', 
        txHash: result.txHash as `0x${string}`, 
        executedExplorer, 
        executedChainName 
      });

    } catch (error) {
      console.error("Transaction failed:", error);
      setStatus({ 
        step: 'error', 
        error: error instanceof Error ? error.message : "Transaction failed" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetStatus = () => {
    setStatus({ step: 'idle' });
  };

  const getStatusIcon = () => {
    switch (status.step) {
      case 'signing':
        return <Clock className="w-5 h-5 text-[#34D399] animate-spin" />;
      case 'bridging':
      case 'settling':
        return <Flash className="w-5 h-5 text-[#34D399] animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-[#34D399]" />;
      case 'error':
        return <XmarkCircle className="w-5 h-5 text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (status.step) {
      case 'signing':
        return 'Please sign the USDC authorization in your wallet (no gas required)...';
      case 'bridging':
        return isCrossChain
          ? 'Backend is executing cross-chain transfer via Across...'
          : 'Backend is executing same-chain transfer (gasless for you)...';
      case 'settling':
        return isCrossChain
          ? 'Waiting for Across bridge to complete on destination chain...'
          : 'Transaction confirmed! Balance credited in proxy.';
      case 'completed':
        return 'Payment completed successfully - you paid no gas!';
      case 'error':
        return `Error: ${status.error}`;
      default:
        return '';
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-[#171719] p-4 sm:p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-[#171719]/70 hover:text-[#171719] transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-3xl sm:text-4xl font-light">
              <span className="font-funnel-display">x402 Payment</span> Demo
            </h1>
          </div>
          <WalletConnect />
        </div>

        {/* Description */}
        <div className="bg-[#171719] rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 text-[#34D399]">
            Same Chain & Cross-Chain Payments
          </h2>
          <p className="text-[#F2F2F2]/90 mb-4">
            Send USDC with one signature. Cross-chain transfers use Across Protocol. The backend executes the transaction and pays gas on your behalf.
          </p>
          <div className="flex items-center gap-2 pt-3 border-t border-[#F2F2F2]/20">
            <span className="text-[#F2F2F2]/60 text-xs">powered by</span>
            <img src="/Across Primary Logo Aqua.svg" alt="Across Protocol" className="h-3" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Payment Form */}
          <div className="bg-[#171719] rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6 text-[#34D399] font-funnel-display">Payment Transfer</h2>
            
            {!isConnected ? (
              <div className="space-y-4">
                <p className="text-[#F2F2F2]/70">Connect your wallet to start</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium mb-2 text-[#F2F2F2]">Amount (USDC)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.amount}
                    onChange={(e) => setForm(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#1F1F1F] border border-transparent rounded-lg focus:border-[#34D399] focus:outline-none text-[#F2F2F2]"
                    placeholder="1.0"
                  />
                </div>

                {/* Chain Selection */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                    <div className="relative">
                      <label className="block text-sm font-medium mb-2 text-[#F2F2F2]">From Chain</label>
                      <select
                        value={form.sourceChain}
                        onChange={(e) => setForm(prev => ({ ...prev, sourceChain: e.target.value as keyof typeof SUPPORTED_CHAINS }))}
                        className="w-full px-4 py-3 pr-10 bg-[#1F1F1F] border border-transparent rounded-lg focus:border-[#34D399] focus:outline-none appearance-none text-[#F2F2F2]"
                      >
                        {Object.entries(SUPPORTED_CHAINS).map(([key, chain]) => (
                          <option key={key} value={key}>
                            {chain.name}
                          </option>
                        ))}
                      </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none mt-8">
                        <svg className="w-4 h-4 text-[#F2F2F2]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    <div className="relative">
                      <label className="block text-sm font-medium mb-2 text-[#F2F2F2]">To Chain</label>
                      <select
                        value={form.destinationChain}
                        onChange={(e) => setForm(prev => ({ ...prev, destinationChain: e.target.value as keyof typeof SUPPORTED_CHAINS }))}
                        className="w-full px-4 py-3 pr-10 bg-[#1F1F1F] border border-transparent rounded-lg focus:border-[#34D399] focus:outline-none appearance-none text-[#F2F2F2]"
                      >
                        {Object.entries(SUPPORTED_CHAINS).map(([key, chain]) => (
                          <option key={key} value={key}>
                            {chain.name}
                          </option>
                        ))}
                      </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none mt-8">
                        <svg className="w-4 h-4 text-[#F2F2F2]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  
                    {/* Transfer Direction Indicator */}
                    <div className="flex items-center justify-center">
                      <div className="flex items-center gap-2 text-[#F2F2F2]/60">
                      <span className="text-sm">{SUPPORTED_CHAINS[form.sourceChain].name}</span>
                      <ArrowRight className="w-4 h-4" />
                      <span className="text-sm">{SUPPORTED_CHAINS[form.destinationChain].name}</span>
                    </div>
                  </div>
                  
                  {/* Smart Routing Indicator */}
                  <div className="bg-[#1F1F1F] border-0 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full bg-[#34D399]`} />
                      <span className="text-sm font-medium text-[#F2F2F2]">
                        Smart Routing: {isCrossChain ? 'Cross-Chain Mode' : 'Same-Chain Mode'}
                      </span>
                    </div>
                    <p className="text-xs text-[#F2F2F2]/70 mt-1">
                      {isCrossChain 
                        ? 'Contract will automatically bridge via Across Protocol'
                        : 'Contract will process locally without bridging'
                      }
                    </p>
                  </div>
                </div>

                {/* Quote Display */}
                {quoteLoading && (
                  <div className="bg-[#1F1F1F] border-0 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#34D399] animate-spin" />
                      <span className="text-[#F2F2F2]">Fetching quote from Across...</span>
                    </div>
                  </div>
                )}
                
                {quoteError && !quoteLoading && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <XmarkCircle className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">{quoteError}</span>
                    </div>
                  </div>
                )}
                
                {quote && !quoteLoading && (
                  <div className="bg-[#1F1F1F] border-0 rounded-lg p-4">
                    <h3 className="font-medium mb-3 text-[#34D399]">
                      {isCrossChain ? 'Across Quote' : 'Transfer Summary'}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[#F2F2F2]/70">You send:</span>
                        <span className="text-[#F2F2F2]">{form.amount} USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#F2F2F2]/70">
                          {isCrossChain ? 'Bridge fee:' : 'Your fee:'}
                        </span>
                        <span className="text-[#34D399]">
                          {isCrossChain 
                            ? `${(parseInt(quote.totalRelayFee) / 10**6).toFixed(4)} USDC`
                            : '$0 (Gasless)'
                          }
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#F2F2F2]/70">You receive:</span>
                        <span className="text-[#34D399] font-semibold">{(parseInt(quote.outputAmount) / 10**6).toFixed(4)} USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#F2F2F2]/70">Estimated time:</span>
                        <span className="text-[#F2F2F2]">{isCrossChain ? '2-5 minutes' : '~30 seconds'}</span>
                      </div>
                    </div>
                    {isCrossChain && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F2F2F2]/20">
                        <span className="text-[#F2F2F2]/60 text-xs">powered by</span>
                        <img src="/Across Primary Logo Aqua.svg" alt="Across Protocol" className="h-3" />
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading || status.step !== 'idle' || !quote}
                  className="w-full px-6 py-3 bg-[#34D399] hover:bg-[#2DB882] disabled:bg-[#1F1F1F]/50 disabled:cursor-not-allowed text-[#171719] font-semibold rounded-lg transition-colors"
                >
                  {isLoading ? 'Processing...' : isCrossChain ? 'Execute Cross-Chain Payment' : 'Execute Same-Chain Payment'}
                </button>

                {/* Reset Button */}
                {(status.step === 'completed' || status.step === 'error') && (
                  <button
                    type="button"
                    onClick={resetStatus}
                    className="w-full px-6 py-3 bg-[#1F1F1F] hover:bg-[#1F1F1F]/80 text-[#F2F2F2] font-semibold rounded-lg transition-colors"
                  >
                    Reset
                  </button>
                )}
              </form>
            )}
          </div>

          {/* Transaction Status Panel */}
          <div className="bg-[#171719] rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6 text-[#34D399] font-funnel-display">Transaction Status</h2>
            
            {status.step === 'idle' ? (
              <div className="text-[#F2F2F2]/80">
                <p className="mb-4 text-[#F2F2F2]">Ready to process {isCrossChain ? 'cross-chain' : 'same-chain'} payment</p>
                <div className="space-y-2 text-sm">
                  <p className="flex items-center gap-2">
                    • Connected: 
                    {isConnected ? (
                      <PhosphorCheckCircle weight="fill" className="w-4 h-4 text-[#34D399]" />
                    ) : (
                      <PhosphorXCircle weight="fill" className="w-4 h-4 text-red-400" />
                    )}
                  </p>
                  <p>• Wallet: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}</p>
                  <p>• Source Chain: {SUPPORTED_CHAINS[form.sourceChain].name}</p>
                  <p>• Destination Chain: {SUPPORTED_CHAINS[form.destinationChain].name}</p>
                  <p>• Smart Routing: {isCrossChain ? 'Cross-Chain Mode' : 'Same-Chain Mode'}</p>
                  {quote && (
                    <p>• Quote Ready: {(parseInt(quote.outputAmount) / 10**6).toFixed(4)} USDC</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Current Status */}
                <div className="bg-[#1F1F1F] border-0 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    {getStatusIcon()}
                    <h3 className="font-semibold text-lg text-[#F2F2F2]">
                      {status.step === 'signing' && 'Transfer'}
                      {status.step === 'bridging' && (isCrossChain ? 'Swap & Bridge' : 'Process')}
                      {status.step === 'settling' && 'Process'}
                      {status.step === 'completed' && 'Process'}
                      {status.step === 'error' && 'Error'}
                    </h3>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-sm text-[#F2F2F2]/70">
                        {status.step === 'completed' ? 'Sent just now' : '0s'}
                      </span>
                      <div className="text-right">
                        <div className="font-semibold text-[#F2F2F2]">${form.amount}</div>
                        <div className="text-sm text-[#F2F2F2]/70">
                          {form.amount} USDC
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status Description */}
                  <p className="text-[#F2F2F2]/90 mb-6">{getStatusText()}</p>

                  {/* Progress Steps */}
                  <div className="space-y-4">
                    {/* Transfer Step */}
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        ['signing', 'bridging', 'settling', 'completed'].includes(status.step) 
                          ? 'bg-[#34D399]' : 'bg-[#171719]'
                      }`}>
                        {['signing', 'bridging', 'settling', 'completed'].includes(status.step) ? (
                          <CheckCircle className="w-4 h-4 text-[#171719]" />
                        ) : (
                          <div className="w-2 h-2 bg-[#F2F2F2]/40 rounded-full" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-[#F2F2F2]">Transfer</div>
                        <div className="text-sm text-[#F2F2F2]/70">Authorize USDC transfer</div>
                      </div>
                    </div>

                    {/* Bridge/Process Step */}
                    <div className="flex items-center gap-4">
                      <div className="w-px h-6 bg-[#F2F2F2]/20 ml-4"></div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        status.step === 'bridging' ? 'bg-[#34D399] animate-pulse' :
                        ['settling', 'completed'].includes(status.step) ? 'bg-[#34D399]' : 'bg-[#171719]'
                      }`}>
                        {status.step === 'bridging' ? (
                          <Flash className="w-4 h-4 text-[#171719]" />
                        ) : ['settling', 'completed'].includes(status.step) ? (
                          <CheckCircle className="w-4 h-4 text-[#171719]" />
                        ) : (
                          <div className="w-2 h-2 bg-[#F2F2F2]/40 rounded-full" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-[#F2F2F2]">
                          {isCrossChain ? 'Swap & Bridge' : 'Process'}
                        </div>
                        <div className="text-sm text-[#F2F2F2]/70">
                          {status.step === 'bridging' ? '0s' : 
                           ['settling', 'completed'].includes(status.step) ? 'Completed' : 'Pending'}
                        </div>
                      </div>
                    </div>

                    {/* Final explicit step removed – status header & explorer link provide completion context */}
                  </div>
                </div>

                {/* Transaction Hash */}
                {status.txHash && (
                  <div className="bg-[#1F1F1F] border-0 rounded-lg p-4">
                    <p className="text-sm font-medium mb-2 text-[#F2F2F2]">Transaction Hash:</p>
                    <a 
                      href={`${(status.executedExplorer || SUPPORTED_CHAINS[form.sourceChain].explorer)}/tx/${status.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-[#34D399] hover:text-[#34D399]/80 break-all underline transition-colors inline-flex items-center gap-1"
                    >
                      <span>{status.txHash}</span>
                      <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                    <p className="text-xs text-[#F2F2F2]/60 mt-1">
                      View on {(status.executedChainName || SUPPORTED_CHAINS[form.sourceChain].name)} Explorer
                    </p>
                  </div>
                )}

                {/* Explorer Link */}
                {status.txHash ? (
                  <a
                    href={`${(status.executedExplorer || SUPPORTED_CHAINS[form.sourceChain].explorer)}/tx/${status.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-block text-center text-[#34D399] hover:text-[#2DB882] underline transition-colors"
                  >
                    View on {(status.executedChainName || SUPPORTED_CHAINS[form.sourceChain].name)} Explorer ↗
                  </a>
                ) : (
                  <button className="w-full text-center text-gray-400" disabled>
                    Waiting for transaction hash…
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
