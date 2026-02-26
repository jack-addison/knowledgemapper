"use client";

import { useCallback, useEffect, useState } from "react";
import Navbar from "@/components/Layout/Navbar";
import { KnowledgeMap, Recommendation } from "@/lib/types";

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export default function DiscoverPage() {
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [mapsLoading, setMapsLoading] = useState(true);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingName, setAddingName] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  async function fetchMaps() {
    setMapsLoading(true);
    try {
      const res = await fetch("/api/maps");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load maps");
        setMaps([]);
        setSelectedMapId(null);
        return;
      }

      const data: KnowledgeMap[] = await res.json();
      setMaps(data);

      setSelectedMapId((prev) => {
        if (prev && data.some((map) => map.id === prev)) return prev;
        const saved = getStoredString("km-active-map-id", "");
        if (saved && data.some((map) => map.id === saved)) return saved;
        return data[0]?.id || null;
      });
    } catch {
      setError("Failed to load maps");
      setMaps([]);
      setSelectedMapId(null);
    } finally {
      setMapsLoading(false);
    }
  }

  const handleDiscover = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!selectedMapId) {
        setRecommendations([]);
        return;
      }

      setLoading(true);
      if (!silent) setError("");
      try {
        const res = await fetch(
          `/api/discover?mapId=${encodeURIComponent(selectedMapId)}`
        );
        if (!res.ok) {
          const data = await res.json();
          if (!silent) {
            setError(data.error || "Failed to get recommendations");
          }
          return;
        }
        const data = await res.json();
        setRecommendations(Array.isArray(data) ? data : []);
        setAdded(new Set());
      } catch {
        if (!silent) {
          setError("Failed to get recommendations");
        }
      } finally {
        setLoading(false);
      }
    },
    [selectedMapId]
  );

  useEffect(() => {
    fetchMaps();
  }, []);

  useEffect(() => {
    if (!selectedMapId) return;
    localStorage.setItem("km-active-map-id", selectedMapId);
    handleDiscover({ silent: true });
  }, [selectedMapId, handleDiscover]);

  async function handleAddToMap(topicName: string) {
    if (!selectedMapId) {
      setError("Select a map first");
      return;
    }

    setAddingName(topicName);
    setError("");
    try {
      const res = await fetch("/api/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: topicName, mapId: selectedMapId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data.error === "string" && data.error.length > 0
            ? data.error
            : "Failed to add topic";
        setError(message);
        return;
      }
      setAdded((prev) => {
        const next = new Set(prev);
        next.add(topicName);
        return next;
      });
    } catch {
      setError("Failed to add topic");
    } finally {
      setAddingName(null);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-2xl font-bold">Discover</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Map</label>
            <select
              value={selectedMapId ?? ""}
              onChange={(e) => setSelectedMapId(e.target.value || null)}
              disabled={mapsLoading}
              className="px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              {maps.length === 0 && <option value="">No maps</option>}
              {maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-gray-400 text-sm mb-6">
          Based on your selected map, we&apos;ll suggest new topics that bridge
          what you already explore.
        </p>

        <button
          onClick={() => handleDiscover()}
          disabled={loading || !selectedMapId}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium transition-colors mb-8"
        >
          {loading ? "Thinking..." : "Refresh Recommendations"}
        </button>

        {error && <p className="text-red-400 mb-4">{error}</p>}

        {!loading && recommendations.length === 0 && !error && (
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <p className="text-gray-400 text-sm">
              No recommendations yet. Add more interests or refresh suggestions.
            </p>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec) => {
              const isAdded = added.has(rec.name);
              const isAdding = addingName === rec.name;
              return (
                <div
                  key={rec.name}
                  className="p-4 bg-gray-900 border border-gray-800 rounded-lg space-y-3"
                >
                  <h3 className="text-lg font-semibold text-blue-400">
                    {rec.name}
                  </h3>
                  <p className="text-gray-400 text-sm">{rec.reason}</p>
                  <button
                    onClick={() => handleAddToMap(rec.name)}
                    disabled={isAdded || isAdding || !selectedMapId}
                    className="px-3 py-1.5 text-sm rounded-md border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                  >
                    {isAdded
                      ? "Added"
                      : isAdding
                        ? "Adding..."
                        : "Add to Map"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && recommendations.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => handleDiscover({ silent: true })}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Try a different set
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
