"use client";

import { useState } from "react";
import Navbar from "@/components/Layout/Navbar";
import { Recommendation } from "@/lib/types";

export default function DiscoverPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDiscover() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/discover");
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to get recommendations");
        return;
      }
      const data = await res.json();
      setRecommendations(data);
    } catch {
      setError("Failed to get recommendations");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-3xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-2">Discover</h2>
        <p className="text-gray-400 text-sm mb-6">
          Based on your interests, we&apos;ll suggest new topics you might enjoy
          exploring. These recommendations find connections between your existing
          interests.
        </p>

        <button
          onClick={handleDiscover}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium transition-colors mb-8"
        >
          {loading ? "Thinking..." : "Get Recommendations"}
        </button>

        {error && <p className="text-red-400 mb-4">{error}</p>}

        {recommendations.length > 0 && (
          <div className="space-y-4">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className="p-4 bg-gray-900 border border-gray-800 rounded-lg"
              >
                <h3 className="text-lg font-semibold text-blue-400">
                  {rec.name}
                </h3>
                <p className="text-gray-400 text-sm mt-1">{rec.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
