"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { SolanaWalletConnect } from "@/components/solana-wallet-connect";
import { explorerTxUrl } from "@/config/solana";
import {
  buildSettleTransaction,
  fetchFacilitatorConfig,
  type SolanaFacilitatorInfo,
} from "@/lib/solana-x402";
import type { PaymentRequirements } from "@/lib/x402";

type Step = "idle" | "requesting" | "challenge" | "signing" | "paying" | "unlocked";

type ProtectedContent = {
  message?: string;
  content?: string;
  signature?: string | null;
  settle?: {
    transaction?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ChallengeResponse = {
  x402Version?: number;
  error?: string;
  accepts?: PaymentRequirements[];
};

const steps: Array<{ key: Step; label: string }> = [
  { key: "requesting", label: "Requesting" },
  { key: "challenge", label: "402 received" },
  { key: "signing", label: "Signing" },
  { key: "paying", label: "Paying" },
  { key: "unlocked", label: "Unlocked" },
];

function encodeBase64(value: string): string {
  return btoa(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64Json<T>(value: string): T | null {
  try {
    return JSON.parse(atob(value)) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getExtraString(
  requirements: PaymentRequirements,
  key: string,
): string {
  const value = requirements.extra?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`payment requirements missing extra.${key}`);
  }
  return value;
}

function getExtraNumber(
  requirements: PaymentRequirements,
  key: string,
): number | undefined {
  const value = requirements.extra?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`payment requirements extra.${key} must be a number`);
  }
  return value;
}

function getExtraBoolean(
  requirements: PaymentRequirements,
  key: string,
): boolean | undefined {
  const value = requirements.extra?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`payment requirements extra.${key} must be a boolean`);
  }
  return value;
}

function getSolanaFacilitatorInfo(
  requirements: PaymentRequirements,
): SolanaFacilitatorInfo {
  return {
    network: requirements.network,
    facilitator: getExtraString(requirements, "feePayer"),
    programId: getExtraString(requirements, "programId"),
    configPda: getExtraString(requirements, "configPda"),
    usdcMint: getExtraString(requirements, "usdcMint"),
    treasury: getExtraString(requirements, "treasury"),
    treasuryToken: getExtraString(requirements, "treasuryToken"),
    treasuryFeeBps: getExtraNumber(requirements, "treasuryFeeBps"),
    paused: getExtraBoolean(requirements, "paused"),
  };
}

function parseChallenge(body: unknown): ChallengeResponse {
  if (!isRecord(body)) {
    throw new Error("invalid 402 response");
  }
  const accepts = Array.isArray(body.accepts)
    ? (body.accepts as PaymentRequirements[])
    : undefined;
  return {
    x402Version:
      typeof body.x402Version === "number" ? body.x402Version : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
    accepts,
  };
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ProtectedSolanaPage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [step, setStep] = useState<Step>("idle");
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [content, setContent] = useState<ProtectedContent | null>(null);
  const [paymentResponse, setPaymentResponse] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeStepIndex = useMemo(() => {
    if (step === "idle") return -1;
    return steps.findIndex((item) => item.key === step);
  }, [step]);

  const signature =
    content?.signature ??
    content?.settle?.transaction ??
    (typeof paymentResponse?.transaction === "string"
      ? paymentResponse.transaction
      : null);

  const isBusy =
    step === "requesting" || step === "signing" || step === "paying";

  const requestProtectedContent = async () => {
    setStep("requesting");
    setChallenge(null);
    setContent(null);
    setPaymentResponse(null);
    setError(null);

    try {
      const firstResponse = await fetch("/api/solana-content", {
        cache: "no-store",
      });
      const firstBody = await firstResponse.json().catch(() => ({}));

      if (firstResponse.status !== 402) {
        if (firstResponse.ok) {
          setContent(firstBody as ProtectedContent);
          setStep("unlocked");
          return;
        }
        throw new Error(
          isRecord(firstBody) && typeof firstBody.error === "string"
            ? firstBody.error
            : `request failed (${firstResponse.status})`,
        );
      }

      const parsedChallenge = parseChallenge(firstBody);
      const requirements = parsedChallenge.accepts?.[0];
      if (!requirements) {
        throw new Error("402 response did not include payment requirements");
      }
      setChallenge(parsedChallenge);
      setStep("challenge");

      if (!wallet.publicKey || !wallet.signTransaction) {
        setError("Connect a Solana wallet to sign the payment.");
        return;
      }

      const config = await fetchFacilitatorConfig(
        getSolanaFacilitatorInfo(requirements),
      );
      if (config.paused) {
        throw new Error("Solana x402 program is paused");
      }

      const feePayer = new PublicKey(getExtraString(requirements, "feePayer"));
      if (!feePayer.equals(config.facilitator)) {
        throw new Error("402 facilitator does not match facilitator info");
      }
      const asset = new PublicKey(requirements.asset);
      if (!asset.equals(config.usdcMint)) {
        throw new Error("402 asset does not match facilitator USDC mint");
      }

      setStep("signing");
      const tx = await buildSettleTransaction({
        connection,
        config,
        from: wallet.publicKey,
        recipient: new PublicKey(requirements.payTo),
        value: BigInt(requirements.maxAmountRequired),
        platform: undefined,
        platformFeeBps: 0,
        facilitator: feePayer,
      });

      const signed = await wallet.signTransaction(tx);
      const transaction = bytesToBase64(
        signed.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      );
      const paymentPayload = {
        x402Version: parsedChallenge.x402Version ?? 1,
        scheme: "exact",
        network: requirements.network,
        payload: { transaction },
      };
      const paymentHeader = encodeBase64(JSON.stringify(paymentPayload));

      setStep("paying");
      const paidResponse = await fetch("/api/solana-content", {
        cache: "no-store",
        headers: {
          "X-PAYMENT": paymentHeader,
        },
      });
      const paidBody = await paidResponse.json().catch(() => ({}));

      if (!paidResponse.ok) {
        const reason =
          isRecord(paidBody) && typeof paidBody.error === "string"
            ? paidBody.error
            : `payment retry failed (${paidResponse.status})`;
        throw new Error(reason);
      }

      const responseHeader = paidResponse.headers.get("X-PAYMENT-RESPONSE");
      setPaymentResponse(
        responseHeader
          ? decodeBase64Json<Record<string, unknown>>(responseHeader)
          : null,
      );
      setContent(paidBody as ProtectedContent);
      setStep("unlocked");
    } catch (err) {
      // Some wallet/SDK errors (e.g. TokenOwnerOffCurveError) carry an empty
      // message; fall back so the failure is always visible instead of a blank
      // error box.
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Solana payment failed";
      setError(message);
      // Leave the flow in a non-busy, retryable state rather than a stuck
      // "Processing..." step. Keep the 402 view if the challenge was fetched.
      setStep((current) => (current === "requesting" ? "idle" : "challenge"));
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col justify-center gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 font-mono text-sm uppercase tracking-[0.2em] text-purple-300">
              Meridian x402
            </p>
            <h1 className="text-4xl font-bold tracking-normal">
              Solana Protected Route
            </h1>
          </div>
          <div className="self-start sm:self-center">
            <SolanaWalletConnect />
          </div>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5 grid gap-2 sm:grid-cols-5">
            {steps.map((item, index) => {
              const reached = activeStepIndex >= index;
              const current = step === item.key;
              return (
                <div
                  key={item.key}
                  className={`rounded-md border px-3 py-2 text-center text-xs font-semibold transition ${
                    reached
                      ? "border-purple-400/70 bg-purple-500/20 text-purple-100"
                      : "border-white/10 bg-black/20 text-gray-500"
                  } ${current ? "ring-2 ring-purple-300/40" : ""}`}
                >
                  {item.label}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={requestProtectedContent}
              disabled={isBusy}
              className="w-full rounded-md bg-purple-600 px-5 py-3 font-mono text-base font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-900/50 disabled:text-purple-200/50"
            >
              {isBusy ? "Processing..." : "Request Protected Content"}
            </button>

            {wallet.publicKey && (
              <div className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                Wallet connected: {shortAddress(wallet.publicKey.toBase58())}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </section>

        {challenge?.accepts?.[0] && (
          <section className="rounded-lg border border-purple-300/20 bg-purple-500/10 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">402 Requirements</h2>
              <span className="rounded-md bg-black/30 px-2 py-1 font-mono text-xs text-purple-100">
                {challenge.accepts[0].network}
              </span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-400">Amount</dt>
                <dd className="font-mono text-white">
                  {challenge.accepts[0].maxAmountRequired} USDC base units
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Asset</dt>
                <dd className="break-all font-mono text-white">
                  {challenge.accepts[0].asset}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Recipient</dt>
                <dd className="break-all font-mono text-white">
                  {challenge.accepts[0].payTo}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Fee payer</dt>
                <dd className="break-all font-mono text-white">
                  {String(challenge.accepts[0].extra?.feePayer ?? "")}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {content && (
          <section className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-5">
            <h2 className="mb-2 text-2xl font-bold text-emerald-100">
              {content.message ?? "Unlocked"}
            </h2>
            {content.content && (
              <p className="mb-4 text-emerald-50">{content.content}</p>
            )}
            {signature && (
              <a
                href={explorerTxUrl(signature)}
                target="_blank"
                rel="noreferrer"
                className="mb-4 block break-all font-mono text-sm text-emerald-200 underline underline-offset-4"
              >
                View settlement {signature}
              </a>
            )}
            <pre className="max-h-72 overflow-auto rounded-md bg-black/35 p-3 text-xs text-gray-200">
              {JSON.stringify(content, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
