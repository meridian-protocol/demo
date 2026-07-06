import type { Address } from "viem";
import type { PaymentRequirements } from "./x402";
import {
  CROSS_CHAIN_DEMO_AMOUNT,
  CROSS_CHAIN_DEMO_NETWORKS,
  CROSS_CHAIN_DEMO_SOURCE_NETWORKS,
  CROSS_CHAIN_DESTINATION_CHAIN_ID,
} from "./cross-chain-demo";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function getPaymentAmount(): string {
  return process.env.CROSS_CHAIN_DEMO_AMOUNT ?? CROSS_CHAIN_DEMO_AMOUNT;
}

function getCreditedRecipient(): Address | undefined {
  const recipient = process.env.CROSS_CHAIN_CREDITED_RECIPIENT?.trim();

  if (!recipient) {
    return undefined;
  }

  if (!EVM_ADDRESS_PATTERN.test(recipient)) {
    throw new Error("CROSS_CHAIN_CREDITED_RECIPIENT must be an EVM address");
  }

  return recipient as Address;
}

export function buildCrossChainPaymentRequirements(
  resource: string,
): PaymentRequirements[] {
  const amount = getPaymentAmount();
  const creditedRecipient = getCreditedRecipient();

  return CROSS_CHAIN_DEMO_SOURCE_NETWORKS.map((sourceNetwork) => {
    const source = CROSS_CHAIN_DEMO_NETWORKS[sourceNetwork];

    return {
      scheme: "exact",
      network: source.network,
      maxAmountRequired: amount,
      resource,
      description: `Developer demo payment from ${source.name} to Base`,
      mimeType: "application/json",
      payTo: source.facilitator,
      maxTimeoutSeconds: 300,
      asset: source.token,
      extra: {
        name: source.tokenName,
        version: source.tokenVersion,
        destinationChainId: CROSS_CHAIN_DESTINATION_CHAIN_ID,
        ...(creditedRecipient ? { creditedRecipient } : {}),
      },
    };
  });
}

