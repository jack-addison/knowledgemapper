import Link from "next/link";

export default function Home() {
  const features = [
    {
      title: "Visual Topic Mapping",
      description:
        "Build multiple maps and see clusters, bridges, and weak spots in your understanding.",
    },
    {
      title: "Node + Edge Evidence",
      description:
        "Store papers for individual topics and separate papers that justify relationships.",
    },
    {
      title: "Research Notes in Context",
      description:
        "Keep notes attached directly to nodes and connections so reasoning stays traceable.",
    },
  ];

  const steps = [
    "Create a map and add initial topics.",
    "Expand nodes and generate connecting concepts.",
    "Save evidence and notes on both topics and links.",
  ];

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-b from-gray-950 via-slate-950 to-gray-950">
      <div className="absolute -top-32 -left-20 w-80 h-80 bg-cyan-500/15 blur-3xl rounded-full pointer-events-none" />
      <div className="absolute -bottom-24 -right-20 w-96 h-96 bg-blue-500/15 blur-3xl rounded-full pointer-events-none" />

      <header className="relative z-10 px-4 sm:px-6 py-5">
        <div className="w-full flex items-center justify-between">
          <p className="text-lg font-semibold bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
            KnowledgeMapper
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-3 py-1.5 text-sm border border-gray-700 hover:border-gray-500 rounded-md transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pb-14 space-y-10">
        <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-5 items-stretch">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 md:p-8">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
              Research Workspace
            </p>
            <h1 className="text-4xl md:text-5xl font-bold mt-3 leading-tight">
              Map ideas.
              <br />
              Justify connections.
            </h1>
            <p className="text-gray-300 mt-4 leading-relaxed">
              Move from scattered curiosity to structured understanding with
              graph-based topic maps, evidence trails, and contextual notes.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
              >
                Start Mapping
              </Link>
              <Link
                href="/about"
                className="px-5 py-2.5 border border-gray-700 hover:border-gray-500 rounded-lg font-medium transition-colors"
              >
                How It Works
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 md:p-8">
            <h2 className="text-xl font-semibold">What You Can Do</h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-300">
              <li className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                Build map-specific layouts and control clustering behavior.
              </li>
              <li className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                Open nodes to collect topic papers and save a persistent evidence trail.
              </li>
              <li className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                Open edges to capture papers that justify topic relationships.
              </li>
              <li className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                Keep node notes and edge notes tied directly to your reasoning.
              </li>
            </ul>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-xl border border-gray-800 bg-gray-900/50 p-5"
            >
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                {feature.description}
              </p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 md:p-6">
          <h2 className="text-xl font-semibold">Quick Start</h2>
          <div className="grid md:grid-cols-3 gap-3 mt-4">
            {steps.map((step, idx) => (
              <div
                key={step}
                className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-3"
              >
                <p className="text-xs text-cyan-300 mb-1">Step {idx + 1}</p>
                <p className="text-sm text-gray-300">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
