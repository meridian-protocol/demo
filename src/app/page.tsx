"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";

export default function Home() {
  const [showOpening, setShowOpening] = useState(true);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Hide opening animation after 1.2 seconds
    const openingTimer = setTimeout(() => {
      setShowOpening(false);
    }, 1200);

    // Show content immediately after animation ends
    const contentTimer = setTimeout(() => {
      setShowContent(true);
    }, 1200);

    return () => {
      clearTimeout(openingTimer);
      clearTimeout(contentTimer);
    };
  }, []);
  return (
    <div className="min-h-screen bg-[#0C0C0D] text-white flex flex-col p-4 sm:p-6 relative">
      {/* Opening Animation Logo */}
      {showOpening && (
        <Image 
          src="/logo-white.svg" 
          alt="Logo" 
          width={150} 
          height={150}
          className="logo-opening"
        />
      )}
      
      {/* Main content area */}
      <div className={`flex-1 flex items-center justify-center ${showContent ? 'content-visible' : 'content-hidden'}`}>
        <div className="text-center flex flex-col items-center w-full max-w-2xl">
        <h1 className="text-4xl sm:text-6xl lg:text-8xl font-light mb-6 sm:mb-8 lg:mb-12 text-white px-4"><span className="font-funnel-display font-light">Meridian</span> Demo</h1>
        <div className="bg-[#1F1F1F] rounded-xl shadow-lg p-6 sm:p-8 w-full max-w-md">
          <div className="flex flex-col gap-4">
            <Link
              href="/protected"
              className="px-4 sm:px-8 py-3 sm:py-4 text-[#34D399] bg-emerald-500/10 hover:bg-emerald-500/5 rounded-lg font-mono transition-colors text-sm sm:text-lg"
            >
              Try Protected Route
            </Link>
            <Link
              href="/protected_manual"
              className="px-4 sm:px-8 py-3 sm:py-4 text-[#34D399] bg-emerald-500/10 hover:bg-emerald-500/5 rounded-lg font-mono transition-colors text-sm sm:text-lg"
            >
              Try Protected Manual Route
            </Link>
            <Link
              href="/across-demo"
              className="px-4 sm:px-8 py-3 sm:py-4 text-[#34D399] bg-emerald-500/10 hover:bg-emerald-500/5 rounded-lg font-mono transition-colors text-sm sm:text-lg"
            >
              Cross-Chain Payment Demo
            </Link>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
