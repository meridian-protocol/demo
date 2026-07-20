import Link from "next/link";

export function MeridianHeader() {
  return (
    <header className="relative z-20 bg-[var(--background)]">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-center px-6 xl:h-16">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Meridian Demo home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/meridian-logo.svg"
            alt=""
            className="h-7 w-7 xl:h-8 xl:w-8"
          />
          <span className="font-funnel-display text-base font-medium text-[var(--pay-title)] xl:text-lg">
            Meridian
          </span>
        </Link>
      </div>
    </header>
  );
}
