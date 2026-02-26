import Navbar from "@/components/Layout/Navbar";
import Link from "next/link";

const workflowSteps = [
  "Create a named map, or open the Combined map to inspect cross-map overlap.",
  "Add topics manually with +, or use AI Assistant (General mode) to build a new map from a prompt.",
  "Use Extend current map with a prompt to steer what gets added next.",
  "Open nodes and edges to save notes, attach evidence, and inspect relationship reasoning.",
  "Use grounded assistant scope (map/node/edge) for evidence-aware answers and cited papers.",
  "Tune Similarity, Cluster, Link pull, layout mode, and TDA recommendation to control structure.",
  "Share a map read-only, or export Download .txt for node/edge notes + BibTeX-style entries.",
];

const featureGroups = [
  {
    title: "Research Workspace",
    items: [
      "Multiple named maps",
      "Automatic Combined map across all user maps (deduplicated topics)",
      "Node expansion and bridge-topic generation",
      "Node evidence + edge evidence trails",
      "Persistent notes on both nodes and edges",
    ],
  },
  {
    title: "AI Assistant",
    items: [
      "Grounded mode for map-aware answers with citations",
      "General mode for broader ideation with optional map/node/edge focus",
      "Build map from prompt",
      "Prompt-driven Extend current map",
      "Save assistant output into notes and evidence records",
    ],
  },
  {
    title: "Graph Controls",
    items: [
      "Similarity threshold to gate weak links",
      "Cluster threshold for color-group structure",
      "Link pull to tune connected-node compactness",
      "UMAP or classic layout mode",
      "TDA recommendation baseline for layout tuning",
      "Fast settle mode and manual cluster positioning",
    ],
  },
  {
    title: "Sharing",
    items: [
      "Private maps by default",
      "Public read-only share links",
      "Shared links carry current layout settings",
      "Recipients can view notes and saved papers",
      "Recipients can open learning links and load evidence",
      "Recipients cannot save, edit, or modify map data",
    ],
  },
  {
    title: "Map Management",
    items: [
      "Per-map saved layout settings",
      "Delete map with Bin action",
      "Combined map remains read-only by design",
      "Fullscreen graph mode with centered detail overlays",
    ],
  },
  {
    title: "Export",
    items: [
      "Per-map Download .txt export in the dashboard header",
      "Includes every node with BibTeX-style entries + node notes",
      "Includes every edge with BibTeX-style entries + edge notes",
      "Structured for easy copy into LaTeX/BibTeX writing pipelines",
    ],
  },
];

const bestPractices = [
  "Keep topic names specific and testable.",
  "Use separate maps for unrelated domains rather than forcing one giant graph.",
  "Treat node evidence as support for a concept, and edge evidence as support for a claim.",
  "Use extension prompts to intentionally steer what the map grows toward.",
  "Use edge notes to record assumptions, caveats, and confidence level.",
  "Start with TDA recommendations, then tune manually for your use case.",
  "Use grounded assistant mode when you need traceable, source-linked responses.",
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
            KnowledgeMapper is a visual research workspace for building, testing,
            and documenting topic networks. It combines map editing, evidence
            collection, and assistant-guided expansion in one interface.
          </p>
          <p className="text-gray-400 leading-relaxed">
            The core goal is traceability: what each topic means, why links exist,
            and which sources support node-level and edge-level claims.
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
            citation-management tooling, or source-quality verification. Assistant
            outputs should be treated as drafts to validate, not final authority.
          </p>
        </section>

        <section className="space-y-2 pb-8">
          <h3 className="text-xl font-semibold">Data and Validation</h3>
          <p className="text-gray-400 leading-relaxed">
            Your maps, topics, notes, and saved evidence are tied to your account.
            Shared links are read-only, map-specific, and can be disabled or
            regenerated.
            Exported `.txt` files are generated client-side from your current map data.
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
