import { NextRequest, NextResponse } from "next/server";

// Types matching the working example
interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: "base-sepolia";
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

interface PaymentRequirements {
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

interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      paymentPayload,
      paymentRequirements,
    }: {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    } = body;

    // Validate required fields
    if (!paymentPayload || !paymentRequirements) {
      return NextResponse.json(
        { error: "Missing paymentPayload or paymentRequirements" },
        { status: 400 }
      );
    }

    // Get facilitator URL from environment
    const facilitatorUrl =
      process.env.NEXT_PUBLIC_FACILITATOR_URL || "http://localhost:4021";

    // Call the facilitator's verify endpoint
    const verifyResponse = await fetch(`${facilitatorUrl}/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentPayload: paymentPayload as PaymentPayload,
        paymentRequirements: paymentRequirements as PaymentRequirements,
      }),
    });

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      return NextResponse.json(
        { error: "Facilitator verification failed", details: errorData },
        { status: verifyResponse.status }
      );
    }

    const verifyResult: VerifyResponse = await verifyResponse.json();

    // Return the verification result
    return NextResponse.json(verifyResult);
  } catch (error) {
    console.error("Error in x402 verify route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET method to provide API documentation
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/x402/verify",
    method: "POST",
    description: "Verify x402 payment with the facilitator",
    body: {
      paymentPayload: "Payment payload object with signature and authorization",
      paymentRequirements:
        "Payment requirements object with amount, recipient, etc.",
    },
    response: {
      isValid: "boolean - whether the payment is valid",
      invalidReason: "string - reason for invalidation if applicable",
      payer: "string - address of the payer",
    },
    example: {
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          signature: "0x...",
          authorization: {
            from: "0x...",
            to: "0x...",
            value: "1500000",
            validAfter: "1234567890",
            validBefore: "1234567890",
            nonce:
              "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
      },
      paymentRequirements: {
        amount: "1500000",
        recipient: "0x...",
        network: "base-sepolia",
        scheme: "exact",
        maxAmountRequired: "1500000",
        resource: "https://demo.meridian.com/access",
        mimeType: "application/json",
        payTo: "0x...",
        maxTimeoutSeconds: 3600,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
    },
  });
}
