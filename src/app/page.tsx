import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          KnowledgeMapper
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          Visualize your intellectual world. Map your interests, discover
          connections, and find what to explore next.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/signup"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border border-gray-700 hover:border-gray-500 rounded-lg font-medium transition-colors"
          >
            Log In
          </Link>
        </div>
      </div>
    </div>
  );
}
