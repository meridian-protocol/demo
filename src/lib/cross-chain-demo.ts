import { defineChain, type Address, type Chain } from "viem";
import { base, optimism } from "viem/chains";

export type CrossChainDemoNetwork = "base" | "ink" | "optimism";

export type CrossChainDemoNetworkConfig = {
  network: CrossChainDemoNetwork;
  chainId: number;
  name: string;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  facilitator: Address;
  explorerUrl: string;
  rpcUrls: readonly string[];
};

export const CROSS_CHAIN_DESTINATION_NETWORK = "base";
export const CROSS_CHAIN_DESTINATION_CHAIN_ID = 8453;
export const CROSS_CHAIN_DEMO_AMOUNT = "10000"; // $0.01 USDC, exact input.

export const CROSS_CHAIN_DEMO_NETWORKS: Record<
  CrossChainDemoNetwork,
  CrossChainDemoNetworkConfig
> = {
  base: {
    network: "base",
    chainId: 8453,
    name: "Base",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenName: "USD Coin",
    tokenVersion: "2",
    facilitator: "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6",
    explorerUrl: "https://basescan.org",
    rpcUrls: ["https://mainnet.base.org"],
  },
  ink: {
    network: "ink",
    chainId: 57073,
    name: "Ink",
    token: "0x2D270e6886d130D724215A266106e6832161EAEd",
    tokenName: "USD Coin",
    tokenVersion: "2",
    facilitator: "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6",
    explorerUrl: "https://explorer.inkonchain.com",
    rpcUrls: ["https://rpc-gel.inkonchain.com"],
  },
  optimism: {
    network: "optimism",
    chainId: 10,
    name: "Optimism",
    token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    tokenName: "USD Coin",
    tokenVersion: "2",
    facilitator: "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6",
    explorerUrl: "https://optimistic.etherscan.io",
    rpcUrls: ["https://mainnet.optimism.io"],
  },
};

export const CROSS_CHAIN_DEMO_SOURCE_NETWORKS = Object.keys(
  CROSS_CHAIN_DEMO_NETWORKS,
) as CrossChainDemoNetwork[];

export const ink = defineChain({
  id: CROSS_CHAIN_DEMO_NETWORKS.ink.chainId,
  name: CROSS_CHAIN_DEMO_NETWORKS.ink.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [...CROSS_CHAIN_DEMO_NETWORKS.ink.rpcUrls] },
    public: { http: [...CROSS_CHAIN_DEMO_NETWORKS.ink.rpcUrls] },
  },
  blockExplorers: {
    default: {
      name: "Ink Explorer",
      url: CROSS_CHAIN_DEMO_NETWORKS.ink.explorerUrl,
    },
  },
});

export const CROSS_CHAIN_DEMO_CHAINS: Record<number, Chain> = {
  [base.id]: base,
  [optimism.id]: optimism,
  [ink.id]: ink,
};

export function getCrossChainDemoChain(chainId: number): Chain {
  return (
    CROSS_CHAIN_DEMO_CHAINS[chainId] ?? {
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: [] },
        public: { http: [] },
      },
    }
  );
}

export function getCrossChainDemoNetworkByChainId(
  chainId: number,
): CrossChainDemoNetworkConfig | undefined {
  return CROSS_CHAIN_DEMO_SOURCE_NETWORKS.map(
    (network) => CROSS_CHAIN_DEMO_NETWORKS[network],
  ).find((network) => network.chainId === chainId);
}

