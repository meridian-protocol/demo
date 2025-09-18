import { Address } from "viem";
import { paymentMiddleware, Resource, Network } from "x402-next";

const contractAddress = process.env.CONTRACT_ADDRESS as Address;
const network = process.env.NETWORK as Network;
const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL as Resource;

export const middleware = paymentMiddleware(
  contractAddress,
  {
    "/protected": {
      price: "$0.01",
      config: {
        description: "Access to protected content Test",
      },
      network,
    },
  },
  {
    url: facilitatorUrl,
    createAuthHeaders: async () => {
      return {
        verify: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
        },
        settle: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_MERIDIAN_PK}`,
        },
      };
    },
  },
  {
    appLogo: "https://via.placeholder.com/64x64.png?text=X402",
    appName: "x402 Demo",
  }
);

// Configure which paths the middleware should run on
export const config = {
  matcher: ["/protected/:path*"],
};
