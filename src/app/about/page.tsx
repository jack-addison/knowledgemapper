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
            KnowledgeMapper is a visual workspace for structured learning and
            exploratory research. Instead of isolated topic lists, you build maps
            of concepts, inspect why links exist, and keep evidence tied to both
            nodes and edges.
          </p>
          <p className="text-gray-400 leading-relaxed">
            The goal is simple: help you move from curiosity to a map you can
            explain, defend, and iterate as your understanding improves.
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
            <li>Create or select a map for a specific research area.</li>
            <li>Add topics from the search box and press Enter.</li>
            <li>Open a node to generate topic evidence and write persistent notes.</li>
            <li>
              Open an edge to inspect the relationship, attach linking papers, and
              capture edge-specific notes.
            </li>
            <li>
              Use Expand/Connect to grow the map, then tune layout controls to
              keep structure readable as it scales.
            </li>
          </ol>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Core Features</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              <li>Multiple named maps</li>
              <li>AI-assisted topic expansion</li>
              <li>Node-to-node connection generation</li>
              <li>Persistent topic notes</li>
              <li>Persistent edge notes</li>
              <li>Node and edge evidence trails</li>
              <li>Interactive edge detail inspection</li>
              <li>TDA-assisted layout recommendation</li>
            </ul>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h3 className="text-lg font-semibold">Practical Tips</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Use short, specific topic names.</li>
              <li>Split very broad areas into separate maps.</li>
              <li>Save at least 1 source per key node before expanding.</li>
              <li>Use edge notes for claims, caveats, and open questions.</li>
              <li>Raise similarity if unrelated domains are being linked.</li>
              <li>Use TDA recommendation as a baseline, then adjust manually.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Advanced Layout + TDA</h3>
          <p className="text-gray-300 leading-relaxed">
            In <span className="text-white">Advanced layout</span>, you can tune{" "}
            <span className="text-white">Similarity</span>,{" "}
            <span className="text-white">Cluster</span>, and{" "}
            <span className="text-white">Link pull</span>.
          </p>
          <p className="text-gray-400 leading-relaxed">
            The TDA recommendation suggests values that reduce noisy bridge links
            and avoid collapsing everything into one giant component. Use
            <span className="text-white"> Apply recommendation</span> as a starting
            point, then refine for your map.
          </p>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Node vs Edge Evidence</h3>
          <p className="text-gray-300 leading-relaxed">
            Node evidence answers:{" "}
            <span className="text-white">What supports this topic?</span>
          </p>
          <p className="text-gray-300 leading-relaxed">
            Edge evidence answers:{" "}
            <span className="text-white">
              What supports the relationship between these two topics?
            </span>
          </p>
          <p className="text-gray-500 text-sm">
            Use both layers to build maps that are exploratory and defensible.
          </p>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">What This Is Best For</h3>
          <p className="text-gray-300 leading-relaxed">
            Best for early- to mid-stage research planning, literature mapping,
            and hypothesis exploration across adjacent concepts.
          </p>
          <p className="text-gray-500 text-sm">
            It is not a replacement for source-level critical review, domain
            expertise, or formal citation management workflows.
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
