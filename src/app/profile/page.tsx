"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Layout/Navbar";
import { createClient } from "@/lib/supabase";
import { buildGraph } from "@/lib/graph";
import type { Interest, KnowledgeMap } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

interface MapStats {
  mapId: string;
  mapName: string;
  topicCount: number;
  notesCount: number;
  connectionCount: number;
  lastTopicAt: string | null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supabase = createClient();

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      setError("");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        setError("Failed to load account details");
        setLoading(false);
        return;
      }

      setUser(user);

      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const [mapsRes, interestsRes] = await Promise.all([
          fetch("/api/maps"),
          fetch("/api/interests"),
        ]);

        if (!mapsRes.ok || !interestsRes.ok) {
          setError("Failed to load profile analytics");
          return;
        }

        const [mapsData, interestsData]: [KnowledgeMap[], Interest[]] =
          await Promise.all([mapsRes.json(), interestsRes.json()]);

        setMaps(Array.isArray(mapsData) ? mapsData : []);
        setInterests(Array.isArray(interestsData) ? interestsData : []);
      } catch {
        setError("Failed to load profile analytics");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [supabase]);

  const mapStats = useMemo<MapStats[]>(() => {
    return maps.map((map) => {
      const mapInterests = interests.filter((interest) => interest.map_id === map.id);
      const notesCount = mapInterests.filter(
        (interest) => typeof interest.notes === "string" && interest.notes.trim().length > 0
      ).length;
      const graph = buildGraph(mapInterests);
      const lastTopicAt = mapInterests
        .map((interest) => interest.created_at)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

      return {
        mapId: map.id,
        mapName: map.name,
        topicCount: mapInterests.length,
        notesCount,
        connectionCount: graph.links.length,
        lastTopicAt,
      };
    });
  }, [maps, interests]);

  const totalTopics = interests.length;
  const totalMaps = maps.length;
  const totalConnections = useMemo(() => buildGraph(interests).links.length, [interests]);
  const totalNotes = useMemo(
    () =>
      interests.filter(
        (interest) => typeof interest.notes === "string" && interest.notes.trim().length > 0
      ).length,
    [interests]
  );
  const noteCoverage = totalTopics > 0 ? Math.round((totalNotes / totalTopics) * 100) : 0;
  const accountDays = daysSince(user?.created_at);

  const recentTopics = useMemo(() => {
    return [...interests]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6);
  }, [interests]);

  const topTerms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const interest of interests) {
      for (const token of tokenize(interest.name)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [interests]);

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="rounded-2xl border border-gray-800 bg-gradient-to-r from-gray-900 via-gray-900 to-slate-900 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/90 mb-2">
            Profile
          </p>
          <h2 className="text-3xl font-bold">Learning Account</h2>
          <p className="text-gray-400 mt-2">
            View your map health, topic growth, and note coverage in one place.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white"
            >
              Open Map
            </Link>
            <Link
              href="/discover"
              className="px-3 py-1.5 text-sm rounded-md border border-gray-700 hover:border-gray-500 text-gray-200"
            >
              Discover Topics
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <p className="text-gray-400">Loading profile analytics...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Maps</p>
                <p className="text-3xl font-semibold mt-1">{totalMaps}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Topics Mapped
                </p>
                <p className="text-3xl font-semibold mt-1">{totalTopics}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Connections
                </p>
                <p className="text-3xl font-semibold mt-1">{totalConnections}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Notes Coverage
                </p>
                <p className="text-3xl font-semibold mt-1">{noteCoverage}%</p>
                <p className="text-xs text-gray-500 mt-1">
                  {totalNotes} of {totalTopics} topics have notes
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <section className="xl:col-span-1 rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
                <h3 className="text-lg font-semibold">Account Details</h3>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Email</p>
                  <p className="text-gray-100 mt-1 break-all">{user?.email || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Member Since
                  </p>
                  <p className="text-gray-100 mt-1">{formatDate(user?.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Account Age
                  </p>
                  <p className="text-gray-100 mt-1">
                    {accountDays === null ? "N/A" : `${accountDays} days`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Primary Provider
                  </p>
                  <p className="text-gray-100 mt-1 capitalize">
                    {String(user?.app_metadata?.provider || "email")}
                  </p>
                </div>
              </section>

              <section className="xl:col-span-2 rounded-xl border border-gray-800 bg-gray-900 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Map Breakdown</h3>
                  <span className="text-xs text-gray-500">
                    Per-map topic and note activity
                  </span>
                </div>

                {mapStats.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No maps found. Create your first map from the dashboard.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 border-b border-gray-800">
                          <th className="py-2 pr-3 font-medium">Map</th>
                          <th className="py-2 pr-3 font-medium">Topics</th>
                          <th className="py-2 pr-3 font-medium">Connections</th>
                          <th className="py-2 pr-3 font-medium">Notes</th>
                          <th className="py-2 font-medium">Last Topic Added</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapStats.map((map) => (
                          <tr
                            key={map.mapId}
                            className="border-b border-gray-800/70 text-gray-200"
                          >
                            <td className="py-2 pr-3 font-medium">{map.mapName}</td>
                            <td className="py-2 pr-3">{map.topicCount}</td>
                            <td className="py-2 pr-3">{map.connectionCount}</td>
                            <td className="py-2 pr-3">{map.notesCount}</td>
                            <td className="py-2">{formatDate(map.lastTopicAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="text-lg font-semibold mb-3">Recent Topics</h3>
                {recentTopics.length === 0 ? (
                  <p className="text-sm text-gray-500">No topics added yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {recentTopics.map((topic) => {
                      const mapName =
                        maps.find((map) => map.id === topic.map_id)?.name || "Unknown map";
                      return (
                        <li
                          key={topic.id}
                          className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2"
                        >
                          <p className="text-sm text-gray-100">{topic.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {mapName} · Added {formatDate(topic.created_at)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="text-lg font-semibold mb-3">Top Theme Terms</h3>
                {topTerms.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    Add more topics to surface recurring terms.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {topTerms.map(([term, count]) => (
                      <span
                        key={term}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200"
                      >
                        {term}
                        <span className="text-cyan-300/80">{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
