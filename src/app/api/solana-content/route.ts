import { NextRequest, NextResponse } from "next/server";
import type { PaymentRequirements } from "@/lib/x402";
import type { SolanaFacilitatorInfo } from "@/lib/solana-x402";
import { facilitatorApiUrl } from "@/lib/facilitator-base-url";
import { USDC_DECIMALS, X402_NETWORK } from "@/config/solana";

export const dynamic = "force-dynamic";

const X402_VERSION = 1;
// Price in USDC base units (6 decimals): 10000 = $0.01.
const USDC_AMOUNT = "10000";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function facilitatorError(error: unknown, facilitatorUrl: string) {
  return NextResponse.json(
    {
      error: "Failed to reach the Meridian facilitator",
      errorReason:
        error instanceof Error ? error.message : "Failed to proxy request",
      facilitatorUrl,
      hint: "Check FACILITATOR_URL/NEXT_PUBLIC_FACILITATOR_URL points to a reachable Meridian facilitator (default https://api.mrdn.finance).",
    },
    { status: 500 },
  );
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type EnrichedSolanaFacilitatorInfo = SolanaFacilitatorInfo & {
  usdcMint: string;
  treasury: string;
  treasuryToken: string;
};

type FacilitatorInfoStringField =
  | "network"
  | "facilitator"
  | "programId"
  | "configPda"
  | "usdcMint"
  | "treasury"
  | "treasuryToken";

function requireStringField(
  data: Record<string, unknown>,
  field: FacilitatorInfoStringField,
): string {
  const value = data[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`facilitator info response is missing ${field}`);
  }
  return value;
}

async function getFacilitatorInfo(
  network: string,
): Promise<EnrichedSolanaFacilitatorInfo> {
  const url = facilitatorApiUrl(
    `/v1/solana/facilitator?network=${encodeURIComponent(network)}`,
  );
  const res = await fetch(url, { cache: "no-store" });
  const data = await readJson(res);

  if (!res.ok || data.error) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `facilitator info failed (${res.status})`,
    );
  }

  return {
    network: requireStringField(data, "network"),
    facilitator: requireStringField(data, "facilitator"),
    programId: requireStringField(data, "programId"),
    configPda: requireStringField(data, "configPda"),
    usdcMint: requireStringField(data, "usdcMint"),
    treasury: requireStringField(data, "treasury"),
    treasuryToken: requireStringField(data, "treasuryToken"),
    treasuryFeeBps:
      typeof data.treasuryFeeBps === "number"
        ? data.treasuryFeeBps
        : undefined,
    paused: typeof data.paused === "boolean" ? data.paused : undefined,
  };
}

// The requirements are rebuilt server-side on every request; the buyer never
// dictates pricing, recipient, or settlement config.
async function buildPaymentRequirements(
  request: NextRequest,
): Promise<PaymentRequirements> {
  const facilitatorInfo = await getFacilitatorInfo(X402_NETWORK);
  const payTo = getEnv("NEXT_PUBLIC_SOLANA_PAY_TO");

  return {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: USDC_AMOUNT,
    resource: request.url,
    description: "Access to protected Solana content",
    mimeType: "application/json",
    payTo,
    asset: facilitatorInfo.usdcMint,
    maxTimeoutSeconds: 600,
    extra: {
      name: "USDC",
      decimals: USDC_DECIMALS,
      feePayer: facilitatorInfo.facilitator,
      creditedRecipient: payTo,
      programId: facilitatorInfo.programId,
      configPda: facilitatorInfo.configPda,
      usdcMint: facilitatorInfo.usdcMint,
      treasury: facilitatorInfo.treasury,
      treasuryToken: facilitatorInfo.treasuryToken,
      treasuryFeeBps: facilitatorInfo.treasuryFeeBps,
      paused: facilitatorInfo.paused,
    },
  };
}

function paymentRequired(error: string, paymentRequirements: PaymentRequirements) {
  return NextResponse.json(
    {
      x402Version: X402_VERSION,
      error,
      accepts: [paymentRequirements],
    },
    {
      status: 402,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}

function decodePaymentHeader(header: string): unknown {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

export async function GET(request: NextRequest) {
  const facilitatorUrl = facilitatorApiUrl(
    `/v1/solana/facilitator?network=${encodeURIComponent(X402_NETWORK)}`,
  );

  let paymentRequirements: PaymentRequirements;
  try {
    paymentRequirements = await buildPaymentRequirements(request);
  } catch (error) {
    return facilitatorError(error, facilitatorUrl);
  }

  const paymentHeader = request.headers.get("X-PAYMENT");
  if (!paymentHeader) {
    return paymentRequired("X-PAYMENT header is required", paymentRequirements);
  }

  let paymentPayload: unknown;
  try {
    paymentPayload = decodePaymentHeader(paymentHeader);
  } catch {
    return paymentRequired("Invalid X-PAYMENT header", paymentRequirements);
  }

  // API key of a Meridian organization with a Solana recipient. Server-side
  // only — never expose it with a NEXT_PUBLIC_ prefix.
  const apiKey = process.env.MERIDIAN_SOLANA_API_KEY;
  if (!apiKey) {
    return paymentRequired(
      "MERIDIAN_SOLANA_API_KEY is not configured",
      paymentRequirements,
    );
  }

  const settleUrl = facilitatorApiUrl("/v1/settle");
  try {
    const settleRes = await fetch(settleUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    const settleData = await readJson(settleRes);

    if (!settleRes.ok || settleData.success === false) {
      const reason =
        typeof settleData.error === "string"
          ? settleData.error
          : typeof settleData.errorReason === "string"
            ? settleData.errorReason
            : `settle failed (${settleRes.status})`;
      return paymentRequired(reason, paymentRequirements);
    }

    const paymentResponse = Buffer.from(JSON.stringify(settleData)).toString(
      "base64",
    );
    const signature =
      typeof settleData.transaction === "string" ? settleData.transaction : null;

    return NextResponse.json(
      {
        message: "Protected Solana content unlocked",
        content:
          "This JSON was returned only after a Meridian x402 Solana settlement.",
        network: X402_NETWORK,
        amount: USDC_AMOUNT,
        asset: paymentRequirements.asset,
        payTo: paymentRequirements.payTo,
        signature,
        settle: settleData,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-PAYMENT-RESPONSE": paymentResponse,
        },
      },
    );
  } catch (error) {
    return facilitatorError(error, settleUrl);
  }
}
