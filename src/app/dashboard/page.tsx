"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Layout/Navbar";
import InterestPicker from "@/components/InterestPicker/InterestPicker";
import KnowledgeGraph from "@/components/Graph/KnowledgeGraph";
import TopicDetail from "@/components/TopicDetail/TopicDetail";
import NotesSidebar from "@/components/NotesSidebar/NotesSidebar";
import {
  EdgeNotesRecord,
  EdgeEvidence,
  EvidenceSource,
  GraphLinkSelection,
  Interest,
  GraphData,
  KnowledgeMap,
  SavedEdgeEvidence,
  SavedInterestEvidence,
  TopicEvidence,
} from "@/lib/types";
import {
  buildGraph,
  DEFAULT_CLUSTER_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "@/lib/graph";

const DEFAULT_LINK_FORCE_SCALE = 3;
const MAP_LAYOUT_STORAGE_PREFIX = "km-map-layout-settings:";

interface MapLayoutSettings {
  similarityThreshold: number;
  clusterThreshold: number;
  linkForceScale: number;
}

const DEFAULT_MAP_LAYOUT_SETTINGS: MapLayoutSettings = {
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  clusterThreshold: DEFAULT_CLUSTER_THRESHOLD,
  linkForceScale: DEFAULT_LINK_FORCE_SCALE,
};

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getMapLayoutStorageKey(mapId: string): string {
  return `${MAP_LAYOUT_STORAGE_PREFIX}${mapId}`;
}

function getStoredMapLayoutSettings(mapId: string): MapLayoutSettings {
  if (typeof window === "undefined") return DEFAULT_MAP_LAYOUT_SETTINGS;

  const raw = localStorage.getItem(getMapLayoutStorageKey(mapId));
  if (!raw) return DEFAULT_MAP_LAYOUT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<MapLayoutSettings>;
    return {
      similarityThreshold: clampValue(
        Number(parsed.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD),
        0.05,
        0.6
      ),
      clusterThreshold: clampValue(
        Number(parsed.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD),
        0.2,
        0.7
      ),
      linkForceScale: clampValue(
        Number(parsed.linkForceScale ?? DEFAULT_LINK_FORCE_SCALE),
        0.5,
        3
      ),
    };
  } catch {
    return DEFAULT_MAP_LAYOUT_SETTINGS;
  }
}

function saveMapLayoutSettings(
  mapId: string,
  updates: Partial<MapLayoutSettings>
): void {
  if (typeof window === "undefined") return;

  const current = getStoredMapLayoutSettings(mapId);
  const next: MapLayoutSettings = {
    similarityThreshold: updates.similarityThreshold ?? current.similarityThreshold,
    clusterThreshold: updates.clusterThreshold ?? current.clusterThreshold,
    linkForceScale: updates.linkForceScale ?? current.linkForceScale,
  };

  localStorage.setItem(getMapLayoutStorageKey(mapId), JSON.stringify(next));
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

function normalizeEdgePair(a: string, b: string): { a: string; b: string } {
  return a < b ? { a, b } : { a: b, b: a };
}

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export default function DashboardPage() {
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [newMapName, setNewMapName] = useState("");
  const [creatingMap, setCreatingMap] = useState(false);

  const [interests, setInterests] = useState<Interest[]>([]);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });

  const [loading, setLoading] = useState(false);
  const [mapsLoading, setMapsLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedTopic, setSelectedTopic] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [topicPanelExpanded, setTopicPanelExpanded] = useState(false);
  const [selectedTopicEvidence, setSelectedTopicEvidence] =
    useState<TopicEvidence | null>(null);
  const [selectedTopicEvidenceLoading, setSelectedTopicEvidenceLoading] =
    useState(false);
  const [selectedTopicEvidenceError, setSelectedTopicEvidenceError] = useState("");
  const [savedTopicEvidence, setSavedTopicEvidence] = useState<
    SavedInterestEvidence[]
  >([]);
  const [savedTopicEvidenceLoading, setSavedTopicEvidenceLoading] = useState(false);
  const [savedTopicEvidenceError, setSavedTopicEvidenceError] = useState("");
  const [savingTopicEvidenceUrl, setSavingTopicEvidenceUrl] = useState<
    string | null
  >(null);
  const [deletingTopicEvidenceId, setDeletingTopicEvidenceId] = useState<
    string | null
  >(null);
  const [selectedLink, setSelectedLink] = useState<GraphLinkSelection | null>(null);
  const [edgePanelExpanded, setEdgePanelExpanded] = useState(false);
  const [selectedLinkEvidence, setSelectedLinkEvidence] = useState<EdgeEvidence | null>(
    null
  );
  const [selectedLinkEvidenceLoading, setSelectedLinkEvidenceLoading] =
    useState(false);
  const [selectedLinkEvidenceError, setSelectedLinkEvidenceError] = useState("");
  const [savedEdgeEvidence, setSavedEdgeEvidence] = useState<SavedEdgeEvidence[]>(
    []
  );
  const [savedEdgeEvidenceLoading, setSavedEdgeEvidenceLoading] = useState(false);
  const [savedEdgeEvidenceError, setSavedEdgeEvidenceError] = useState("");
  const [savingEvidenceUrl, setSavingEvidenceUrl] = useState<string | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null);
  const [edgeNotes, setEdgeNotes] = useState("");
  const [edgeNotesLoading, setEdgeNotesLoading] = useState(false);
  const [edgeNotesSaving, setEdgeNotesSaving] = useState(false);
  const [edgeNotesError, setEdgeNotesError] = useState("");
  const [edgeNotesSavedAt, setEdgeNotesSavedAt] = useState<string | null>(null);
  const [notesTopic, setNotesTopic] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [threshold, setThreshold] = useState(DEFAULT_SIMILARITY_THRESHOLD);
  const [clusterThreshold, setClusterThreshold] = useState(DEFAULT_CLUSTER_THRESHOLD);
  const [linkForceScale, setLinkForceScale] = useState(DEFAULT_LINK_FORCE_SCALE);

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

  useEffect(() => {
    rebuildGraph(interests, threshold, clusterThreshold);
  }, [interests, threshold, clusterThreshold, rebuildGraph]);

  const fetchMaps = useCallback(async () => {
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
        if (prev && data.some((map) => map.id === prev)) {
          return prev;
        }

        const saved = getStoredString("km-active-map-id", "");
        if (saved && data.some((map) => map.id === saved)) {
          return saved;
        }

        return data[0]?.id || null;
      });
    } catch (err) {
      console.error("Failed to fetch maps:", err);
      setError("Failed to load maps");
      setMaps([]);
      setSelectedMapId(null);
    } finally {
      setMapsLoading(false);
    }
  }, []);

  const fetchInterests = useCallback(async () => {
    if (!selectedMapId) {
      setInterests([]);
      setInitialLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/interests?mapId=${encodeURIComponent(selectedMapId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setInterests(data);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to fetch interests");
        setInterests([]);
      }
    } catch (err) {
      console.error("Failed to fetch interests:", err);
      setError("Failed to fetch interests — check console for details");
      setInterests([]);
    } finally {
      setInitialLoading(false);
    }
  }, [selectedMapId]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  useEffect(() => {
    if (!selectedMapId) return;
    localStorage.setItem("km-active-map-id", selectedMapId);
  }, [selectedMapId]);

  useEffect(() => {
    if (!selectedMapId) {
      setThreshold(DEFAULT_SIMILARITY_THRESHOLD);
      setClusterThreshold(DEFAULT_CLUSTER_THRESHOLD);
      setLinkForceScale(DEFAULT_LINK_FORCE_SCALE);
      return;
    }

    const settings = getStoredMapLayoutSettings(selectedMapId);
    setThreshold(settings.similarityThreshold);
    setClusterThreshold(settings.clusterThreshold);
    setLinkForceScale(settings.linkForceScale);
  }, [selectedMapId]);

  useEffect(() => {
    if (mapsLoading) return;

    setInitialLoading(true);
    setSelectedTopic(null);
    setSelectedLink(null);
    setNotesTopic(null);
    setConnectingFrom(null);
    setConnectingResult(null);
    fetchInterests();
  }, [mapsLoading, selectedMapId, fetchInterests]);

  useEffect(() => {
    if (!notesTopic) return;
    const stillExists = interests.some((interest) => interest.id === notesTopic.id);
    if (!stillExists) {
      setNotesTopic(null);
    }
  }, [interests, notesTopic]);

  useEffect(() => {
    setTopicPanelExpanded(false);
  }, [selectedTopic?.id]);

  useEffect(() => {
    setSelectedTopicEvidence(null);
    setSelectedTopicEvidenceError("");
    setSelectedTopicEvidenceLoading(false);
    setSavedTopicEvidence([]);
    setSavedTopicEvidenceError("");
    setSavedTopicEvidenceLoading(false);
    setSavingTopicEvidenceUrl(null);
    setDeletingTopicEvidenceId(null);
  }, [selectedTopic]);

  useEffect(() => {
    if (!selectedTopic || !selectedMapId) return;

    const params = new URLSearchParams({
      mapId: selectedMapId,
      interestId: selectedTopic.id,
    });

    let cancelled = false;

    async function loadPersistedTopicEvidence() {
      setSavedTopicEvidenceLoading(true);
      setSavedTopicEvidenceError("");
      try {
        const res = await fetch(`/api/interests/evidence?${params.toString()}`);
        if (!cancelled) {
          if (res.ok) {
            const data: SavedInterestEvidence[] = await res.json();
            setSavedTopicEvidence(data);
          } else {
            const data = await res.json().catch(() => ({}));
            setSavedTopicEvidence([]);
            setSavedTopicEvidenceError(
              data.error || "Failed to load saved topic evidence"
            );
          }
        }
      } catch {
        if (!cancelled) {
          setSavedTopicEvidence([]);
          setSavedTopicEvidenceError("Failed to load saved topic evidence");
        }
      } finally {
        if (!cancelled) {
          setSavedTopicEvidenceLoading(false);
        }
      }
    }

    loadPersistedTopicEvidence();

    return () => {
      cancelled = true;
    };
  }, [selectedTopic, selectedMapId]);

  useEffect(() => {
    if (!selectedLink) return;
    const sourceExists = interests.some((interest) => interest.id === selectedLink.sourceId);
    const targetExists = interests.some((interest) => interest.id === selectedLink.targetId);
    if (!sourceExists || !targetExists) {
      setSelectedLink(null);
    }
  }, [interests, selectedLink]);

  useEffect(() => {
    setEdgePanelExpanded(false);
  }, [selectedLink?.sourceId, selectedLink?.targetId]);

  useEffect(() => {
    setSelectedLinkEvidence(null);
    setSelectedLinkEvidenceError("");
    setSelectedLinkEvidenceLoading(false);
    setSavedEdgeEvidence([]);
    setSavedEdgeEvidenceError("");
    setSavedEdgeEvidenceLoading(false);
    setSavingEvidenceUrl(null);
    setDeletingEvidenceId(null);
    setEdgeNotes("");
    setEdgeNotesError("");
    setEdgeNotesLoading(false);
    setEdgeNotesSaving(false);
    setEdgeNotesSavedAt(null);
  }, [selectedLink]);

  useEffect(() => {
    if (!selectedLink || !selectedMapId) return;

    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    const params = new URLSearchParams({
      mapId: selectedMapId,
      interestAId: pair.a,
      interestBId: pair.b,
    });

    let cancelled = false;

    async function loadPersistedEdgeContext() {
      setSavedEdgeEvidenceLoading(true);
      setSavedEdgeEvidenceError("");
      setEdgeNotesLoading(true);
      setEdgeNotesError("");
      setEdgeNotesSavedAt(null);

      try {
        const [evidenceRes, notesRes] = await Promise.all([
          fetch(`/api/edges/evidence?${params.toString()}`),
          fetch(`/api/edges/notes?${params.toString()}`),
        ]);

        if (!cancelled) {
          if (evidenceRes.ok) {
            const evidenceData: SavedEdgeEvidence[] = await evidenceRes.json();
            setSavedEdgeEvidence(evidenceData);
          } else {
            const data = await evidenceRes.json().catch(() => ({}));
            setSavedEdgeEvidence([]);
            setSavedEdgeEvidenceError(
              data.error || "Failed to load saved evidence"
            );
          }

          if (notesRes.ok) {
            const notesData: EdgeNotesRecord = await notesRes.json();
            setEdgeNotes(notesData.notes || "");
            setEdgeNotesSavedAt(notesData.updated_at);
          } else {
            const data = await notesRes.json().catch(() => ({}));
            setEdgeNotes("");
            setEdgeNotesError(data.error || "Failed to load edge notes");
          }
        }
      } catch {
        if (!cancelled) {
          setSavedEdgeEvidence([]);
          setSavedEdgeEvidenceError("Failed to load saved evidence");
          setEdgeNotes("");
          setEdgeNotesError("Failed to load edge notes");
        }
      } finally {
        if (!cancelled) {
          setSavedEdgeEvidenceLoading(false);
          setEdgeNotesLoading(false);
        }
      }
    }

    loadPersistedEdgeContext();

    return () => {
      cancelled = true;
    };
  }, [selectedLink, selectedMapId]);

  function handleThresholdChange(value: number) {
    setThreshold(value);
    if (selectedMapId) {
      saveMapLayoutSettings(selectedMapId, { similarityThreshold: value });
    }
  }

  function handleClusterThresholdChange(value: number) {
    setClusterThreshold(value);
    if (selectedMapId) {
      saveMapLayoutSettings(selectedMapId, { clusterThreshold: value });
    }
  }

  function handleLinkForceScaleChange(value: number) {
    setLinkForceScale(value);
    if (selectedMapId) {
      saveMapLayoutSettings(selectedMapId, { linkForceScale: value });
    }
  }

  async function handleCreateMap() {
    const name = newMapName.trim();
    if (!name) {
      setError("Map name is required");
      return;
    }

    setCreatingMap(true);
    setError("");
    try {
      const res = await fetch("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create map");
        return;
      }

      const created: KnowledgeMap = await res.json();
      setMaps((prev) => [...prev, created]);
      setSelectedMapId(created.id);
      setNewMapName("");
    } catch (err) {
      console.error("Failed to create map:", err);
      setError("Failed to create map");
    } finally {
      setCreatingMap(false);
    }
  }

  async function handleAddInterest(name: string) {
    if (!selectedMapId) {
      setError("Create or select a map first");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mapId: selectedMapId }),
      });
      if (res.ok) {
        await fetchInterests();
      } else {
        const data = await res.json().catch(() => ({}));
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
        body: JSON.stringify({ id: interest.id, mapId: selectedMapId }),
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
    if (!selectedMapId) {
      throw new Error("No map selected");
    }

    const res = await fetch("/api/interests/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics, mapId: selectedMapId }),
    });
    if (!res.ok) {
      throw new Error("Failed to expand");
    }
    await fetchInterests();
  }

  function handleStartConnect(topicName: string) {
    setConnectingFrom(topicName);
    setConnectingResult(null);
    setSelectedLink(null);
    setEdgePanelExpanded(false);
    setSelectedTopic(null);
    setTopicPanelExpanded(false);
    setNotesTopic(null);
  }

  async function handleCompleteConnect(topicB: string) {
    if (!connectingFrom || connectingFrom === topicB || !selectedMapId) return;

    setConnectingLoading(true);
    setConnectingResult(null);
    try {
      const res = await fetch("/api/interests/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicA: connectingFrom, topicB, mapId: selectedMapId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConnectingResult({ topic: data.topic, reason: data.reason });
        await fetchInterests();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to connect topics");
      }
    } catch (err) {
      console.error("Failed to connect topics:", err);
    } finally {
      setConnectingLoading(false);
      setConnectingFrom(null);
    }
  }

  function handleNodeClick(nodeId: string, nodeName: string) {
    if (connectingFrom) {
      handleCompleteConnect(nodeName);
      return;
    }

    setConnectingResult(null);
    setSelectedLink(null);
    setEdgePanelExpanded(false);
    const isSameNode = selectedTopic?.id === nodeId;
    if (isSameNode) {
      setSelectedTopic(null);
      setTopicPanelExpanded(false);
      setNotesTopic(null);
      return;
    }

    setSelectedTopic({ id: nodeId, name: nodeName });
    if (notesTopic && notesTopic.id !== nodeId) {
      setNotesTopic(null);
    }
  }

  function handleLinkClick(link: GraphLinkSelection) {
    if (connectingFrom) return;
    setConnectingResult(null);
    setSelectedTopic(null);
    setTopicPanelExpanded(false);
    setNotesTopic(null);
    setSelectedLink(link);
  }

  function getActiveTopicParams() {
    if (!selectedTopic || !selectedMapId) return null;
    return {
      mapId: selectedMapId,
      interestId: selectedTopic.id,
    };
  }

  async function handleLoadTopicEvidence() {
    if (!selectedTopic) return;

    setSelectedTopicEvidenceLoading(true);
    setSelectedTopicEvidenceError("");
    try {
      const res = await fetch("/api/research/node-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: selectedTopic.name,
        }),
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

  async function handleSaveTopicEvidenceSource(source: EvidenceSource) {
    const topicParams = getActiveTopicParams();
    if (!topicParams) return;

    setSavingTopicEvidenceUrl(source.url);
    setSavedTopicEvidenceError("");
    try {
      const res = await fetch("/api/interests/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...topicParams,
          source: {
            ...source,
            sourceProvider: "openalex",
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedTopicEvidenceError(
          data.error || "Failed to save topic evidence"
        );
        return;
      }

      const saved: SavedInterestEvidence = await res.json();
      setSavedTopicEvidence((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        if (exists) {
          return prev.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...prev];
      });
    } catch {
      setSavedTopicEvidenceError("Failed to save topic evidence");
    } finally {
      setSavingTopicEvidenceUrl(null);
    }
  }

  async function handleDeleteSavedTopicEvidence(id: string) {
    const topicParams = getActiveTopicParams();
    if (!topicParams) return;

    setDeletingTopicEvidenceId(id);
    setSavedTopicEvidenceError("");
    try {
      const res = await fetch("/api/interests/evidence", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...topicParams,
          id,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedTopicEvidenceError(
          data.error || "Failed to remove topic evidence"
        );
        return;
      }

      setSavedTopicEvidence((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setSavedTopicEvidenceError("Failed to remove topic evidence");
    } finally {
      setDeletingTopicEvidenceId(null);
    }
  }

  async function handleLoadLinkEvidence() {
    if (!selectedLink) return;

    setSelectedLinkEvidenceLoading(true);
    setSelectedLinkEvidenceError("");
    try {
      const res = await fetch("/api/research/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicA: selectedLink.sourceName,
          topicB: selectedLink.targetName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSelectedLinkEvidenceError(
          data.error || "Failed to load research evidence"
        );
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

  function getActiveEdgeParams() {
    if (!selectedLink || !selectedMapId) return null;
    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    return {
      mapId: selectedMapId,
      interestAId: pair.a,
      interestBId: pair.b,
    };
  }

  async function handleSaveEvidenceSource(source: EvidenceSource) {
    const edgeParams = getActiveEdgeParams();
    if (!edgeParams) return;

    setSavingEvidenceUrl(source.url);
    setSavedEdgeEvidenceError("");
    try {
      const res = await fetch("/api/edges/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...edgeParams,
          source: {
            ...source,
            sourceProvider: "openalex",
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedEdgeEvidenceError(data.error || "Failed to save evidence");
        return;
      }

      const saved: SavedEdgeEvidence = await res.json();
      setSavedEdgeEvidence((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        if (exists) {
          return prev.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...prev];
      });
    } catch {
      setSavedEdgeEvidenceError("Failed to save evidence");
    } finally {
      setSavingEvidenceUrl(null);
    }
  }

  async function handleDeleteSavedEvidence(id: string) {
    const edgeParams = getActiveEdgeParams();
    if (!edgeParams) return;

    setDeletingEvidenceId(id);
    setSavedEdgeEvidenceError("");
    try {
      const res = await fetch("/api/edges/evidence", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...edgeParams,
          id,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedEdgeEvidenceError(data.error || "Failed to remove evidence");
        return;
      }

      setSavedEdgeEvidence((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setSavedEdgeEvidenceError("Failed to remove evidence");
    } finally {
      setDeletingEvidenceId(null);
    }
  }

  async function handleSaveEdgeNotes() {
    const edgeParams = getActiveEdgeParams();
    if (!edgeParams) return;

    setEdgeNotesSaving(true);
    setEdgeNotesError("");
    try {
      const res = await fetch("/api/edges/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...edgeParams,
          notes: edgeNotes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEdgeNotesError(data.error || "Failed to save edge notes");
        return;
      }

      const saved: EdgeNotesRecord = await res.json();
      setEdgeNotes(saved.notes || "");
      setEdgeNotesSavedAt(saved.updated_at);
    } catch {
      setEdgeNotesError("Failed to save edge notes");
    } finally {
      setEdgeNotesSaving(false);
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
  const showLinkDetail = Boolean(selectedLink && !connectingFrom);

  if (mapsLoading || initialLoading) {
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
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="text-xl font-bold">Your Knowledge Map</h2>
              <span className="text-gray-500 text-xs">
                {interests.length} interests, {graphData.links.length} connections
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-400">Map</label>
              <select
                value={selectedMapId ?? ""}
                onChange={(e) => setSelectedMapId(e.target.value || null)}
                className="px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {maps.length === 0 && <option value="">No maps</option>}
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={newMapName}
                onChange={(e) => setNewMapName(e.target.value)}
                placeholder="New map name"
                className="px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleCreateMap}
                disabled={creatingMap}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-medium"
              >
                {creatingMap ? "Creating..." : "Create"}
              </button>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}

          <InterestPicker
            interests={interests.map((i) => i.name)}
            onAdd={handleAddInterest}
            loading={loading || !selectedMapId}
          />
        </div>

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

        {connectingFrom && (
          <div className="flex items-center gap-3 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            {connectingLoading ? (
              <p className="text-sm text-purple-300">
                Generating intersection topic...
              </p>
            ) : (
              <>
                <p className="text-sm text-purple-300">
                  Connecting from{" "}
                  <span className="font-semibold text-purple-200">
                    {connectingFrom}
                  </span>{" "}
                  — click another node to find the intersection
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

        {connectingResult && (
          <div className="flex items-center gap-3 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-sm text-green-300">
              Added{" "}
              <span className="font-semibold text-green-200">
                {connectingResult.topic}
              </span>
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

        <div className="relative flex-1 min-h-0">
          {selectedMapId ? (
            <KnowledgeGraph
              data={graphData}
              selectedNodeId={selectedTopic?.id}
              selectedLink={selectedLink}
              connectingFromName={connectingFrom}
              linkForceScale={linkForceScale}
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
              onBackgroundClick={() => {
                setSelectedTopic(null);
                setTopicPanelExpanded(false);
                setSelectedLink(null);
                setEdgePanelExpanded(false);
                setNotesTopic(null);
              }}
              reservedWidth={0}
            />
          ) : (
            <div className="h-[560px] flex items-center justify-center border border-gray-800 rounded-lg bg-gray-950/50">
              <p className="text-gray-500">Create a map to get started.</p>
            </div>
          )}

          {showTopicDetail && selectedTopic && (
            <div
              className={`absolute top-3 right-3 z-20 overflow-y-auto ${
                topicPanelExpanded
                  ? "w-[44rem] max-w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)]"
                  : "w-72 max-h-[calc(100%-1.5rem)]"
              }`}
            >
              <TopicDetail
                key={selectedTopic.id}
                name={selectedTopic.name}
                relatedTopics={
                  interests.find((i) => i.id === selectedTopic.id)?.related_topics ||
                  []
                }
                connectingFrom={connectingFrom}
                isExpanded={topicPanelExpanded}
                onToggleExpand={() =>
                  setTopicPanelExpanded((prevExpanded) => !prevExpanded)
                }
                onClose={() => {
                  setSelectedTopic(null);
                  setTopicPanelExpanded(false);
                }}
                onExpand={handleExpand}
                onRemove={(name) => {
                  handleRemoveInterest(name);
                }}
                onStartConnect={handleStartConnect}
                onOpenNotes={() => {
                  setNotesTopic(selectedTopic);
                  setSelectedTopic(null);
                  setTopicPanelExpanded(false);
                }}
                researchEvidence={selectedTopicEvidence}
                researchEvidenceLoading={selectedTopicEvidenceLoading}
                researchEvidenceError={selectedTopicEvidenceError}
                savedResearchEvidence={savedTopicEvidence}
                savedResearchEvidenceLoading={savedTopicEvidenceLoading}
                savedResearchEvidenceError={savedTopicEvidenceError}
                savingResearchEvidenceUrl={savingTopicEvidenceUrl}
                deletingResearchEvidenceId={deletingTopicEvidenceId}
                onLoadResearchEvidence={handleLoadTopicEvidence}
                onSaveResearchEvidence={handleSaveTopicEvidenceSource}
                onDeleteResearchEvidence={handleDeleteSavedTopicEvidence}
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

          {showLinkDetail && selectedLink && (
            <div
              className={`absolute top-3 right-3 z-20 overflow-y-auto ${
                edgePanelExpanded
                  ? "w-[48rem] max-w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)]"
                  : "w-80 max-h-[calc(100%-1.5rem)]"
              }`}
            >
              <aside className="border border-gray-700 rounded-lg bg-gray-900 p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      Connection details
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Why these topics are linked
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setEdgePanelExpanded((prevExpanded) => !prevExpanded)
                      }
                      className="px-2 py-1 rounded-md border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-gray-500"
                    >
                      {edgePanelExpanded ? "Collapse" : "Expand"}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedLink(null);
                        setEdgePanelExpanded(false);
                      }}
                      className="text-gray-400 hover:text-white text-sm"
                    >
                      ✕
                    </button>
                  </div>
                </div>

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

                <div className="space-y-2">
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
                      href={`https://scholar.google.com/scholar?q=${encodeURIComponent(
                        buildResearchQuery(selectedLink)
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                    >
                      Scholar
                    </a>
                    <a
                      href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(
                        buildResearchQuery(selectedLink)
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-xs text-gray-200 flex items-center"
                    >
                      S2
                    </a>
                  </div>

                  {selectedLinkEvidenceError && (
                    <p className="text-xs text-red-300">
                      {selectedLinkEvidenceError}
                    </p>
                  )}

                  {selectedLinkEvidence && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400 leading-relaxed">
                        {selectedLinkEvidence.summary}
                      </p>

                      {selectedLinkEvidence.sources.length > 0 ? (
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {selectedLinkEvidence.sources.map((source) => {
                            const saved = savedEdgeEvidence.some(
                              (item) => item.url === source.url
                            );
                            const saving = savingEvidenceUrl === source.url;

                            return (
                              <div
                                key={`${source.url}-${source.title}`}
                                className="rounded-md border border-gray-700 bg-gray-800/70 px-3 py-2 space-y-1"
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
                                    onClick={() => handleSaveEvidenceSource(source)}
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
                                <p className="text-xs text-emerald-300">
                                  {source.reason}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">
                          No direct papers found yet. Try Scholar/S2 with
                          broader terms.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">Saved evidence trail</p>
                      {savedEdgeEvidenceLoading && (
                        <span className="text-[11px] text-gray-500">Loading...</span>
                      )}
                    </div>

                    {savedEdgeEvidenceError && (
                      <p className="text-xs text-red-300">{savedEdgeEvidenceError}</p>
                    )}

                    {savedEdgeEvidence.length > 0 ? (
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {savedEdgeEvidence.map((source) => (
                          <div
                            key={source.id}
                            className="rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 space-y-1"
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
                                onClick={() => handleDeleteSavedEvidence(source.id)}
                                disabled={deletingEvidenceId === source.id}
                                className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50"
                              >
                                {deletingEvidenceId === source.id
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
                        No saved evidence for this connection yet.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">Edge notes</p>
                    <textarea
                      value={edgeNotes}
                      onChange={(e) => {
                        setEdgeNotes(e.target.value);
                        if (edgeNotesError) setEdgeNotesError("");
                      }}
                      placeholder="Capture claims, caveats, and why this link matters..."
                      disabled={edgeNotesLoading}
                      className="w-full min-h-[100px] rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-60"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs ${
                          edgeNotesError
                            ? "text-red-300"
                            : edgeNotesSavedAt
                              ? "text-green-300"
                              : "text-gray-500"
                        }`}
                      >
                        {edgeNotesError
                          ? edgeNotesError
                          : edgeNotesSavedAt
                            ? `Saved ${new Date(edgeNotesSavedAt).toLocaleString()}`
                            : edgeNotesLoading
                              ? "Loading notes..."
                              : " "}
                      </span>
                      <button
                        onClick={handleSaveEdgeNotes}
                        disabled={edgeNotesLoading || edgeNotesSaving}
                        className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm text-white"
                      >
                        {edgeNotesSaving ? "Saving..." : "Save edge notes"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedTopic({
                        id: selectedLink.sourceId,
                        name: selectedLink.sourceName,
                      });
                      setSelectedLink(null);
                      setEdgePanelExpanded(false);
                    }}
                    className="flex-1 px-3 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/60 text-sm text-gray-200"
                  >
                    Open {selectedLink.sourceName}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedTopic({
                        id: selectedLink.targetId,
                        name: selectedLink.targetName,
                      });
                      setSelectedLink(null);
                      setEdgePanelExpanded(false);
                    }}
                    className="flex-1 px-3 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/60 text-sm text-gray-200"
                  >
                    Open {selectedLink.targetName}
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
