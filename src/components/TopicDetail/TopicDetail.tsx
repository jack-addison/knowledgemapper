"use client";

import { useState } from "react";
import {
  EvidenceSource,
  SavedInterestEvidence,
  TopicEvidence,
} from "@/lib/types";

interface TopicDetailProps {
  name: string;
  relatedTopics: string[];
  readOnly?: boolean;
  connectingFrom?: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onExpand: (topics: string[]) => Promise<void>;
  onRemove: (topicName: string) => void;
  onStartConnect: (topicName: string) => void;
  onOpenNotes: () => void;
  researchEvidence: TopicEvidence | null;
  researchEvidenceLoading: boolean;
  researchEvidenceError: string;
  savedResearchEvidence: SavedInterestEvidence[];
  savedResearchEvidenceLoading: boolean;
  savedResearchEvidenceError: string;
  savingResearchEvidenceUrl: string | null;
  deletingResearchEvidenceId: string | null;
  onLoadResearchEvidence: () => Promise<void> | void;
  onSaveResearchEvidence: (source: EvidenceSource) => Promise<boolean> | boolean;
  onDeleteResearchEvidence: (id: string) => Promise<void> | void;
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

function getKhanAcademySearchUrl(topic: string): string {
  return `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(topic)}`;
}

function getMitOcwSearchUrl(topic: string): string {
  return `https://ocw.mit.edu/search/?q=${encodeURIComponent(topic)}`;
}

function getRedditSearchUrl(topic: string): string {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(topic)}`;
}

function getSemanticScholarUrl(topic: string): string {
  return `https://www.semanticscholar.org/search?q=${encodeURIComponent(topic)}`;
}

function getGitHubSearchUrl(topic: string): string {
  return `https://github.com/search?q=${encodeURIComponent(topic)}&type=repositories`;
}

function getKaggleSearchUrl(topic: string): string {
  return `https://www.kaggle.com/search?q=${encodeURIComponent(topic)}`;
}

function normalizePaperUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

type LearningMode =
  | "overview"
  | "courses"
  | "papers"
  | "hands-on"
  | "community";
type LearningStage = "start" | "build" | "deepen";

interface LearningResource {
  id: string;
  title: string;
  description: string;
  href: string;
  label: string;
  mode: LearningMode;
  stage: LearningStage;
}

const LEARNING_MODE_META: Array<{
  mode: LearningMode;
  label: string;
  description: string;
}> = [
  {
    mode: "overview",
    label: "Overview",
    description: "Definitions and broad context.",
  },
  {
    mode: "courses",
    label: "Courses",
    description: "Structured learning paths.",
  },
  {
    mode: "papers",
    label: "Papers",
    description: "Primary research literature.",
  },
  {
    mode: "hands-on",
    label: "Hands-on",
    description: "Projects, code, and datasets.",
  },
  {
    mode: "community",
    label: "Community",
    description: "Discussion and practical viewpoints.",
  },
];

const STAGE_LABELS: Record<LearningStage, string> = {
  start: "Start",
  build: "Build",
  deepen: "Deepen",
};

const STAGE_ORDER: Record<LearningStage, number> = {
  start: 0,
  build: 1,
  deepen: 2,
};

export default function TopicDetail({
  name,
  relatedTopics,
  readOnly = false,
  connectingFrom,
  isExpanded,
  onToggleExpand,
  onClose,
  onExpand,
  onRemove,
  onStartConnect,
  onOpenNotes,
  researchEvidence,
  researchEvidenceLoading,
  researchEvidenceError,
  savedResearchEvidence,
  savedResearchEvidenceLoading,
  savedResearchEvidenceError,
  savingResearchEvidenceUrl,
  deletingResearchEvidenceId,
  onLoadResearchEvidence,
  onSaveResearchEvidence,
  onDeleteResearchEvidence,
}: TopicDetailProps) {
  const [expanding, setExpanding] = useState(false);
  const [expandResult, setExpandResult] = useState<string | null>(null);
  const [manualSourceTitle, setManualSourceTitle] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [manualSourceYear, setManualSourceYear] = useState("");
  const [manualSourceJournal, setManualSourceJournal] = useState("");
  const [manualSourceAuthors, setManualSourceAuthors] = useState("");
  const [manualSourceReason, setManualSourceReason] = useState("");
  const [manualSourceError, setManualSourceError] = useState("");
  const [manualSourceSaving, setManualSourceSaving] = useState(false);
  const [activeLearningMode, setActiveLearningMode] =
    useState<LearningMode>("overview");
  const learningResources: LearningResource[] = [
    {
      id: "wiki-overview",
      mode: "overview",
      stage: "start",
      title: "Wikipedia overview",
      description: "Background, definitions, and key references.",
      href: getWikipediaUrl(name),
      label: "Reference",
    },
    {
      id: "youtube-overview",
      mode: "overview",
      stage: "start",
      title: "YouTube explainers",
      description: "Quick visual intros and concept breakdowns.",
      href: getYouTubeSearchUrl(name),
      label: "Video",
    },
    {
      id: "khan-basics",
      mode: "courses",
      stage: "start",
      title: "Khan Academy",
      description: "Foundational lessons for fundamentals.",
      href: getKhanAcademySearchUrl(name),
      label: "Basics",
    },
    {
      id: "coursera-courses",
      mode: "courses",
      stage: "build",
      title: "Coursera courses",
      description: "Structured courses and guided learning paths.",
      href: getCourseraSearchUrl(name),
      label: "Course",
    },
    {
      id: "mit-ocw",
      mode: "courses",
      stage: "deepen",
      title: "MIT OpenCourseWare",
      description: "University lectures and full course materials.",
      href: getMitOcwSearchUrl(name),
      label: "University",
    },
    {
      id: "scholar-papers",
      mode: "papers",
      stage: "build",
      title: "Google Scholar",
      description: "Academic papers and citation trails.",
      href: getGoogleScholarUrl(name),
      label: "Research",
    },
    {
      id: "semantic-scholar",
      mode: "papers",
      stage: "build",
      title: "Semantic Scholar",
      description: "Paper graph navigation and citation context.",
      href: getSemanticScholarUrl(name),
      label: "Citations",
    },
    {
      id: "arxiv-latest",
      mode: "papers",
      stage: "deepen",
      title: "arXiv papers",
      description: "Recent technical preprints and new findings.",
      href: getArxivUrl(name),
      label: "Latest",
    },
    {
      id: "github-projects",
      mode: "hands-on",
      stage: "build",
      title: "GitHub projects",
      description: "Implementations, tooling, and practical codebases.",
      href: getGitHubSearchUrl(name),
      label: "Code",
    },
    {
      id: "kaggle-datasets",
      mode: "hands-on",
      stage: "deepen",
      title: "Kaggle datasets",
      description: "Datasets and notebooks for applied exploration.",
      href: getKaggleSearchUrl(name),
      label: "Data",
    },
    {
      id: "reddit-discussions",
      mode: "community",
      stage: "build",
      title: "Community discussions",
      description: "Questions, opinions, and practical advice.",
      href: getRedditSearchUrl(name),
      label: "Community",
    },
  ];
  const modeResources =
    activeLearningMode === "overview"
      ? learningResources
      : learningResources.filter((resource) => resource.mode === activeLearningMode);
  const sortedModeResources = [...modeResources].sort((a, b) => {
    const stageDelta = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (stageDelta !== 0) return stageDelta;
    return a.title.localeCompare(b.title);
  });
  const guidedPath = (["start", "build", "deepen"] as LearningStage[]).map(
    (stage) => ({
      stage,
      resource:
        sortedModeResources.find((resource) => resource.stage === stage) || null,
    })
  );

  async function handleConfirmExpand() {
    if (readOnly) return;
    if (relatedTopics.length === 0) return;
    setExpanding(true);
    setExpandResult(null);
    try {
      await onExpand(relatedTopics);
      setExpandResult(`Added ${relatedTopics.length} topics!`);
    } catch {
      setExpandResult("Failed to add topics — try again.");
    } finally {
      setExpanding(false);
    }
  }

  async function handleSaveManualSource() {
    if (readOnly) return;
    const title = manualSourceTitle.trim();
    const url = normalizePaperUrl(manualSourceUrl);
    if (!title || !url) {
      setManualSourceError("Title and URL are required.");
      return;
    }

    let year: number | null = null;
    if (manualSourceYear.trim()) {
      const parsedYear = Number(manualSourceYear.trim());
      if (!Number.isFinite(parsedYear)) {
        setManualSourceError("Year must be a valid number.");
        return;
      }
      year = Math.trunc(parsedYear);
    }

    const authors = manualSourceAuthors
      .split(",")
      .map((author) => author.trim())
      .filter((author) => author.length > 0)
      .slice(0, 8);

    const source: EvidenceSource = {
      title,
      url,
      year,
      journal: manualSourceJournal.trim() || "User provided source",
      authors,
      reason:
        manualSourceReason.trim() || `User-added evidence for topic: ${name}.`,
      sourceProvider: "manual",
    };

    setManualSourceSaving(true);
    setManualSourceError("");
    const saved = await onSaveResearchEvidence(source);
    setManualSourceSaving(false);

    if (!saved) {
      setManualSourceError("Failed to save paper link.");
      return;
    }

    setManualSourceTitle("");
    setManualSourceUrl("");
    setManualSourceYear("");
    setManualSourceJournal("");
    setManualSourceAuthors("");
    setManualSourceReason("");
  }

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-900 p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">{name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {readOnly
              ? "Read-only topic view"
              : "Topic actions and learning links"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleExpand}
            className="px-2 py-1 rounded-md border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-gray-500"
          >
            {isExpanded ? "Collapse" : "Expand"}
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <p className="text-xs text-gray-400">Quick actions</p>
          {readOnly ? (
            <p className="text-xs text-cyan-300">
              Combined map is read-only. Use a specific map to edit topics.
            </p>
          ) : connectingFrom ? (
            <p className="text-xs text-purple-300">
              Connection mode active. Click another node on the map.
            </p>
          ) : (
            <button
              onClick={() => onStartConnect(name)}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 border border-purple-500/50 text-purple-300 hover:bg-purple-500/10 text-sm font-medium rounded-lg transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M8 12h8M12 8l4 4-4 4" />
              </svg>
              Make a connection
            </button>
          )}

          <button
            onClick={onOpenNotes}
            disabled={readOnly}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 text-sm font-medium rounded-lg transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Open Notes
          </button>

          <button
            onClick={() => onRemove(name)}
            disabled={readOnly}
            className="w-full text-sm text-gray-500 hover:text-red-400 transition-colors py-1"
          >
            Remove from map
          </button>
        </div>

        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Topic research evidence</p>
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              papers
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onLoadResearchEvidence}
              disabled={researchEvidenceLoading}
              className="flex-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm text-white"
            >
              {researchEvidenceLoading
                ? "Loading..."
                : researchEvidence
                  ? "Refresh evidence"
                  : "Load research evidence"}
            </button>
            <a
              href={getGoogleScholarUrl(name)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
            >
              Scholar
            </a>
            <a
              href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
            >
              S2
            </a>
          </div>

          {researchEvidenceError && (
            <p className="text-xs text-red-300">{researchEvidenceError}</p>
          )}

          {researchEvidence && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 leading-relaxed">
                {researchEvidence.summary}
              </p>
              {researchEvidence.sources.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {researchEvidence.sources.map((source) => {
                    const saved = savedResearchEvidence.some(
                      (item) => item.url === source.url
                    );
                    const saving = savingResearchEvidenceUrl === source.url;

                    return (
                      <div
                        key={`${source.url}-${source.title}`}
                        className="rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-100 leading-snug hover:text-white"
                          >
                            {source.title}
                          </a>
                          <button
                            onClick={() => onSaveResearchEvidence(source)}
                            disabled={readOnly || saved || saving}
                            className="px-2 py-1 rounded-md border border-emerald-600/70 text-emerald-300 text-xs disabled:opacity-60"
                          >
                            {readOnly
                              ? "Read-only"
                              : saved
                                ? "Saved"
                                : saving
                                  ? "Saving..."
                                  : "Save"}
                          </button>
                        </div>
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
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  No direct papers found yet. Try broader terms.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">Saved topic trail</p>
              {savedResearchEvidenceLoading && (
                <span className="text-[11px] text-gray-500">Loading...</span>
              )}
            </div>
            {savedResearchEvidenceError && (
              <p className="text-xs text-red-300">{savedResearchEvidenceError}</p>
            )}

            {savedResearchEvidence.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {savedResearchEvidence.map((source) => (
                  <div
                    key={source.id}
                    className="rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-100 leading-snug hover:text-white"
                      >
                        {source.title}
                      </a>
                      <button
                        onClick={() => onDeleteResearchEvidence(source.id)}
                        disabled={readOnly || deletingResearchEvidenceId === source.id}
                        className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        {readOnly
                          ? "Read-only"
                          : deletingResearchEvidenceId === source.id
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </div>
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
                No saved evidence for this topic yet.
              </p>
            )}
          </div>

          {!readOnly && (
            <details className="rounded-md border border-blue-800/40 bg-blue-950/10 p-3">
              <summary className="cursor-pointer select-none text-xs text-blue-200">
                Add your own paper link
              </summary>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={manualSourceTitle}
                    onChange={(e) => setManualSourceTitle(e.target.value)}
                    placeholder="Paper title *"
                    className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="text"
                    value={manualSourceUrl}
                    onChange={(e) => setManualSourceUrl(e.target.value)}
                    placeholder="URL or DOI link *"
                    className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="text"
                    value={manualSourceJournal}
                    onChange={(e) => setManualSourceJournal(e.target.value)}
                    placeholder="Journal / venue (optional)"
                    className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="text"
                    value={manualSourceYear}
                    onChange={(e) => setManualSourceYear(e.target.value)}
                    placeholder="Year (optional)"
                    className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <input
                  type="text"
                  value={manualSourceAuthors}
                  onChange={(e) => setManualSourceAuthors(e.target.value)}
                  placeholder="Authors (optional, comma-separated)"
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <textarea
                  value={manualSourceReason}
                  onChange={(e) => setManualSourceReason(e.target.value)}
                  placeholder="Why this paper is relevant (optional)"
                  className="w-full min-h-[64px] rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {manualSourceError && (
                  <p className="text-xs text-red-300">{manualSourceError}</p>
                )}
                <button
                  onClick={handleSaveManualSource}
                  disabled={manualSourceSaving}
                  className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs text-white"
                >
                  {manualSourceSaving ? "Saving..." : "Save paper link"}
                </button>
              </div>
            </details>
          )}
        </div>

        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Learn</p>
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {sortedModeResources.length}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {LEARNING_MODE_META.map((modeMeta) => {
              const active = modeMeta.mode === activeLearningMode;
              return (
                <button
                  key={modeMeta.mode}
                  onClick={() => setActiveLearningMode(modeMeta.mode)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? "border-blue-500/70 bg-blue-500/10 text-blue-200"
                      : "border-gray-700 text-gray-300 hover:border-gray-500"
                  }`}
                >
                  {modeMeta.label}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-gray-500">
            {
              LEARNING_MODE_META.find((item) => item.mode === activeLearningMode)
                ?.description
            }
            {relatedTopics.length > 0
              ? ` ${relatedTopics.length} related topics can be expanded from this node.`
              : ""}
          </p>

          <div className="rounded-md border border-gray-700 bg-gray-900/60 p-2 space-y-1.5">
            <p className="text-[11px] text-gray-400">Guided path</p>
            {guidedPath.map((item) => (
              <div
                key={item.stage}
                className="flex items-center justify-between gap-2 rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5"
              >
                <span className="text-[10px] uppercase tracking-wide text-cyan-300">
                  {STAGE_LABELS[item.stage]}
                </span>
                {item.resource ? (
                  <a
                    href={item.resource.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-200 hover:text-white truncate"
                    title={item.resource.title}
                  >
                    {item.resource.title}
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">No item in this mode</span>
                )}
              </div>
            ))}
          </div>

          <div
            className={`space-y-1.5 overflow-y-auto pr-1 ${
              isExpanded ? "max-h-80" : "max-h-56"
            }`}
          >
            {sortedModeResources.map((resource) => (
              <a
                key={resource.id}
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 hover:border-blue-500/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-100">{resource.title}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {STAGE_LABELS[resource.stage]}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {resource.label}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{resource.description}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Expand Section — shows pre-computed suggestions */}
        {relatedTopics.length > 0 && !expandResult && (
          <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
            <p className="text-xs text-gray-400">Related topics</p>
            <ul
              className={`space-y-1 overflow-y-auto pr-1 ${
                isExpanded ? "max-h-44" : "max-h-32"
              }`}
            >
              {relatedTopics.map((topic) => (
                <li
                  key={topic}
                  className="flex items-center gap-2 text-sm text-gray-200 bg-gray-900/70 rounded-md px-3 py-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  {topic}
                </li>
              ))}
            </ul>
            {readOnly ? (
              <p className="text-xs text-cyan-300">
                Combined map is read-only. Open a specific map to add topics.
              </p>
            ) : (
              <button
                onClick={handleConfirmExpand}
                disabled={expanding}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {expanding ? "Adding..." : "Add all to map"}
              </button>
            )}
          </div>
        )}

        {expandResult && (
          <p className="text-sm text-green-400">{expandResult}</p>
        )}
      </div>
    </div>
  );
}
