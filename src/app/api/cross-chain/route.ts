import { NextRequest, NextResponse } from "next/server";
import {
  decodePayment,
  findMatchingPaymentRequirements,
  safeBase64Encode,
  toJsonSafe,
  type PaymentPayload,
  type SettleResponse,
} from "@/lib/x402";
import { buildCrossChainPaymentRequirements } from "@/lib/cross-chain-requirements";
import { facilitatorApiUrl } from "@/lib/facilitator-base-url";

export const dynamic = "force-dynamic";

const x402Version = 1;

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers?: HeadersInit,
) {
  return NextResponse.json(toJsonSafe(body), {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(headers ?? {}),
    },
  });
}

function challenge(resource: string, error?: string, payer?: string) {
  return jsonResponse(
    {
      x402Version,
      ...(error ? { error } : {}),
      ...(payer ? { payer } : {}),
      accepts: buildCrossChainPaymentRequirements(resource),
    },
    402,
  );
}

function getMeridianApiKey(): string | undefined {
  return (
    process.env.MERIDIAN_API_KEY?.trim() ||
    process.env.MERIDIAN_SK?.trim() ||
    process.env.NEXT_PUBLIC_MERIDIAN_PK?.trim()
  );
}

function validatePaymentPayload(
  paymentPayload: PaymentPayload,
  paymentRequirements: ReturnType<typeof buildCrossChainPaymentRequirements>[number],
) {
  if (!("authorization" in paymentPayload.payload)) {
    return "Expected an EIP-3009 payment payload";
  }

  if (
    paymentPayload.payload.authorization.to.toLowerCase() !==
    paymentRequirements.payTo.toLowerCase()
  ) {
    return "Payment authorization must target the Meridian facilitator";
  }

  if (
    paymentPayload.payload.authorization.value !==
    paymentRequirements.maxAmountRequired
  ) {
    return "Payment amount does not match the selected route";
  }

  return undefined;
}

export async function GET(request: NextRequest) {
  const resource = `${request.nextUrl.origin}${request.nextUrl.pathname}`;
  const paymentHeader = request.headers.get("X-PAYMENT");

  if (!paymentHeader) {
    return challenge(resource, "X-PAYMENT header is required");
  }

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePayment(paymentHeader);
    paymentPayload.x402Version = x402Version;
  } catch (error) {
    return challenge(
      resource,
      error instanceof Error ? error.message : "Invalid payment header",
    );
  }

  const paymentRequirements = findMatchingPaymentRequirements(
    buildCrossChainPaymentRequirements(resource),
    paymentPayload,
  );

  if (!paymentRequirements) {
    return challenge(
      resource,
      "No payment requirement matched the signed source-chain payment",
      "authorization" in paymentPayload.payload
        ? paymentPayload.payload.authorization.from
        : undefined,
    );
  }

  const invalidReason = validatePaymentPayload(
    paymentPayload,
    paymentRequirements,
  );
  if (invalidReason) {
    return challenge(
      resource,
      invalidReason,
      "authorization" in paymentPayload.payload
        ? paymentPayload.payload.authorization.from
        : undefined,
    );
  }

  const meridianApiKey = getMeridianApiKey();
  if (!meridianApiKey) {
    return jsonResponse(
      {
        success: false,
        error:
          "Missing MERIDIAN_API_KEY. Set it in .env.local before settling payments.",
      },
      500,
    );
  }

  const settleUrl = facilitatorApiUrl("/v1/settle");
  let settleResponse: Response;

  try {
    settleResponse = await fetch(settleUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${meridianApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements,
      }),
    });
  } catch (settleError) {
    return jsonResponse(
      {
        success: false,
        error: `Unable to reach the Meridian facilitator at ${settleUrl}. Set FACILITATOR_URL/NEXT_PUBLIC_FACILITATOR_URL to a reachable endpoint.`,
        cause:
          settleError instanceof Error
            ? settleError.message
            : "Facilitator request failed",
        accepts: buildCrossChainPaymentRequirements(resource),
      },
      502,
    );
  }

  const settlement = (await settleResponse.json().catch(() => ({
    success: false,
    errorReason: "unexpected_settle_error",
    transaction: "",
    network: paymentPayload.network,
  }))) as SettleResponse & { error?: string };

  if (!settleResponse.ok || !settlement.success) {
    return jsonResponse(
      {
        success: false,
        error:
          settlement.error ||
          settlement.errorReason ||
          "Meridian settlement failed",
        settlement,
        accepts: buildCrossChainPaymentRequirements(resource),
      },
      settleResponse.ok ? 402 : settleResponse.status,
    );
  }

  return jsonResponse(
    {
      success: true,
      message: "Cross-chain x402 payment settled",
      selectedRoute: {
        sourceNetwork: paymentRequirements.network,
        destinationChainId: paymentRequirements.extra?.destinationChainId,
      },
      settlement,
    },
    200,
    {
      "X-PAYMENT-RESPONSE": safeBase64Encode(JSON.stringify(settlement)),
      "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
    },
  );
}
