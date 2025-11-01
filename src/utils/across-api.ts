import { createPublicClient, http } from "viem";
import { baseSepolia, optimismSepolia } from "viem/chains";

export interface AcrossQuoteParams {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  originChainId: number;
  destinationChainId: number;
  recipient?: string;
  message?: string;
}

export interface AcrossQuoteResponse {
  outputAmount: string;
  bridgeFee: string;
  lpFee: string;
  relayerCapitalFee: string;
  relayerGasFee: string;
  totalRelayFee: string;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  suggestedRelayerFeePct: string;
  isAmountTooLow: boolean;
  spokePoolAddress: string;
}

export interface AcrossDepositParams {
  destinationChainId: bigint;
  outputAmount: bigint;
  quoteTimestamp: number;
  fillDeadline: number;
}

/**
 * Get a quote from the Across API for cross-chain transfers
 * Uses the /suggested-fees endpoint with exactInput tradeType
 * Proxied through our API route to avoid CORS issues
 */
export async function getAcrossQuote(params: AcrossQuoteParams): Promise<AcrossQuoteResponse> {
  const searchParams = new URLSearchParams({
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    originChainId: params.originChainId.toString(),
    destinationChainId: params.destinationChainId.toString(),
    // Always use exactInput as specified
    tradeType: 'exactInput',
    ...(params.recipient && { recipient: params.recipient }),
    ...(params.message && { message: params.message })
  });

  // Use our API route to avoid CORS issues
  const response = await fetch(`/api/across-quote?${searchParams}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Across API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Extract exact fields from Across API response as documented
  return {
    outputAmount: data.outputAmount,
    bridgeFee: data.totalRelayFee?.total || data.relayFeeTotal || "0",
    lpFee: data.lpFee?.total || "0",
    relayerCapitalFee: data.relayerCapitalFee?.total || data.capitalFeeTotal || "0",
    relayerGasFee: data.relayerGasFee?.total || data.relayGasFeeTotal || "0",
    totalRelayFee: data.totalRelayFee?.total || data.relayFeeTotal || "0",
    quoteTimestamp: parseInt(data.timestamp),
    fillDeadline: parseInt(data.fillDeadline),
    exclusivityDeadline: data.exclusivityDeadline || 0,
    suggestedRelayerFeePct: data.relayFeePct || data.relayFeePercent || "0",
    isAmountTooLow: data.isAmountTooLow || false,
    spokePoolAddress: data.spokePoolAddress || ""
  };
}

/**
 * Create a mock quote for development/testing when the real API is not available
 */
export function createMockAcrossQuote(
  inputAmount: string
  // originChainId and destinationChainId kept for API compatibility
): AcrossQuoteResponse {
  const inputAmountBig = BigInt(inputAmount);
  const bridgeFeeBps = BigInt(50); // 0.5% bridge fee
  const bridgeFee = (inputAmountBig * bridgeFeeBps) / BigInt(10000);
  const outputAmount = inputAmountBig - bridgeFee;

  return {
    outputAmount: outputAmount.toString(),
    bridgeFee: bridgeFee.toString(),
    lpFee: "0",
    relayerCapitalFee: "0",
    relayerGasFee: bridgeFee.toString(),
    totalRelayFee: bridgeFee.toString(),
    quoteTimestamp: Math.floor(Date.now() / 1000),
    fillDeadline: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
    exclusivityDeadline: 0,
    suggestedRelayerFeePct: "0.5",
    isAmountTooLow: false,
    spokePoolAddress: ""
  };
}

/**
 * Get Across deposit parameters for the V2 contract call with proper validation
 */
export async function getDepositParams(
  quote: AcrossQuoteResponse, 
  destinationChainId: number,
  originChainId: number
): Promise<AcrossDepositParams> {
  // Validate quoteTimestamp according to contract requirements
  const validatedQuoteTimestamp = await validateQuoteTimestamp(
    quote.quoteTimestamp,
    originChainId,
    quote.spokePoolAddress
  );

  // Validate fillDeadline according to contract requirements
  const validatedFillDeadline = await validateFillDeadline(
    quote.fillDeadline,
    originChainId,
    quote.spokePoolAddress
  );

  return {
    destinationChainId: BigInt(destinationChainId),
    outputAmount: BigInt(quote.outputAmount),
    quoteTimestamp: validatedQuoteTimestamp,
    fillDeadline: validatedFillDeadline
  };
}

/**
 * Get the current timestamp from a chain (for quoteTimestamp validation)
 * Calls the read-only function getCurrentTime() on the origin chain
 */
export async function getCurrentTime(chainId: number, spokePoolAddress: string): Promise<number> {
  try {
    const client = createPublicClient({
      chain: chainId === 84532 ? baseSepolia : optimismSepolia,
      transport: http()
    });

    const currentTime = await client.readContract({
      address: spokePoolAddress as `0x${string}`,
      abi: [{
        name: "getCurrentTime",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }]
      }],
      functionName: "getCurrentTime"
    });

    return Number(currentTime);
  } catch (error) {
    console.warn("Failed to get getCurrentTime from contract, using local time:", error);
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Get the deposit quote time buffer from a chain
 * Calls the read-only function depositQuoteTimeBuffer() on the origin chain
 */
export async function getDepositQuoteTimeBuffer(chainId: number, spokePoolAddress: string): Promise<number> {
  try {
    const client = createPublicClient({
      chain: chainId === 84532 ? baseSepolia : optimismSepolia,
      transport: http()
    });

    const buffer = await client.readContract({
      address: spokePoolAddress as `0x${string}`,
      abi: [{
        name: "depositQuoteTimeBuffer",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }]
      }],
      functionName: "depositQuoteTimeBuffer"
    });

    return Number(buffer);
  } catch (error) {
    console.warn("Failed to get depositQuoteTimeBuffer from contract, using default:", error);
    return 600; // 10 minutes default
  }
}

/**
 * Get the fill deadline buffer from a chain
 * Calls the read-only function fillDeadlineBuffer() on the origin chain
 */
export async function getFillDeadlineBuffer(chainId: number, spokePoolAddress: string): Promise<number> {
  try {
    const client = createPublicClient({
      chain: chainId === 84532 ? baseSepolia : optimismSepolia,
      transport: http()
    });

    const buffer = await client.readContract({
      address: spokePoolAddress as `0x${string}`,
      abi: [{
        name: "fillDeadlineBuffer",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }]
      }],
      functionName: "fillDeadlineBuffer"
    });

    return Number(buffer);
  } catch (error) {
    console.warn("Failed to get fillDeadlineBuffer from contract, using default:", error);
    return 1800; // 30 minutes default
  }
}

/**
 * Validate and adjust quoteTimestamp according to contract requirements
 * quoteTimestamp must be <= currentTime + buffer and >= currentTime - buffer
 */
export async function validateQuoteTimestamp(
  quoteTimestamp: number,
  chainId: number,
  spokePoolAddress: string
): Promise<number> {
  const currentTime = await getCurrentTime(chainId, spokePoolAddress);
  const buffer = await getDepositQuoteTimeBuffer(chainId, spokePoolAddress);
  
  const minTime = currentTime - buffer;
  const maxTime = currentTime + buffer;
  
  // Ensure quoteTimestamp is within the valid range
  if (quoteTimestamp < minTime) {
    return minTime;
  } else if (quoteTimestamp > maxTime) {
    return maxTime;
  }
  
  return quoteTimestamp;
}

/**
 * Validate and adjust fillDeadline according to contract requirements
 * Must be set between [currentTime, currentTime + fillDeadlineBuffer] where currentTime is block.timestamp on this chain
 */
export async function validateFillDeadline(
  fillDeadline: number,
  chainId: number,
  spokePoolAddress: string
): Promise<number> {
  const currentTime = await getCurrentTime(chainId, spokePoolAddress);
  const buffer = await getFillDeadlineBuffer(chainId, spokePoolAddress);
  
  const minTime = currentTime;
  const maxTime = currentTime + buffer;
  
  // Ensure fillDeadline is within the valid range
  if (fillDeadline < minTime) {
    return minTime;
  } else if (fillDeadline > maxTime) {
    return maxTime;
  }
  
  return fillDeadline;
}

/**
 * Read USDC EIP-3009 domain fields from the token to avoid hardcoding
 */
export async function getUsdcDomain(
  chainId: number,
  tokenAddress: string
): Promise<{ name: string; version: string }> {
  const client = createPublicClient({
    chain: chainId === 84532 ? baseSepolia : optimismSepolia,
    transport: http()
  });

  try {
    const [name, version] = await Promise.all([
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: [{ name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
        functionName: "name"
      }) as Promise<string>,
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: [{ name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
        functionName: "version"
      }) as Promise<string>
    ]);

    return { name, version };
  } catch {
    // Fallback to known USDC defaults if token does not expose one of the fields
    return { name: "USD Coin", version: "2" };
  }
}
