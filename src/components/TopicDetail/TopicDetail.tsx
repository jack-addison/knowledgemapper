"use client";

import { useState } from "react";

interface TopicDetailProps {
  name: string;
  relatedTopics: string[];
  connectingFrom?: string | null;
  onClose: () => void;
  onExpand: (topics: string[]) => Promise<void>;
  onRemove: (topicName: string) => void;
  onStartConnect: (topicName: string) => void;
  onOpenNotes: () => void;
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
  onClose,
  onExpand,
  onRemove,
  onStartConnect,
  onOpenNotes,
}: TopicDetailProps) {
  const [expanding, setExpanding] = useState(false);
  const [expandResult, setExpandResult] = useState<string | null>(null);
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

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-900 p-4 space-y-4">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-white">{name}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-sm"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-medium">
            Learning opportunities:
          </p>
          <div className="space-y-1.5">
            {learningResources.map((resource) => (
              <a
                key={resource.title}
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 hover:border-blue-500/40 hover:bg-gray-800 transition-colors"
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
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium">
              Related topics:
            </p>
            <ul className="space-y-1">
              {relatedTopics.map((topic) => (
                <li
                  key={topic}
                  className="flex items-center gap-2 text-sm text-gray-200 bg-gray-800 rounded-md px-3 py-1.5"
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

        {/* Make a Connection */}
        {!connectingFrom && (
          <button
            onClick={() => onStartConnect(name)}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 12h8M12 8l4 4-4 4" />
            </svg>
            Make a connection
          </button>
        )}

        <button
          onClick={onOpenNotes}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Open Notes
        </button>

        {/* Remove Button */}
        <button
          onClick={() => onRemove(name)}
          className="w-full text-sm text-gray-500 hover:text-red-400 transition-colors py-1"
        >
          Remove from map
        </button>
      </div>
    </div>
  );
}
