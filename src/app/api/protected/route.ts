import { NextRequest, NextResponse } from "next/server";
import { buildPaymentRequirements } from "@/lib/protected-demo";
import { facilitatorApiUrl } from "@/lib/facilitator-base-url";

export const dynamic = "force-dynamic";

const x402Version = 1;

interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

function getMeridianApiKey(): string | undefined {
  return (
    process.env.MERIDIAN_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_MERIDIAN_PK?.trim()
  );
}

function challenge(resource: string, error?: string) {
  return NextResponse.json(
    {
      x402Version,
      ...(error ? { error } : {}),
      accepts: [buildPaymentRequirements(resource)],
    },
    { status: 402, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

// Unpaid request: return the 402 challenge.
export async function GET(request: NextRequest) {
  const resource = `${request.nextUrl.origin}${request.nextUrl.pathname}`;
  return challenge(resource);
}

// Paid retry: validate the signed payload against the server-side
// requirement, then settle through Meridian. The API key never leaves
// the server.
export async function POST(request: NextRequest) {
  const resource = `${request.nextUrl.origin}${request.nextUrl.pathname}`;

  let paymentPayload: PaymentPayload | undefined;
  try {
    ({ paymentPayload } = (await request.json()) as {
      paymentPayload?: PaymentPayload;
    });
  } catch {
    return challenge(resource, "Request body must be JSON");
  }

  if (!paymentPayload?.payload?.authorization) {
    return challenge(resource, "Missing paymentPayload");
  }

  // Never trust buyer-supplied pricing, recipient, network, or token data.
  // Rebuild the requirement server-side and validate the payload against it.
  const paymentRequirements = buildPaymentRequirements(resource);

  if (paymentPayload.network !== paymentRequirements.network) {
    return challenge(
      resource,
      "Payment network does not match the server requirement",
    );
  }

  if (
    paymentPayload.payload.authorization.to.toLowerCase() !==
    paymentRequirements.payTo.toLowerCase()
  ) {
    return challenge(resource, "Payment must authorize the Meridian facilitator");
  }

  if (
    paymentPayload.payload.authorization.value !==
    paymentRequirements.maxAmountRequired
  ) {
    return challenge(resource, "Payment amount does not match the server price");
  }

  const meridianApiKey = getMeridianApiKey();
  if (!meridianApiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing MERIDIAN_API_KEY. Set it in .env.local before settling payments.",
      },
      { status: 500 },
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
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
  } catch (settleError) {
    return NextResponse.json(
      {
        success: false,
        error: `Unable to reach the Meridian facilitator at ${settleUrl}. Set FACILITATOR_URL/NEXT_PUBLIC_FACILITATOR_URL to a reachable endpoint.`,
        cause:
          settleError instanceof Error
            ? settleError.message
            : "Facilitator request failed",
      },
      { status: 502 },
    );
  }

  const settlement = (await settleResponse.json().catch(() => ({
    success: false,
    errorReason: "unexpected_settle_error",
  }))) as {
    success?: boolean;
    transaction?: string;
    network?: string;
    payer?: string;
    error?: string;
    errorReason?: string;
  };

  if (!settleResponse.ok || !settlement.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          settlement.error ||
          settlement.errorReason ||
          "Meridian settlement failed",
        settlement,
      },
      { status: settleResponse.ok ? 402 : settleResponse.status },
    );
  }

  // Payment settled: serve the protected content.
  return NextResponse.json({
    success: true,
    message: "Same-chain x402 payment settled on Base Sepolia",
    content: {
      title: "Protected content",
      body: "This response is only served after a settled x402 payment.",
    },
    settlement,
  });
}
