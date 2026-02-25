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
        {/* YouTube Link */}
        <a
          href={getYouTubeSearchUrl(name)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
            <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#0a0a0a" />
          </svg>
          Watch videos about {name}
        </a>

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

        {/* Wikipedia Link */}
        <a
          href={getWikipediaUrl(name)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.407 0 .2.11.58.328 1.142 1.464 3.575 3.144 7.312 4.104 9.464l.043.092 2.862-5.737c-.233-.467-.886-1.851-1.466-3.097-.465-.998-.825-1.79-1.08-2.375-.217-.496-.455-.705-.974-.705h-.217c-.15 0-.224-.056-.224-.176v-.434l.049-.045h4.179l.052.045v.434c0 .119-.076.176-.227.176h-.263c-.6 0-.9.213-.9.637 0 .142.057.381.171.72l1.794 4.049 1.881-3.853c.135-.293.203-.563.203-.808 0-.373-.263-.672-.789-.672h-.373c-.15 0-.225-.057-.225-.176v-.434l.051-.045h3.772l.052.045v.434c0 .119-.076.176-.224.176-.893.015-1.267.313-1.68 1.06-.142.256-1.416 2.787-2.082 4.111l3.245 6.525c.483-.881 2.293-4.605 3.055-6.262.396-.856.599-1.525.599-2.001 0-.471-.262-.731-.789-.784l-.394-.031c-.15 0-.224-.057-.224-.176v-.434l.051-.045c.924-.005 3.678 0 3.678 0l.052.045v.434c0 .119-.076.176-.225.176-.715.031-1.266.372-1.655 1.021-.384.649-2.022 3.863-3.343 6.554l-.329.661z" />
          </svg>
          Read on Wikipedia
        </a>

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
