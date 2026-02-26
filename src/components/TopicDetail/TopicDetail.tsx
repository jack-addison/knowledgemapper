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

function normalizePaperUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

interface LearningResource {
  title: string;
  description: string;
  href: string;
  label: string;
}

export default function TopicDetail({
  name,
  relatedTopics,
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
  const learningResources: LearningResource[] = [
    {
      title: "YouTube explainers",
      description: "Quick visual intros and concept breakdowns.",
      href: getYouTubeSearchUrl(name),
      label: "Video",
    },
    {
      title: "Wikipedia overview",
      description: "Background, definitions, and key references.",
      href: getWikipediaUrl(name),
      label: "Reference",
    },
    {
      title: "Coursera courses",
      description: "Structured courses and guided learning paths.",
      href: getCourseraSearchUrl(name),
      label: "Course",
    },
    {
      title: "MIT OpenCourseWare",
      description: "University lectures and full course materials.",
      href: getMitOcwSearchUrl(name),
      label: "University",
    },
    {
      title: "Khan Academy",
      description: "Foundational lessons for fundamentals.",
      href: getKhanAcademySearchUrl(name),
      label: "Basics",
    },
    {
      title: "Google Scholar",
      description: "Academic papers and citation trails.",
      href: getGoogleScholarUrl(name),
      label: "Research",
    },
    {
      title: "arXiv papers",
      description: "Recent technical preprints and new findings.",
      href: getArxivUrl(name),
      label: "Latest",
    },
    {
      title: "Community discussions",
      description: "Questions, opinions, and practical advice.",
      href: getRedditSearchUrl(name),
      label: "Community",
    },
  ];

  async function handleConfirmExpand() {
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
            Topic actions and learning links
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
          {connectingFrom ? (
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
                            disabled={saved || saving}
                            className="px-2 py-1 rounded-md border border-emerald-600/70 text-emerald-300 text-xs disabled:opacity-60"
                          >
                            {saved ? "Saved" : saving ? "Saving..." : "Save"}
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
                        disabled={deletingResearchEvidenceId === source.id}
                        className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        {deletingResearchEvidenceId === source.id
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
        </div>

        <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Learning opportunities</p>
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {learningResources.length}
            </span>
          </div>

          <div
            className={`space-y-1.5 overflow-y-auto pr-1 ${
              isExpanded ? "max-h-80" : "max-h-56"
            }`}
          >
            {learningResources.map((resource) => (
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
            <button
              onClick={handleConfirmExpand}
              disabled={expanding}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {expanding ? "Adding..." : "Add all to map"}
            </button>
          </div>
        )}

        {expandResult && (
          <p className="text-sm text-green-400">{expandResult}</p>
        )}
      </div>
    </div>
  );
}
