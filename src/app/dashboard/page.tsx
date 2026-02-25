"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Layout/Navbar";
import InterestPicker from "@/components/InterestPicker/InterestPicker";
import KnowledgeGraph from "@/components/Graph/KnowledgeGraph";
import TopicDetail from "@/components/TopicDetail/TopicDetail";
import NotesSidebar from "@/components/NotesSidebar/NotesSidebar";
import { Interest, GraphData } from "@/lib/types";
import { buildGraph } from "@/lib/graph";

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
  const [threshold, setThreshold] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("km-similarity-threshold");
      if (saved) return parseFloat(saved);
    }
    return 0.2;
  });

  // Connection mode state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectingResult, setConnectingResult] = useState<{
    topic: string;
    reason: string;
  } | null>(null);
  const [connectingLoading, setConnectingLoading] = useState(false);

  const rebuildGraph = useCallback(
    (data: Interest[], t: number) => {
      setGraphData(buildGraph(data, t));
    },
    []
  );

  const fetchInterests = useCallback(async () => {
    try {
      const res = await fetch("/api/interests");
      if (res.ok) {
        const data = await res.json();
        setInterests(data);
        rebuildGraph(data, threshold);
      }
    } catch (err) {
      console.error("Failed to fetch interests:", err);
    } finally {
      setInitialLoading(false);
    }
  }, [rebuildGraph, threshold]);

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
    rebuildGraph(interests, value);
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
  const reservedWidth =
    (showTopicDetail ? 288 : 0) +
    (showNotesSidebar ? 320 : 0) +
    (showTopicDetail ? 16 : 0) +
    (showNotesSidebar ? 16 : 0);

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
      <div className="flex-1 px-4 py-3 space-y-3 max-w-[1400px] mx-auto w-full">
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
            onRemove={handleRemoveInterest}
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
        </div>

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

        {/* Graph + optional side panel */}
        <div className="flex gap-4 flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <KnowledgeGraph
              data={graphData}
              selectedNodeId={selectedTopic?.id}
              connectingFromName={connectingFrom}
              onNodeClick={handleNodeClick}
              onBackgroundClick={() => {
                setSelectedTopic(null);
                setNotesTopic(null);
              }}
              reservedWidth={reservedWidth}
            />
          </div>

          {showTopicDetail && selectedTopic && (
            <div className="w-72 flex-shrink-0">
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
            <div className="w-80 flex-shrink-0">
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
