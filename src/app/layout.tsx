import type { Metadata } from "next";
import { Funnel_Display, Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { MeridianHeader } from "@/components/meridian-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const funnelDisplay = Funnel_Display({
  variable: "--font-funnel-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meridian Developer Demo",
  description: "x402 payment examples",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${funnelDisplay.variable} bg-[#ececec]`}
      >
        <div className="relative z-10 -mb-[20px] overflow-hidden rounded-b-[20px] bg-[var(--background)] pb-16 md:-mb-[24px] md:rounded-b-[24px] md:pb-20 lg:-mb-[32px] lg:rounded-b-[32px] lg:pb-24">
          <MeridianHeader />
          {children}
        </div>
        <Footer bgColor="#ececec" light />
      </body>
    </html>
  );
}
