import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 text-[var(--foreground)] xl:min-h-[calc(100vh-4rem)]">
      <div className="w-full max-w-3xl">
        <p className="mb-3 font-funnel-display text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Developer demo
        </p>
        <h1 className="mb-4 font-funnel-display text-4xl font-semibold tracking-tight md:text-5xl">
          x402 payment examples
        </h1>
        <p className="mb-8 max-w-2xl text-sm leading-6 text-[var(--text-secondary)] md:text-base">
          Start with a manual same-chain x402 flow, then inspect the cross-chain
          flow where the seller returns several source-chain payment
          requirements.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/cross-chain"
            className="rounded-2xl bg-[var(--accent)] px-5 py-4 text-sm font-semibold text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Cross-chain x402
          </Link>
          <Link
            href="/protected"
            className="rounded-2xl bg-[var(--card-bg)] px-5 py-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--pay-section-bg)]"
          >
            Manual same-chain x402
          </Link>
          <Link
            href="/protected_solana"
            className="rounded-2xl bg-[var(--card-bg)] px-5 py-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--pay-section-bg)] md:col-span-2"
          >
            Solana protected route
          </Link>
        </div>
      </div>
    </div>
  );
}
