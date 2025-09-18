"use client";
import Link from "next/link";
import Image from "next/image";
import { Github, Book, Twitter, Telegram } from "iconoir-react";
import { useState, useEffect } from "react";

export default function Home() {
  const [showOpening, setShowOpening] = useState(true);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Hide opening animation after 2.2 seconds
    const openingTimer = setTimeout(() => {
      setShowOpening(false);
    }, 2200);

    // Show content after opening animation
    const contentTimer = setTimeout(() => {
      setShowContent(true);
    }, 1800);

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
      
      {/* Top right social links */}
      <div className={`absolute top-4 sm:top-6 right-4 sm:right-6 flex gap-3 sm:gap-4 z-50 ${showContent ? 'content-visible' : 'content-hidden'}`}>
        <a 
          href="https://github.com/meridian-protocol/demo" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-white/70 hover:text-white transition-colors cursor-pointer block p-1"
        >
          <Github className="w-5 h-5 sm:w-6 sm:h-6 pointer-events-none" />
        </a>
        <a 
          href="https://docs.mrdn.finance/" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-white/70 hover:text-white transition-colors cursor-pointer block p-1"
        >
          <Book className="w-5 h-5 sm:w-6 sm:h-6 pointer-events-none" />
        </a>
        <a 
          href="https://x.com/mrdn_finance" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-white/70 hover:text-white transition-colors cursor-pointer block p-1"
        >
          <Twitter className="w-5 h-5 sm:w-6 sm:h-6 pointer-events-none" />
        </a>
        <a 
          href="https://t.me/mrdnfinance" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-white/70 hover:text-white transition-colors cursor-pointer block p-1"
        >
          <Telegram className="w-5 h-5 sm:w-6 sm:h-6 pointer-events-none" />
        </a>
      </div>
      
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
          </div>
        </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className={`flex flex-col items-center gap-4 py-8 ${showContent ? 'content-visible' : 'content-hidden'}`}>
        <Image 
          src="/logo-white.svg" 
          alt="Logo" 
          width={48} 
          height={48}
          className="w-10 h-10 sm:w-12 sm:h-12 logo-spin"
        />
        <a 
          href="https://www.mrdn.finance/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[#36D98D] hover:opacity-80 transition-opacity font-mono text-sm"
        >
          mrdn.finance
        </a>
      </footer>
    </div>
  );
}
