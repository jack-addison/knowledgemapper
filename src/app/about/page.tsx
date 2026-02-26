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
            It combines AI suggestions, semantic similarity, and evidence trails
            so you can move from broad curiosity to structured research.
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
          <h3 className="text-xl font-semibold">Research Workflow</h3>
          <ol className="list-decimal list-inside space-y-2 text-gray-300 leading-relaxed">
            <li>
              Create or select a map. Each map is a separate learning space
              with its own topics and links.
            </li>
            <li>Add topics from the search box and press Enter.</li>
            <li>
              Open a node to generate and save topic-specific research evidence.
            </li>
            <li>
              Open an edge to generate and save linking papers plus edge notes.
            </li>
            <li>
              Use Discover for expansion, then tune layout controls to keep
              maps readable as they grow.
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
              <li>Per-edge notes saved across sessions</li>
              <li>Node and edge evidence trails</li>
              <li>Discover recommendations</li>
            </ul>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Practical Tips</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Use short, specific topic names.</li>
              <li>Split very broad areas into separate maps.</li>
              <li>Save at least 1 source per key node before expanding.</li>
              <li>Use edge notes for claims, caveats, and open questions.</li>
              <li>Raise link pull if connected topics drift too far apart.</li>
              <li>Lower similarity to include more exploratory links.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Node vs Edge Evidence</h3>
          <p className="text-gray-300 leading-relaxed">
            Node evidence answers: <span className="text-white">What supports this topic?</span>
          </p>
          <p className="text-gray-300 leading-relaxed">
            Edge evidence answers: <span className="text-white">What supports the relationship between these two topics?</span>
          </p>
          <p className="text-gray-500 text-sm">
            Use both layers to build maps that are exploratory and defensible.
          </p>
        </section>

        <section className="space-y-2 pb-8">
          <h3 className="text-xl font-semibold">Data and Validation</h3>
          <p className="text-gray-400 leading-relaxed">
            Your maps, topics, and notes are tied to your account. If you deploy
            your own instance, data storage and access rules are controlled by
            your Supabase project configuration.
          </p>
          <p className="text-gray-500 text-sm">
            Evidence suggestions are a starting point; always verify quality and
            relevance against your research standards.
          </p>
        </section>
      </div>
    </div>
  );
}
