import Navbar from "@/components/Layout/Navbar";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6 space-y-10">
        <section className="space-y-3">
          <h2 className="text-3xl font-bold">About KnowledgeMapper</h2>
          <p className="text-gray-300 leading-relaxed">
            KnowledgeMapper is a visual learning workspace. Instead of keeping
            isolated topic lists, you build connected maps of ideas and explore
            how concepts relate over time.
          </p>
          <p className="text-gray-400 leading-relaxed">
            It combines AI suggestions, semantic similarity, and force-directed
            layout controls so you can move from broad curiosity to focused
            understanding faster.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm"
            >
              Open Map
            </Link>
            <Link
              href="/discover"
              className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-sm text-gray-200"
            >
              Open Discover
            </Link>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-xl font-semibold">How It Works</h3>
          <ol className="list-decimal list-inside space-y-2 text-gray-300 leading-relaxed">
            <li>
              Create or select a map. Each map is a separate learning space
              with its own topics and links.
            </li>
            <li>Add topics from the search box and press Enter to place them.</li>
            <li>
              Click any node to open actions: expand related topics, make a
              connection, open notes, or remove the topic.
            </li>
            <li>
              Use <span className="text-white">Discover</span> for recommendation
              ideas based on your current map and add them in one click.
            </li>
            <li>
              Tune similarity and advanced layout controls to balance cluster
              tightness, spacing, and readability.
            </li>
          </ol>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Core Features</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              <li>Multiple named maps</li>
              <li>AI-assisted topic expansion</li>
              <li>Connection topic generation</li>
              <li>Per-topic notes saved across sessions</li>
              <li>Discover recommendations</li>
            </ul>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Practical Tips</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Use short, specific topic names.</li>
              <li>Split very broad areas into separate maps.</li>
              <li>Capture a quick note when a node insight is fresh.</li>
              <li>Raise link pull if connected topics drift too far apart.</li>
              <li>Lower similarity to include more exploratory links.</li>
            </ul>
          </div>
        </section>

        <section className="space-y-2 pb-8">
          <h3 className="text-xl font-semibold">Privacy and Data</h3>
          <p className="text-gray-400 leading-relaxed">
            Your maps, topics, and notes are tied to your account. If you deploy
            your own instance, data storage and access rules are controlled by
            your Supabase project configuration.
          </p>
          <p className="text-gray-500 text-sm">
            Need help or planning a team version? Add project-specific
            instructions in this page so new users can onboard faster.
          </p>
        </section>
      </div>
    </div>
  );
}
