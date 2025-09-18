import { createConfig } from "wagmi";
import { baseSepolia, mainnet } from "wagmi/chains";
import { http } from "viem";

// Define chains first
export const chains = [mainnet, baseSepolia] as const;

// Set up wagmi config with minimal configuration
export const config = createConfig({
  chains,
  transports: {
    [mainnet.id]: http(),
    [baseSepolia.id]: http(),
  },
});
