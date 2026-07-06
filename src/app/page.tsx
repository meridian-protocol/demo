import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1115] px-6 text-white">
      <div className="w-full max-w-3xl">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">
          Meridian developer demo
        </p>
        <h1 className="mb-4 text-4xl font-semibold">x402 payment examples</h1>
        <p className="mb-8 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
          Start with a manual same-chain x402 flow, then inspect the cross-chain
          flow where the seller returns several source-chain payment
          requirements.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/cross-chain"
            className="rounded-lg border border-emerald-300/30 bg-emerald-300 px-5 py-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-200"
          >
            Cross-chain x402
          </Link>
          <Link
            href="/protected"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-semibold text-white transition-colors hover:border-white/30"
          >
            Manual same-chain x402
          </Link>
        </div>
      </div>
    </div>
  );
}
