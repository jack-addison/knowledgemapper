"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Layout/Navbar";
import InterestPicker from "@/components/InterestPicker/InterestPicker";
import KnowledgeGraph from "@/components/Graph/KnowledgeGraph";
import TopicDetail from "@/components/TopicDetail/TopicDetail";
import NotesSidebar from "@/components/NotesSidebar/NotesSidebar";
import { Interest, GraphData } from "@/lib/types";
import {
  buildGraph,
  DEFAULT_CLUSTER_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "@/lib/graph";

const DEFAULT_LINK_FORCE_SCALE = 3;

function getStoredNumber(
  key: string,
  fallback: number
): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function DashboardPage() {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [notesTopic, setNotesTopic] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [threshold, setThreshold] = useState(() =>
    getStoredNumber("km-similarity-threshold", DEFAULT_SIMILARITY_THRESHOLD)
  );
  const [clusterThreshold, setClusterThreshold] = useState(() =>
    getStoredNumber("km-cluster-threshold", DEFAULT_CLUSTER_THRESHOLD)
  );
  const [linkForceScale, setLinkForceScale] = useState(() =>
    getStoredNumber("km-link-force-scale", DEFAULT_LINK_FORCE_SCALE)
  );

  // Connection mode state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectingResult, setConnectingResult] = useState<{
    topic: string;
    reason: string;
  } | null>(null);
  const [connectingLoading, setConnectingLoading] = useState(false);

  const rebuildGraph = useCallback(
    (data: Interest[], similarity: number, cluster: number) => {
      setGraphData(
        buildGraph(data, {
          similarityThreshold: similarity,
          clusterThreshold: cluster,
        })
      );
    },
    []
  );

  const fetchInterests = useCallback(async () => {
    try {
      const res = await fetch("/api/interests");
      if (res.ok) {
        const data = await res.json();
        setInterests(data);
        rebuildGraph(data, threshold, clusterThreshold);
      }
    } catch (err) {
      console.error("Failed to fetch interests:", err);
    } finally {
      setInitialLoading(false);
    }
  }, [rebuildGraph, threshold, clusterThreshold]);

  useEffect(() => {
    fetchInterests();
  }, [fetchInterests]);

  useEffect(() => {
    if (!notesTopic) return;
    const stillExists = interests.some((interest) => interest.id === notesTopic.id);
    if (!stillExists) {
      setNotesTopic(null);
    }
  }, [interests, notesTopic]);

  function handleThresholdChange(value: number) {
    setThreshold(value);
    localStorage.setItem("km-similarity-threshold", value.toString());
    rebuildGraph(interests, value, clusterThreshold);
  }

  function handleClusterThresholdChange(value: number) {
    setClusterThreshold(value);
    localStorage.setItem("km-cluster-threshold", value.toString());
    rebuildGraph(interests, threshold, value);
  }

  function handleLinkForceScaleChange(value: number) {
    setLinkForceScale(value);
    localStorage.setItem("km-link-force-scale", value.toString());
  }

  async function handleAddInterest(name: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await fetchInterests();
      } else {
        const data = await res.json();
        setError(data.error || `Failed to add interest (${res.status})`);
      }
    } catch (err) {
      console.error("Failed to add interest:", err);
      setError("Failed to add interest — check console for details");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveInterest(name: string) {
    const interest = interests.find((i) => i.name === name);
    if (!interest) return;

    try {
      const res = await fetch("/api/interests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: interest.id }),
      });
      if (res.ok) {
        if (selectedTopic?.name === name) {
          setSelectedTopic(null);
        }
        if (notesTopic?.id === interest.id) {
          setNotesTopic(null);
        }
        await fetchInterests();
      }
    } catch (err) {
      console.error("Failed to remove interest:", err);
    }
  }

  async function handleExpand(topics: string[]) {
    const res = await fetch("/api/interests/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics }),
    });
    if (!res.ok) {
      throw new Error("Failed to expand");
    }
    await fetchInterests();
  }

  function handleStartConnect(topicName: string) {
    setConnectingFrom(topicName);
    setConnectingResult(null);
    setSelectedTopic(null);
    setNotesTopic(null);
  }

  async function handleCompleteConnect(topicB: string) {
    if (!connectingFrom || connectingFrom === topicB) return;

    setConnectingLoading(true);
    setConnectingResult(null);
    try {
      const res = await fetch("/api/interests/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicA: connectingFrom, topicB }),
      });
      if (res.ok) {
        const data = await res.json();
        setConnectingResult({ topic: data.topic, reason: data.reason });
        await fetchInterests();
      }
    } catch (err) {
      console.error("Failed to connect topics:", err);
    } finally {
      setConnectingLoading(false);
      setConnectingFrom(null);
    }
  }

  function handleNodeClick(nodeId: string, nodeName: string) {
    // If in connection mode, complete the connection
    if (connectingFrom) {
      handleCompleteConnect(nodeName);
      return;
    }

    setConnectingResult(null);
    const isSameNode = selectedTopic?.id === nodeId;
    if (isSameNode) {
      setSelectedTopic(null);
      setNotesTopic(null);
      return;
    }

    setSelectedTopic({ id: nodeId, name: nodeName });
    if (notesTopic && notesTopic.id !== nodeId) {
      setNotesTopic(null);
    }
  }

  async function handleSaveNotes(topicId: string, notes: string) {
    const res = await fetch("/api/interests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: topicId, notes }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save notes");
    }

    setInterests((prev) =>
      prev.map((interest) =>
        interest.id === topicId ? { ...interest, notes } : interest
      )
    );
  }

  const showTopicDetail = Boolean(selectedTopic && !connectingFrom);
  const showNotesSidebar = Boolean(notesTopic && !connectingFrom);

  if (initialLoading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center h-96">
          <p className="text-gray-400">Loading your knowledge map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 px-4 py-3 space-y-3 max-w-[1800px] mx-auto w-full">
        {/* Compact top bar: title + interest picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold">Your Knowledge Map</h2>
            <span className="text-gray-500 text-xs">
              {interests.length} interests, {graphData.links.length} connections
            </span>
          </div>
          {error && (
            <p className="text-red-400 text-sm mb-2">{error}</p>
          )}
          <InterestPicker
            interests={interests.map((i) => i.name)}
            onAdd={handleAddInterest}
            loading={loading}
          />
        </div>

        {/* Similarity slider */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400 whitespace-nowrap">
            Similarity
          </label>
          <input
            type="range"
            min={0.05}
            max={0.6}
            step={0.01}
            value={threshold}
            onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
            className="w-48 h-1 accent-blue-500"
          />
          <span className="text-xs text-gray-500 font-mono w-8">
            {threshold.toFixed(2)}
          </span>
          <span className="text-xs text-gray-500">
            Higher means only stronger topic similarities create links.
          </span>
        </div>

        {/* Advanced graph controls */}
        <details className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
          <summary className="text-xs text-gray-400 cursor-pointer select-none">
            Advanced layout
          </summary>
          <div className="space-y-2 mt-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 whitespace-nowrap w-24">
                Cluster
              </label>
              <input
                type="range"
                min={0.2}
                max={0.7}
                step={0.01}
                value={clusterThreshold}
                onChange={(e) =>
                  handleClusterThresholdChange(parseFloat(e.target.value))
                }
                className="w-48 h-1 accent-emerald-500"
              />
              <span className="text-xs text-gray-500 font-mono w-8">
                {clusterThreshold.toFixed(2)}
              </span>
              <span className="text-xs text-gray-500">
                Higher means fewer, tighter color-grouped clusters.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 whitespace-nowrap w-24">
                Link pull
              </label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={linkForceScale}
                onChange={(e) =>
                  handleLinkForceScaleChange(parseFloat(e.target.value))
                }
                className="w-48 h-1 accent-purple-500"
              />
              <span className="text-xs text-gray-500 font-mono w-8">
                {linkForceScale.toFixed(2)}
              </span>
              <span className="text-xs text-gray-500">
                Higher makes connected nodes pull toward each other more.
              </span>
            </div>
          </div>
        </details>

        {/* Connection mode banner */}
        {connectingFrom && (
          <div className="flex items-center gap-3 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            {connectingLoading ? (
              <p className="text-sm text-purple-300">
                Generating intersection topic...
              </p>
            ) : (
              <>
                <p className="text-sm text-purple-300">
                  Connecting from <span className="font-semibold text-purple-200">{connectingFrom}</span> — click another node to find the intersection
                </p>
                <button
                  onClick={() => setConnectingFrom(null)}
                  className="text-xs text-purple-400 hover:text-white ml-auto"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {/* Connection result */}
        {connectingResult && (
          <div className="flex items-center gap-3 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-sm text-green-300">
              Added <span className="font-semibold text-green-200">{connectingResult.topic}</span>
              {connectingResult.reason && (
                <span className="text-green-400"> — {connectingResult.reason}</span>
              )}
            </p>
            <button
              onClick={() => setConnectingResult(null)}
              className="text-xs text-green-400 hover:text-white ml-auto"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Graph + floating side panel */}
        <div className="relative flex-1 min-h-0">
          <KnowledgeGraph
            data={graphData}
            selectedNodeId={selectedTopic?.id}
            connectingFromName={connectingFrom}
            linkForceScale={linkForceScale}
            onNodeClick={handleNodeClick}
            onBackgroundClick={() => {
              setSelectedTopic(null);
              setNotesTopic(null);
            }}
            reservedWidth={0}
          />

          {showTopicDetail && selectedTopic && (
            <div className="absolute top-3 right-3 w-72 z-20 max-h-[calc(100%-1.5rem)] overflow-y-auto">
              <TopicDetail
                key={selectedTopic.id}
                name={selectedTopic.name}
                relatedTopics={
                  interests.find((i) => i.id === selectedTopic.id)
                    ?.related_topics || []
                }
                connectingFrom={connectingFrom}
                onClose={() => setSelectedTopic(null)}
                onExpand={handleExpand}
                onRemove={(name) => {
                  handleRemoveInterest(name);
                }}
                onStartConnect={handleStartConnect}
                onOpenNotes={() => {
                  setNotesTopic(selectedTopic);
                  setSelectedTopic(null);
                }}
              />
            </div>
          )}

          {showNotesSidebar && notesTopic && (
            <div className="absolute top-3 right-3 w-80 z-20 max-h-[calc(100%-1.5rem)] overflow-y-auto">
              <NotesSidebar
                topicName={notesTopic.name}
                initialNotes={
                  interests.find((interest) => interest.id === notesTopic.id)
                    ?.notes || ""
                }
                onSave={(notes) => handleSaveNotes(notesTopic.id, notes)}
                onClose={() => setNotesTopic(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
