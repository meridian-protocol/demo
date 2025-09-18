import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-800 to-black text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-8">Meridian Demo</h1>
        <div className="flex flex-col gap-4">
          <Link
            href="/protected"
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-mono transition-colors text-lg"
          >
            Try Protected Route
          </Link>
          <Link
            href="/protected_manual"
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-mono transition-colors text-lg"
          >
            Try Protected Manual Route
          </Link>
        </div>
      </div>
    </div>
  );
}
