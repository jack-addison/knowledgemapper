import Navbar from "@/components/Layout/Navbar";
import Link from "next/link";

const workflowSteps = [
  "Create a map for a specific research question or domain.",
  "Add initial topics from the search box and open nodes to expand.",
  "Use Advanced layout controls (Similarity, Cluster, Link pull) to reduce noise.",
  "Open nodes to gather topic papers, learning links, and persistent notes.",
  "Open edges to inspect relationship explanations, linking papers, and edge notes.",
  "Share a map with a read-only public link when you want feedback.",
];

const featureGroups = [
  {
    title: "Research Workflow",
    items: [
      "Multiple named maps",
      "Node expansion and bridge-topic generation",
      "Node evidence + edge evidence trails",
      "Persistent notes on both nodes and edges",
    ],
  },
  {
    title: "Graph Controls",
    items: [
      "Similarity threshold to gate weak links",
      "Cluster threshold for color-group structure",
      "Link pull to tune connected-node compactness",
      "TDA recommendation button for a starting baseline",
      "Manual cluster dragging to keep useful regions in place",
    ],
  },
  {
    title: "Sharing",
    items: [
      "Private maps by default",
      "Public read-only share links",
      "Recipients can view notes and saved papers",
      "Recipients can open learning links and load evidence",
      "Recipients cannot save, edit, or modify map data",
    ],
  },
];

const bestPractices = [
  "Keep topic names specific and testable.",
  "Use separate maps for unrelated domains rather than forcing one giant graph.",
  "Treat node evidence as support for a concept, and edge evidence as support for a claim.",
  "Use edge notes to record assumptions, caveats, and confidence level.",
  "Start with TDA recommendations, then tune manually for your use case.",
  "Validate all suggested papers before relying on them in real outputs.",
];

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6 space-y-10">
        <section className="space-y-3">
          <h2 className="text-3xl font-bold">About KnowledgeMapper</h2>
          <p className="text-gray-300 leading-relaxed">
            KnowledgeMapper is a visual workspace for exploratory research. It helps
            you map concepts, inspect why topics are connected, and keep evidence
            attached directly to the graph structure.
          </p>
          <p className="text-gray-400 leading-relaxed">
            The goal is to make reasoning traceable: what each topic means, why each
            connection exists, and what sources support both.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm"
            >
              Open Dashboard
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
            {workflowSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="grid md:grid-cols-3 gap-6">
          {featureGroups.map((group) => (
            <div
              key={group.title}
              className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3"
            >
              <h3 className="text-lg font-semibold">{group.title}</h3>
              <ul className="list-disc list-inside space-y-1 text-gray-300">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Node vs Edge Evidence</h3>
          <p className="text-gray-300 leading-relaxed">
            Node evidence answers: <span className="text-white">What supports this topic?</span>
          </p>
          <p className="text-gray-300 leading-relaxed">
            Edge evidence answers:{" "}
            <span className="text-white">
              What supports this relationship between two topics?
            </span>
          </p>
          <p className="text-gray-500 text-sm">
            Using both layers turns a visual map into a defensible research artifact.
          </p>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Best Practices</h3>
          <ul className="list-disc list-inside space-y-1 text-gray-400">
            {bestPractices.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
          <h3 className="text-lg font-semibold">Scope and Limits</h3>
          <p className="text-gray-300 leading-relaxed">
            KnowledgeMapper is strongest for early- to mid-stage research planning,
            literature mapping, and hypothesis exploration across related concepts.
          </p>
          <p className="text-gray-500 text-sm">
            It does not replace formal literature review, domain expertise,
            citation-management tooling, or source-quality verification.
          </p>
        </section>

        <section className="space-y-2 pb-8">
          <h3 className="text-xl font-semibold">Data and Validation</h3>
          <p className="text-gray-400 leading-relaxed">
            Your maps, topics, notes, and saved evidence are tied to your account.
            Shared links are read-only and should be enabled intentionally per map.
          </p>
          <p className="text-gray-500 text-sm">
            Evidence suggestions are a starting point. Verify relevance and quality
            before citing or acting on them.
          </p>
        </section>
      </div>
    </div>
  );
}
