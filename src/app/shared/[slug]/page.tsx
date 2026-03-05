"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import KnowledgeGraph from "@/components/Graph/KnowledgeGraph";
import {
  buildGraph,
  DEFAULT_CLUSTER_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "@/lib/graph";
import type {
  EdgeEvidence,
  GraphData,
  GraphLayoutMode,
  GraphLinkSelection,
  GraphRenderMode,
  SharedMapSnapshot,
  TopicEvidence,
} from "@/lib/types";

interface LearningResource {
  title: string;
  description: string;
  href: string;
  label: string;
}

const DEFAULT_LINK_FORCE_SCALE = 3;
const DEFAULT_EDGE_RENDER_TOP_K = 5;
const DEFAULT_LAYOUT_MODE: GraphLayoutMode = "umap";
const DEFAULT_RENDER_MODE: GraphRenderMode = "2d";

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumberParam(
  raw: string | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clampValue(parsed, min, max);
}

function parseLayoutModeParam(raw: string | null): GraphLayoutMode {
  if (raw === "classic" || raw === "umap" || raw === "pca3d") return raw;
  return DEFAULT_LAYOUT_MODE;
}

function parseRenderModeParam(raw: string | null): GraphRenderMode {
  if (raw === "2d" || raw === "3d") return raw;
  return DEFAULT_RENDER_MODE;
}

function normalizeEdgePair(a: string, b: string): { a: string; b: string } {
  return a < b ? { a, b } : { a: b, b: a };
}

function tokenizeTopic(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function explainLink(link: GraphLinkSelection): string {
  const score = Math.round(link.similarity * 100);
  const aTokens = new Set(tokenizeTopic(link.sourceName));
  const bTokens = new Set(tokenizeTopic(link.targetName));
  const shared = [...aTokens].filter((token) => bTokens.has(token));
  const sharedText =
    shared.length > 0
      ? ` They overlap in language around "${shared.slice(0, 3).join('", "')}".`
      : "";

  if (link.similarity >= 0.7) {
    return `${link.sourceName} and ${link.targetName} are strongly related in semantic meaning (${score}% similarity). Studying one should directly reinforce the other.${sharedText}`;
  }

  if (link.similarity >= 0.5) {
    return `${link.sourceName} and ${link.targetName} have a meaningful conceptual overlap (${score}% similarity). They likely share methods, context, or vocabulary.${sharedText}`;
  }

  return `${link.sourceName} and ${link.targetName} have a lighter but valid connection (${score}% similarity). This is a bridge-style link that helps exploration across neighboring domains.${sharedText}`;
}

function buildResearchQuery(link: GraphLinkSelection): string {
  return `${link.sourceName} ${link.targetName}`;
}

function getYouTubeSearchUrl(topic: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(topic + " explained")}`;
}

function getWikipediaUrl(topic: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, "_"))}`;
}

function getGoogleScholarUrl(topic: string): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(topic)}`;
}

function getArxivUrl(topic: string): string {
  return `https://arxiv.org/search/?query=${encodeURIComponent(topic)}&searchtype=all`;
}

function getCourseraSearchUrl(topic: string): string {
  return `https://www.coursera.org/search?query=${encodeURIComponent(topic)}`;
}

function getMitOcwSearchUrl(topic: string): string {
  return `https://ocw.mit.edu/search/?q=${encodeURIComponent(topic)}`;
}

function getKhanAcademySearchUrl(topic: string): string {
  return `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(topic)}`;
}

function getRedditSearchUrl(topic: string): string {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(topic)}`;
}

function buildLearningResources(topic: string): LearningResource[] {
  return [
    {
      title: "YouTube explainers",
      description: "Quick visual intros and concept breakdowns.",
      href: getYouTubeSearchUrl(topic),
      label: "Video",
    },
    {
      title: "Wikipedia overview",
      description: "Background, definitions, and key references.",
      href: getWikipediaUrl(topic),
      label: "Reference",
    },
    {
      title: "Coursera courses",
      description: "Structured courses and guided learning paths.",
      href: getCourseraSearchUrl(topic),
      label: "Course",
    },
    {
      title: "MIT OpenCourseWare",
      description: "University lectures and full course materials.",
      href: getMitOcwSearchUrl(topic),
      label: "University",
    },
    {
      title: "Khan Academy",
      description: "Foundational lessons for fundamentals.",
      href: getKhanAcademySearchUrl(topic),
      label: "Basics",
    },
    {
      title: "Google Scholar",
      description: "Academic papers and citation trails.",
      href: getGoogleScholarUrl(topic),
      label: "Research",
    },
    {
      title: "arXiv papers",
      description: "Recent technical preprints and new findings.",
      href: getArxivUrl(topic),
      label: "Latest",
    },
    {
      title: "Community discussions",
      description: "Questions, opinions, and practical advice.",
      href: getRedditSearchUrl(topic),
      label: "Community",
    },
  ];
}

export default function SharedMapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 text-white p-6">
          <p className="text-gray-400">Loading shared map...</p>
        </div>
      }
    >
      <SharedMapContent />
    </Suspense>
  );
}

function SharedMapContent() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  const sharedSimilarityThreshold = parseNumberParam(
    searchParams.get("similarity"),
    0.05,
    0.6,
    DEFAULT_SIMILARITY_THRESHOLD
  );
  const sharedClusterThreshold = parseNumberParam(
    searchParams.get("cluster"),
    0.2,
    0.7,
    DEFAULT_CLUSTER_THRESHOLD
  );
  const sharedLinkForceScale = parseNumberParam(
    searchParams.get("linkForce"),
    0.5,
    3,
    DEFAULT_LINK_FORCE_SCALE
  );
  const sharedEdgeRenderTopK = Math.max(
    0,
    Math.min(
      12,
      Math.trunc(
        parseNumberParam(
          searchParams.get("edgeTopK"),
          0,
          12,
          DEFAULT_EDGE_RENDER_TOP_K
        )
      )
    )
  );
  const sharedLayoutMode = parseLayoutModeParam(searchParams.get("layoutMode"));
  const sharedRenderMode = parseRenderModeParam(searchParams.get("renderMode"));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<SharedMapSnapshot | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<GraphLinkSelection | null>(null);
  const [selectedTopicEvidence, setSelectedTopicEvidence] =
    useState<TopicEvidence | null>(null);
  const [selectedTopicEvidenceLoading, setSelectedTopicEvidenceLoading] =
    useState(false);
  const [selectedTopicEvidenceError, setSelectedTopicEvidenceError] = useState("");
  const [selectedLinkEvidence, setSelectedLinkEvidence] =
    useState<EdgeEvidence | null>(null);
  const [selectedLinkEvidenceLoading, setSelectedLinkEvidenceLoading] =
    useState(false);
  const [selectedLinkEvidenceError, setSelectedLinkEvidenceError] = useState("");

  useEffect(() => {
    if (!slug) {
      setError("Invalid share link");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadSharedMap() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/shared/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) {
            setSnapshot(null);
            setError(data.error || "Unable to load shared map");
          }
          return;
        }

        const data: SharedMapSnapshot = await res.json();
        if (!cancelled) {
          setSnapshot(data);
        }
      } catch {
        if (!cancelled) {
          setSnapshot(null);
          setError("Unable to load shared map");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSharedMap();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!selectedTopicId || !snapshot) return;
    const exists = snapshot.interests.some((interest) => interest.id === selectedTopicId);
    if (!exists) {
      setSelectedTopicId(null);
    }
  }, [selectedTopicId, snapshot]);

  useEffect(() => {
    setSelectedTopicEvidence(null);
    setSelectedTopicEvidenceError("");
    setSelectedTopicEvidenceLoading(false);
  }, [selectedTopicId]);

  useEffect(() => {
    setSelectedLinkEvidence(null);
    setSelectedLinkEvidenceError("");
    setSelectedLinkEvidenceLoading(false);
  }, [selectedLink]);

  const graphData: GraphData = useMemo(() => {
    if (!snapshot) return { nodes: [], links: [] };
    return buildGraph(snapshot.interests, {
      similarityThreshold: sharedSimilarityThreshold,
      clusterThreshold: sharedClusterThreshold,
    });
  }, [snapshot, sharedSimilarityThreshold, sharedClusterThreshold]);

  const selectedTopic = useMemo(() => {
    if (!snapshot || !selectedTopicId) return null;
    return snapshot.interests.find((interest) => interest.id === selectedTopicId) || null;
  }, [snapshot, selectedTopicId]);

  const topicLearningResources = useMemo(() => {
    if (!selectedTopic) return [];
    return buildLearningResources(selectedTopic.name);
  }, [selectedTopic]);

  const topicEvidence = useMemo(() => {
    if (!snapshot || !selectedTopicId) return [];
    return snapshot.interestEvidence.filter(
      (source) => source.interest_id === selectedTopicId
    );
  }, [snapshot, selectedTopicId]);

  const edgeEvidence = useMemo(() => {
    if (!snapshot || !selectedLink) return [];
    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    return snapshot.edgeEvidence.filter((source) => {
      const edgePair = normalizeEdgePair(
        source.interest_a_id || "",
        source.interest_b_id || ""
      );
      return edgePair.a === pair.a && edgePair.b === pair.b;
    });
  }, [snapshot, selectedLink]);

  const edgeNotes = useMemo(() => {
    if (!snapshot || !selectedLink) return null;
    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    return (
      snapshot.edgeNotes.find((note) => {
        const edgePair = normalizeEdgePair(note.interest_a_id, note.interest_b_id);
        return edgePair.a === pair.a && edgePair.b === pair.b;
      }) || null
    );
  }, [snapshot, selectedLink]);

  async function handleLoadTopicEvidence() {
    if (!selectedTopic || !slug) return;

    setSelectedTopicEvidenceLoading(true);
    setSelectedTopicEvidenceError("");

    try {
      const res = await fetch(`/api/shared/${encodeURIComponent(slug)}/node-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: selectedTopic.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSelectedTopicEvidenceError(
          data.error || "Failed to load topic research evidence"
        );
        return;
      }

      const data: TopicEvidence = await res.json();
      setSelectedTopicEvidence(data);
    } catch {
      setSelectedTopicEvidenceError("Failed to load topic research evidence");
    } finally {
      setSelectedTopicEvidenceLoading(false);
    }
  }

  async function handleLoadLinkEvidence() {
    if (!selectedLink || !slug) return;

    setSelectedLinkEvidenceLoading(true);
    setSelectedLinkEvidenceError("");

    try {
      const res = await fetch(`/api/shared/${encodeURIComponent(slug)}/edge-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedLink.sourceId,
          targetId: selectedLink.targetId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSelectedLinkEvidenceError(data.error || "Failed to load research evidence");
        return;
      }

      const data: EdgeEvidence = await res.json();
      setSelectedLinkEvidence(data);
    } catch {
      setSelectedLinkEvidenceError("Failed to load research evidence");
    } finally {
      setSelectedLinkEvidenceLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6">
        <p className="text-gray-400">Loading shared map...</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Shared map unavailable</h1>
        <p className="text-red-300">{error || "This link is invalid or disabled."}</p>
        <Link
          href="/"
          className="inline-flex px-3 py-1.5 rounded-md border border-gray-700 text-sm text-gray-200 hover:border-gray-500"
        >
          Go to home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{snapshot.map.name}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Read-only shared map · {snapshot.interests.length} topics · {" "}
              {graphData.links.length} links
            </p>
          </div>
          <Link
            href="/signup"
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white"
          >
            Create your own map
          </Link>
        </div>
      </header>

      <main className="px-4 py-3 max-w-[1800px] mx-auto">
        <div className="relative" style={{ height: "calc(100vh - 120px)" }}>
          <KnowledgeGraph
            data={graphData}
            selectedNodeId={selectedTopicId}
            selectedLink={selectedLink}
            linkForceScale={sharedLinkForceScale}
            renderLinkTopK={sharedEdgeRenderTopK}
            layoutMode={sharedLayoutMode}
            renderMode={sharedRenderMode}
            threeDLayoutPersistenceKey={slug ? `shared:${slug}` : null}
            onNodeClick={(nodeId) => {
              setSelectedTopicId(nodeId);
              setSelectedLink(null);
            }}
            onLinkClick={(link) => {
              setSelectedTopicId(null);
              setSelectedLink(link);
            }}
            onBackgroundClick={() => {
              setSelectedTopicId(null);
              setSelectedLink(null);
            }}
            reservedWidth={0}
          />

          {selectedTopic && (
            <aside className="absolute top-3 right-3 z-20 w-[44rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{selectedTopic.name}</h3>
                  <p className="text-xs text-gray-400">Read-only topic context</p>
                </div>
                <button
                  onClick={() => setSelectedTopicId(null)}
                  className="text-gray-400 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>

              <p className="text-[11px] text-gray-500">
                Browse links, evidence, notes, and papers. Saving and editing are
                disabled in shared mode.
              </p>

              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Topic research evidence</p>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    papers
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleLoadTopicEvidence}
                    disabled={selectedTopicEvidenceLoading}
                    className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm text-white"
                  >
                    {selectedTopicEvidenceLoading
                      ? "Loading..."
                      : selectedTopicEvidence
                        ? "Refresh evidence"
                        : "Load research evidence"}
                  </button>
                  <a
                    href={getGoogleScholarUrl(selectedTopic.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                  >
                    Scholar
                  </a>
                  <a
                    href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(selectedTopic.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                  >
                    S2
                  </a>
                </div>

                {selectedTopicEvidenceError && (
                  <p className="text-xs text-red-300">{selectedTopicEvidenceError}</p>
                )}

                {selectedTopicEvidence && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {selectedTopicEvidence.summary}
                    </p>
                    {selectedTopicEvidence.sources.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {selectedTopicEvidence.sources.map((source) => (
                          <div
                            key={`${source.url}-${source.title}`}
                            className="rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 space-y-1"
                          >
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-gray-100 leading-snug hover:text-white"
                            >
                              {source.title}
                            </a>
                            <p className="text-xs text-gray-400">
                              {source.journal}
                              {source.year ? ` · ${source.year}` : ""}
                            </p>
                            {source.authors.length > 0 && (
                              <p className="text-xs text-gray-500">
                                {source.authors.slice(0, 3).join(", ")}
                              </p>
                            )}
                            <p className="text-xs text-emerald-300">{source.reason}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        No direct papers found yet. Try broader terms.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Learning opportunities</p>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    {topicLearningResources.length}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {topicLearningResources.map((resource) => (
                    <a
                      key={resource.title}
                      href={resource.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 hover:border-blue-500/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-100">{resource.title}</span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          {resource.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{resource.description}</p>
                    </a>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {selectedTopic.notes?.trim() || "No notes saved for this topic."}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-400">Saved papers</p>
                {topicEvidence.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {topicEvidence.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 space-y-1"
                      >
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-gray-100 leading-snug hover:text-white"
                        >
                          {source.title}
                        </a>
                        <p className="text-xs text-gray-400">
                          {source.journal}
                          {source.year ? ` · ${source.year}` : ""}
                        </p>
                        {source.authors.length > 0 && (
                          <p className="text-xs text-gray-500">
                            {source.authors.slice(0, 3).join(", ")}
                          </p>
                        )}
                        <p className="text-xs text-emerald-300">{source.reason}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No saved papers for this topic.</p>
                )}
              </div>
            </aside>
          )}

          {selectedLink && (
            <aside className="absolute top-3 right-3 z-20 w-[48rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Connection details</h3>
                  <p className="text-xs text-gray-400">Read-only edge context</p>
                </div>
                <button
                  onClick={() => setSelectedLink(null)}
                  className="text-gray-400 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>

              <p className="text-[11px] text-gray-500">
                Browse connection rationale and papers. Saving and editing are disabled
                in shared mode.
              </p>

              <div className="rounded-md border border-gray-700 bg-gray-800/70 px-3 py-2">
                <p className="text-sm text-gray-100">
                  {selectedLink.sourceName}
                  <span className="text-gray-500 mx-2">↔</span>
                  {selectedLink.targetName}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Similarity score:{" "}
                  <span className="text-gray-200 font-mono">
                    {selectedLink.similarity.toFixed(2)}
                  </span>
                </p>
              </div>

              <p className="text-sm text-gray-300 leading-relaxed">
                {explainLink(selectedLink)}
              </p>

              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleLoadLinkEvidence}
                    disabled={selectedLinkEvidenceLoading}
                    className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm text-white"
                  >
                    {selectedLinkEvidenceLoading
                      ? "Loading..."
                      : selectedLinkEvidence
                        ? "Refresh evidence"
                        : "Load research evidence"}
                  </button>
                  <a
                    href={`https://scholar.google.com/scholar?q=${encodeURIComponent(buildResearchQuery(selectedLink))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                  >
                    Scholar
                  </a>
                  <a
                    href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(buildResearchQuery(selectedLink))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                  >
                    S2
                  </a>
                </div>

                {selectedLinkEvidenceError && (
                  <p className="text-xs text-red-300">{selectedLinkEvidenceError}</p>
                )}

                {selectedLinkEvidence && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {selectedLinkEvidence.summary}
                    </p>

                    {selectedLinkEvidence.sources.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {selectedLinkEvidence.sources.map((source) => (
                          <div
                            key={`${source.url}-${source.title}`}
                            className="rounded-md border border-gray-700 bg-gray-800/70 px-3 py-2 space-y-1"
                          >
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-gray-100 leading-snug hover:text-white"
                            >
                              {source.title}
                            </a>
                            <p className="text-xs text-gray-400">
                              {source.journal}
                              {source.year ? ` · ${source.year}` : ""}
                            </p>
                            {source.authors.length > 0 && (
                              <p className="text-xs text-gray-500">
                                {source.authors.slice(0, 3).join(", ")}
                              </p>
                            )}
                            <p className="text-xs text-emerald-300">{source.reason}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        No direct papers found yet. Try broader terms.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3">
                <p className="text-xs text-gray-400 mb-1">Edge notes</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {edgeNotes?.notes?.trim() || "No notes saved for this connection."}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-400">Saved papers for this connection</p>
                {edgeEvidence.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {edgeEvidence.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 space-y-1"
                      >
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-gray-100 leading-snug hover:text-white"
                        >
                          {source.title}
                        </a>
                        <p className="text-xs text-gray-400">
                          {source.journal}
                          {source.year ? ` · ${source.year}` : ""}
                        </p>
                        {source.authors.length > 0 && (
                          <p className="text-xs text-gray-500">
                            {source.authors.slice(0, 3).join(", ")}
                          </p>
                        )}
                        <p className="text-xs text-emerald-300">{source.reason}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No saved papers for this connection.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSelectedTopicId(selectedLink.sourceId);
                    setSelectedLink(null);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/60 text-sm text-gray-200"
                >
                  Open {selectedLink.sourceName}
                </button>
                <button
                  onClick={() => {
                    setSelectedTopicId(selectedLink.targetId);
                    setSelectedLink(null);
                  }}
                  className="flex-1 px-3 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/60 text-sm text-gray-200"
                >
                  Open {selectedLink.targetName}
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
