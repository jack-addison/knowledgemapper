"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Navbar from "@/components/Layout/Navbar";
import KnowledgeGraph from "@/components/Graph/KnowledgeGraph";
import TopicDetail from "@/components/TopicDetail/TopicDetail";
import NotesSidebar from "@/components/NotesSidebar/NotesSidebar";
import GraphAssistantPanel from "@/components/Assistant/GraphAssistantPanel";
import {
  EdgeNotesRecord,
  EdgeEvidence,
  EvidenceSource,
  GraphLinkSelection,
  GraphLayoutMode,
  Interest,
  GraphData,
  KnowledgeMap,
  SavedEdgeEvidence,
  SavedInterestEvidence,
  TdaMapHealth,
  TopicEvidence,
} from "@/lib/types";
import {
  buildGraph,
  DEFAULT_CLUSTER_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "@/lib/graph";
import { computeTdaMapHealth } from "@/lib/tda";

const DEFAULT_LINK_FORCE_SCALE = 3;
const MAP_LAYOUT_STORAGE_PREFIX = "km-map-layout-settings:";
const COMBINED_MAP_ID = "__combined__";
const COMBINED_MAP_NAME = "Combined (All Maps)";
const PANEL_TRANSITION_MS = 180;

function isCombinedMapId(mapId: string | null): boolean {
  return mapId === COMBINED_MAP_ID;
}

function normalizeCombinedTopicKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildCombinedInterestId(topicKey: string): string {
  return `combined:${encodeURIComponent(topicKey)}`;
}

function averageEmbeddings(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) return null;

  const dimensionCounts = new Map<number, number>();
  for (const embedding of embeddings) {
    dimensionCounts.set(
      embedding.length,
      (dimensionCounts.get(embedding.length) || 0) + 1
    );
  }

  let preferredDimension = 0;
  let preferredCount = 0;
  for (const [dimension, count] of dimensionCounts.entries()) {
    if (count > preferredCount) {
      preferredDimension = dimension;
      preferredCount = count;
    }
  }

  if (preferredDimension <= 0) return null;

  const compatible = embeddings.filter(
    (embedding) => embedding.length === preferredDimension
  );
  if (compatible.length === 0) return null;

  const average = new Array(preferredDimension).fill(0);
  for (const embedding of compatible) {
    for (let i = 0; i < preferredDimension; i++) {
      average[i] += embedding[i];
    }
  }

  for (let i = 0; i < preferredDimension; i++) {
    average[i] /= compatible.length;
  }

  return average;
}

function mergeInterestsForCombined(
  interests: Interest[],
  mapNameById: Map<string, string>
): {
  mergedInterests: Interest[];
  membersByMergedId: Record<string, Interest[]>;
} {
  const grouped = new Map<string, Interest[]>();
  for (const interest of interests) {
    const key = normalizeCombinedTopicKey(interest.name);
    if (!key) continue;
    const existing = grouped.get(key) || [];
    existing.push(interest);
    grouped.set(key, existing);
  }

  const mergedInterests: Interest[] = [];
  const membersByMergedId: Record<string, Interest[]> = {};

  for (const [topicKey, members] of grouped.entries()) {
    const sortedMembers = [...members].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    const representative = sortedMembers[0];
    const mergedId = buildCombinedInterestId(topicKey);

    const notesByMap = sortedMembers
      .map((member) => {
        const note = member.notes?.trim();
        if (!note) return null;
        const mapLabel = mapNameById.get(member.map_id) || member.map_id;
        return `${mapLabel}:\n${note}`;
      })
      .filter((item): item is string => Boolean(item));

    const uniqueRelatedTopics = Array.from(
      new Set(
        sortedMembers.flatMap((member) =>
          (member.related_topics || [])
            .map((topic) => topic.trim())
            .filter((topic) => topic.length > 0)
        )
      )
    ).slice(0, 50);

    const mergedEmbedding = averageEmbeddings(
      sortedMembers
        .map((member) => member.embedding)
        .filter(
          (embedding): embedding is number[] =>
            Array.isArray(embedding) && embedding.length > 0
        )
    );

    mergedInterests.push({
      id: mergedId,
      user_id: representative.user_id,
      map_id: COMBINED_MAP_ID,
      name: representative.name.trim() || representative.name,
      embedding: mergedEmbedding,
      related_topics: uniqueRelatedTopics,
      notes: notesByMap.join("\n\n"),
      created_at: representative.created_at,
    });

    membersByMergedId[mergedId] = sortedMembers;
  }

  mergedInterests.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { mergedInterests, membersByMergedId };
}

interface MapLayoutSettings {
  similarityThreshold: number;
  clusterThreshold: number;
  linkForceScale: number;
  layoutMode: GraphLayoutMode;
}

const DEFAULT_MAP_LAYOUT_SETTINGS: MapLayoutSettings = {
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  clusterThreshold: DEFAULT_CLUSTER_THRESHOLD,
  linkForceScale: DEFAULT_LINK_FORCE_SCALE,
  layoutMode: "umap",
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
    const parsedLayoutMode =
      parsed.layoutMode === "umap" || parsed.layoutMode === "classic"
        ? parsed.layoutMode
        : DEFAULT_MAP_LAYOUT_SETTINGS.layoutMode;

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
      layoutMode: parsedLayoutMode,
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
    layoutMode: updates.layoutMode ?? current.layoutMode,
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

function getArxivSearchUrl(query: string): string {
  return `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`;
}

function getCrossrefSearchUrl(query: string): string {
  return `https://search.crossref.org/?q=${encodeURIComponent(query)}`;
}

function getCoreSearchUrl(query: string): string {
  return `https://core.ac.uk/search?q=${encodeURIComponent(query)}`;
}

function getPubMedSearchUrl(query: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}

function buildEdgeResearchQuestions(link: GraphLinkSelection): string[] {
  return [
    `What mechanisms most plausibly connect ${link.sourceName} and ${link.targetName}?`,
    `Which papers provide the strongest empirical evidence for this link?`,
    `Are there high-quality papers arguing against or weakening this connection?`,
    `In which contexts does ${link.sourceName} influence ${link.targetName} the most?`,
    `What methods or datasets are commonly used to study this relationship?`,
  ];
}

function buildEdgeSearchAngles(link: GraphLinkSelection): string[] {
  return [
    `${link.sourceName} ${link.targetName} systematic review`,
    `${link.sourceName} ${link.targetName} meta analysis`,
    `${link.sourceName} ${link.targetName} benchmark dataset`,
    `${link.sourceName} ${link.targetName} causal mechanism`,
    `${link.sourceName} ${link.targetName} contradictory findings`,
  ];
}

function buildEdgeNoteTemplates(link: GraphLinkSelection): string[] {
  return [
    `Claim:\n- ${link.sourceName} influences ${link.targetName} by ...`,
    "Evidence summary:\n- Source:\n- Method:\n- Key finding:\n- Confidence:",
    "Counter-evidence:\n- Source:\n- Contradiction or limitation:",
    `Open question:\n- Under what conditions does ${link.sourceName} fail to predict ${link.targetName}?`,
    "Next experiment:\n- Dataset:\n- Method:\n- Outcome to test:",
  ];
}

function normalizeEdgePair(a: string, b: string): { a: string; b: string } {
  return a < b ? { a, b } : { a: b, b: a };
}

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function normalizePaperUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildPublicShareUrl(shareSlug: string): string {
  if (typeof window === "undefined") return `/shared/${shareSlug}`;
  return `${window.location.origin}/shared/${shareSlug}`;
}

function buildPublicShareUrlWithLayout(
  shareSlug: string,
  settings: {
    similarityThreshold: number;
    clusterThreshold: number;
    linkForceScale: number;
    layoutMode: GraphLayoutMode;
  }
): string {
  const baseUrl = buildPublicShareUrl(shareSlug);
  const similarity = clampValue(settings.similarityThreshold, 0.05, 0.6);
  const cluster = clampValue(settings.clusterThreshold, 0.2, 0.7);
  const linkForce = clampValue(settings.linkForceScale, 0.5, 3);

  if (typeof window !== "undefined") {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set("similarity", similarity.toFixed(2));
    url.searchParams.set("cluster", cluster.toFixed(2));
    url.searchParams.set("linkForce", linkForce.toFixed(2));
    url.searchParams.set("layoutMode", settings.layoutMode);
    return url.toString();
  }

  const params = new URLSearchParams({
    similarity: similarity.toFixed(2),
    cluster: cluster.toFixed(2),
    linkForce: linkForce.toFixed(2),
    layoutMode: settings.layoutMode,
  });
  return `${baseUrl}?${params.toString()}`;
}

function getGraphEndpointId(endpoint: unknown): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (!endpoint || typeof endpoint !== "object") return null;
  const id = (endpoint as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function toSafeFilenameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "map";
}

function sanitizeBibtexValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBibtexKey(prefix: string, title: string, index: number): string {
  const titlePart = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 28);
  return `${prefix}${titlePart || "source"}${index + 1}`;
}

function formatEvidenceAsBibtex(
  source: EvidenceSource,
  keyPrefix: string,
  index: number
): string {
  const key = buildBibtexKey(keyPrefix, source.title, index);
  const safeTitle = sanitizeBibtexValue(source.title);
  const safeUrl = source.url.trim();
  const safeAuthors = source.authors
    .map((author) => sanitizeBibtexValue(author))
    .filter((author) => author.length > 0);
  const safeJournal = source.journal.trim();
  const safeReason = source.reason.trim();

  const lines: string[] = [
    `@misc{${key},`,
    `  title = {${safeTitle}},`,
  ];

  if (safeAuthors.length > 0) {
    lines.push(`  author = {${safeAuthors.join(" and ")}},`);
  }
  if (typeof source.year === "number" && Number.isFinite(source.year)) {
    lines.push(`  year = {${Math.trunc(source.year)}},`);
  }
  if (safeJournal) {
    lines.push(`  note = {Venue: ${sanitizeBibtexValue(safeJournal)}},`);
  }
  lines.push(`  howpublished = {\\url{${safeUrl}}},`);
  if (safeReason) {
    lines.push(`  annote = {${sanitizeBibtexValue(safeReason)}},`);
  }
  lines.push("}");

  return lines.join("\n");
}

function buildNodeExportBlock(
  interest: Interest,
  evidence: EvidenceSource[],
  nodeIndex: number
): string {
  const bibtexText =
    evidence.length > 0
      ? evidence
          .map((source, sourceIndex) =>
            formatEvidenceAsBibtex(
              source,
              `node${nodeIndex + 1}`,
              sourceIndex
            )
          )
          .join("\n\n")
      : "No bibtex items";

  return [
    "Node Name",
    interest.name,
    bibtexText,
    "Notes on node",
    interest.notes.trim() || "None",
  ].join("\n");
}

function buildEdgeExportBlock(
  edgeName: string,
  evidence: EvidenceSource[],
  notes: string,
  edgeIndex: number
): string {
  const bibtexText =
    evidence.length > 0
      ? evidence
          .map((source, sourceIndex) =>
            formatEvidenceAsBibtex(
              source,
              `edge${edgeIndex + 1}`,
              sourceIndex
            )
          )
          .join("\n\n")
      : "No bibtex items";

  return [
    "Edge Name",
    edgeName,
    bibtexText,
    "Notes on edge",
    notes.trim() || "None",
  ].join("\n");
}

export default function DashboardPage() {
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [newMapName, setNewMapName] = useState("");
  const [mapCreateOpen, setMapCreateOpen] = useState(false);
  const [creatingMap, setCreatingMap] = useState(false);
  const [floatingAddOpen, setFloatingAddOpen] = useState(false);
  const [floatingAddInput, setFloatingAddInput] = useState("");

  const [interests, setInterests] = useState<Interest[]>([]);
  const [combinedInterestMembers, setCombinedInterestMembers] = useState<
    Record<string, Interest[]>
  >({});
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });

  const [loading, setLoading] = useState(false);
  const [mapsLoading, setMapsLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingMap, setDeletingMap] = useState(false);
  const [shareActionLoading, setShareActionLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [shareToast, setShareToast] = useState("");
  const [mapExportLoading, setMapExportLoading] = useState(false);
  const [mapExportError, setMapExportError] = useState("");
  const [mapExportFeedback, setMapExportFeedback] = useState("");

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
  const [edgeResearchMode, setEdgeResearchMode] = useState(false);
  const [savedEdgeEvidenceLoading, setSavedEdgeEvidenceLoading] = useState(false);
  const [savedEdgeEvidenceError, setSavedEdgeEvidenceError] = useState("");
  const [savingEvidenceUrl, setSavingEvidenceUrl] = useState<string | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null);
  const [manualEdgeEvidenceTitle, setManualEdgeEvidenceTitle] = useState("");
  const [manualEdgeEvidenceUrl, setManualEdgeEvidenceUrl] = useState("");
  const [manualEdgeEvidenceYear, setManualEdgeEvidenceYear] = useState("");
  const [manualEdgeEvidenceJournal, setManualEdgeEvidenceJournal] = useState("");
  const [manualEdgeEvidenceAuthors, setManualEdgeEvidenceAuthors] = useState("");
  const [manualEdgeEvidenceReason, setManualEdgeEvidenceReason] = useState("");
  const [manualEdgeEvidenceError, setManualEdgeEvidenceError] = useState("");
  const [manualEdgeEvidenceSaving, setManualEdgeEvidenceSaving] = useState(false);
  const [edgeNotes, setEdgeNotes] = useState("");
  const [edgeNotesLoading, setEdgeNotesLoading] = useState(false);
  const [edgeNotesSaving, setEdgeNotesSaving] = useState(false);
  const [edgeNotesError, setEdgeNotesError] = useState("");
  const [edgeNotesSavedAt, setEdgeNotesSavedAt] = useState<string | null>(null);
  const [notesTopic, setNotesTopic] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const sharePanelRef = useRef<HTMLDivElement | null>(null);
  const shareToastTimerRef = useRef<number | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const topicCloseTimerRef = useRef<number | null>(null);
  const edgeCloseTimerRef = useRef<number | null>(null);
  const topicEnterRafRef = useRef<number | null>(null);
  const edgeEnterRafRef = useRef<number | null>(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [topicPanelClosing, setTopicPanelClosing] = useState(false);
  const [edgePanelClosing, setEdgePanelClosing] = useState(false);
  const [topicPanelEntering, setTopicPanelEntering] = useState(false);
  const [edgePanelEntering, setEdgePanelEntering] = useState(false);
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);

  const [threshold, setThreshold] = useState(DEFAULT_SIMILARITY_THRESHOLD);
  const [clusterThreshold, setClusterThreshold] = useState(DEFAULT_CLUSTER_THRESHOLD);
  const [linkForceScale, setLinkForceScale] = useState(DEFAULT_LINK_FORCE_SCALE);
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>(
    DEFAULT_MAP_LAYOUT_SETTINGS.layoutMode
  );
  const [fastSettleMode, setFastSettleMode] = useState(true);
  const [tdaHealth, setTdaHealth] = useState<TdaMapHealth | null>(null);
  const [tdaLoading, setTdaLoading] = useState(false);
  const [tdaError, setTdaError] = useState("");
  const selectedTopicId = selectedTopic?.id || "";
  const selectedLinkKey = selectedLink
    ? `${selectedLink.sourceId}::${selectedLink.targetId}`
    : "";

  // Connection mode state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectingResult, setConnectingResult] = useState<{
    topic: string;
    reason: string;
  } | null>(null);
  const [connectingLoading, setConnectingLoading] = useState(false);
  const mapNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of maps) {
      map.set(item.id, item.name);
    }
    return map;
  }, [maps]);

  const selectedLinkMapId = useMemo(() => {
    if (isCombinedMapId(selectedMapId)) return null;
    if (!selectedLink) return null;
    const source = interests.find(
      (interest) => interest.id === selectedLink.sourceId
    );
    const target = interests.find(
      (interest) => interest.id === selectedLink.targetId
    );
    if (!source || !target) return null;
    return source.map_id === target.map_id ? source.map_id : null;
  }, [interests, selectedLink, selectedMapId]);

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
        if (
          prev &&
          (isCombinedMapId(prev) || data.some((map) => map.id === prev))
        ) {
          return prev;
        }

        const saved = getStoredString("km-active-map-id", "");
        if (
          saved &&
          (isCombinedMapId(saved) || data.some((map) => map.id === saved))
        ) {
          return saved;
        }

        return data[0]?.id || COMBINED_MAP_ID;
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
      const interestsUrl = isCombinedMapId(selectedMapId)
        ? "/api/interests"
        : `/api/interests?mapId=${encodeURIComponent(selectedMapId)}`;
      const res = await fetch(interestsUrl);
      if (res.ok) {
        const data: Interest[] = await res.json();
        if (isCombinedMapId(selectedMapId)) {
          const merged = mergeInterestsForCombined(data, mapNameById);
          setInterests(merged.mergedInterests);
          setCombinedInterestMembers(merged.membersByMergedId);
        } else {
          setInterests(data);
          setCombinedInterestMembers({});
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to fetch interests");
        setInterests([]);
        setCombinedInterestMembers({});
      }
    } catch (err) {
      console.error("Failed to fetch interests:", err);
      setError("Failed to fetch interests — check console for details");
      setInterests([]);
      setCombinedInterestMembers({});
    } finally {
      setInitialLoading(false);
    }
  }, [mapNameById, selectedMapId]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  useEffect(() => {
    if (!selectedMapId) return;
    localStorage.setItem("km-active-map-id", selectedMapId);
  }, [selectedMapId]);

  useEffect(() => {
    setFloatingAddOpen(false);
    setFloatingAddInput("");
  }, [selectedMapId]);

  useEffect(() => {
    setSharePanelOpen(false);
    setShareError("");
    setShareToast("");
  }, [selectedMapId]);

  useEffect(() => {
    if (!sharePanelOpen) return;

    function handleOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sharePanelRef.current?.contains(target)) return;
      setSharePanelOpen(false);
    }

    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("touchstart", handleOutsidePointer);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("touchstart", handleOutsidePointer);
    };
  }, [sharePanelOpen]);

  useEffect(() => {
    setMapExportError("");
    setMapExportFeedback("");
  }, [selectedMapId]);

  useEffect(() => {
    function syncMapFullscreenState() {
      if (typeof document === "undefined") return;
      const container = mapViewportRef.current;
      if (!container) {
        setIsMapFullscreen(false);
        return;
      }
      setIsMapFullscreen(document.fullscreenElement === container);
    }

    syncMapFullscreenState();
    document.addEventListener("fullscreenchange", syncMapFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncMapFullscreenState);
  }, []);

  useEffect(() => {
    return () => {
      if (topicCloseTimerRef.current !== null) {
        window.clearTimeout(topicCloseTimerRef.current);
      }
      if (edgeCloseTimerRef.current !== null) {
        window.clearTimeout(edgeCloseTimerRef.current);
      }
      if (topicEnterRafRef.current !== null) {
        window.cancelAnimationFrame(topicEnterRafRef.current);
      }
      if (edgeEnterRafRef.current !== null) {
        window.cancelAnimationFrame(edgeEnterRafRef.current);
      }
      if (shareToastTimerRef.current !== null) {
        window.clearTimeout(shareToastTimerRef.current);
      }
    };
  }, []);

  function showShareToast(message: string) {
    setShareToast(message);
    if (shareToastTimerRef.current !== null) {
      window.clearTimeout(shareToastTimerRef.current);
    }
    shareToastTimerRef.current = window.setTimeout(() => {
      setShareToast("");
      shareToastTimerRef.current = null;
    }, 1600);
  }

  useEffect(() => {
    if (!selectedTopicId) return;

    setTopicPanelClosing(false);
    setTopicPanelEntering(true);
    if (topicEnterRafRef.current !== null) {
      window.cancelAnimationFrame(topicEnterRafRef.current);
    }
    topicEnterRafRef.current = window.requestAnimationFrame(() => {
      setTopicPanelEntering(false);
      topicEnterRafRef.current = null;
    });
  }, [selectedTopicId, isMapFullscreen]);

  useEffect(() => {
    if (!selectedLinkKey) return;

    setEdgePanelClosing(false);
    setEdgePanelEntering(true);
    if (edgeEnterRafRef.current !== null) {
      window.cancelAnimationFrame(edgeEnterRafRef.current);
    }
    edgeEnterRafRef.current = window.requestAnimationFrame(() => {
      setEdgePanelEntering(false);
      edgeEnterRafRef.current = null;
    });
  }, [selectedLinkKey, isMapFullscreen]);

  useEffect(() => {
    setEdgeResearchMode(false);
  }, [selectedLinkKey]);

  useEffect(() => {
    if (!selectedMapId) {
      setThreshold(DEFAULT_SIMILARITY_THRESHOLD);
      setClusterThreshold(DEFAULT_CLUSTER_THRESHOLD);
      setLinkForceScale(DEFAULT_LINK_FORCE_SCALE);
      setLayoutMode(DEFAULT_MAP_LAYOUT_SETTINGS.layoutMode);
      setTdaHealth(null);
      setTdaError("");
      setTdaLoading(false);
      return;
    }

    const settings = getStoredMapLayoutSettings(selectedMapId);
    setThreshold(settings.similarityThreshold);
    setClusterThreshold(settings.clusterThreshold);
    setLinkForceScale(settings.linkForceScale);
    setLayoutMode(settings.layoutMode);
  }, [selectedMapId]);

  useEffect(() => {
    if (!selectedMapId) {
      setTdaHealth(null);
      setTdaError("");
      setTdaLoading(false);
      return;
    }

    if (isCombinedMapId(selectedMapId)) {
      setTdaLoading(true);
      setTdaError("");
      try {
        const health = computeTdaMapHealth(interests);
        setTdaHealth(health);
      } catch {
        setTdaHealth(null);
        setTdaError("Failed to analyze combined map topology");
      } finally {
        setTdaLoading(false);
      }
      return;
    }

    const activeMapId = selectedMapId;
    let cancelled = false;

    async function fetchTdaHealth() {
      setTdaLoading(true);
      setTdaError("");
      try {
        const res = await fetch(
          `/api/tda/map-health?mapId=${encodeURIComponent(activeMapId)}`
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) {
            setTdaHealth(null);
            setTdaError(data.error || "Failed to analyze map topology");
          }
          return;
        }

        const data: TdaMapHealth = await res.json();
        if (!cancelled) {
          setTdaHealth(data);
        }
      } catch {
        if (!cancelled) {
          setTdaHealth(null);
          setTdaError("Failed to analyze map topology");
        }
      } finally {
        if (!cancelled) {
          setTdaLoading(false);
        }
      }
    }

    fetchTdaHealth();

    return () => {
      cancelled = true;
    };
  }, [selectedMapId, interests]);

  useEffect(() => {
    if (mapsLoading) return;

    setInitialLoading(true);
    if (topicCloseTimerRef.current !== null) {
      window.clearTimeout(topicCloseTimerRef.current);
      topicCloseTimerRef.current = null;
    }
    if (topicEnterRafRef.current !== null) {
      window.cancelAnimationFrame(topicEnterRafRef.current);
      topicEnterRafRef.current = null;
    }
    if (edgeCloseTimerRef.current !== null) {
      window.clearTimeout(edgeCloseTimerRef.current);
      edgeCloseTimerRef.current = null;
    }
    if (edgeEnterRafRef.current !== null) {
      window.cancelAnimationFrame(edgeEnterRafRef.current);
      edgeEnterRafRef.current = null;
    }
    setTopicPanelClosing(false);
    setTopicPanelEntering(false);
    setEdgePanelClosing(false);
    setEdgePanelEntering(false);
    setSelectedTopic(null);
    setTopicPanelExpanded(false);
    setSelectedLink(null);
    setEdgePanelExpanded(false);
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
    setTopicPanelExpanded(Boolean(selectedTopic?.id));
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
    const activeTopicId = selectedTopic.id;
    const activeMapId = selectedMapId;

    let cancelled = false;

    async function loadPersistedTopicEvidence() {
      if (isCombinedMapId(activeMapId)) {
        const members = combinedInterestMembers[activeTopicId] || [];
        if (members.length === 0) {
          if (!cancelled) {
            setSavedTopicEvidence([]);
            setSavedTopicEvidenceError("");
            setSavedTopicEvidenceLoading(false);
          }
          return;
        }

        setSavedTopicEvidenceLoading(true);
        setSavedTopicEvidenceError("");
        try {
          const settled = await Promise.allSettled(
            members.map(async (member) => {
              const params = new URLSearchParams({
                mapId: member.map_id,
                interestId: member.id,
              });
              const res = await fetch(`/api/interests/evidence?${params.toString()}`);
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to load saved topic evidence");
              }
              const data: SavedInterestEvidence[] = await res.json();
              return data;
            })
          );

          if (cancelled) return;

          const mergedById = new Map<string, SavedInterestEvidence>();
          let hadErrors = false;
          for (const result of settled) {
            if (result.status === "fulfilled") {
              for (const source of result.value) {
                mergedById.set(source.id, source);
              }
            } else {
              hadErrors = true;
            }
          }

          const mergedSources = Array.from(mergedById.values()).sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          );
          setSavedTopicEvidence(mergedSources);
          setSavedTopicEvidenceError(
            hadErrors ? "Some saved topic evidence could not be loaded." : ""
          );
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
        return;
      }

      const params = new URLSearchParams({
        mapId: activeMapId,
        interestId: activeTopicId,
      });

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
  }, [combinedInterestMembers, selectedMapId, selectedTopic]);

  useEffect(() => {
    if (!selectedLink) return;
    const sourceExists = interests.some((interest) => interest.id === selectedLink.sourceId);
    const targetExists = interests.some((interest) => interest.id === selectedLink.targetId);
    if (!sourceExists || !targetExists) {
      if (edgeCloseTimerRef.current !== null) {
        window.clearTimeout(edgeCloseTimerRef.current);
        edgeCloseTimerRef.current = null;
      }
      if (edgeEnterRafRef.current !== null) {
        window.cancelAnimationFrame(edgeEnterRafRef.current);
        edgeEnterRafRef.current = null;
      }
      setEdgePanelClosing(false);
      setEdgePanelEntering(false);
      setSelectedLink(null);
      setEdgePanelExpanded(false);
    }
  }, [interests, selectedLink]);

  useEffect(() => {
    setEdgePanelExpanded(Boolean(selectedLink));
  }, [selectedLink]);

  useEffect(() => {
    setSelectedLinkEvidence(null);
    setSelectedLinkEvidenceError("");
    setSelectedLinkEvidenceLoading(false);
    setSavedEdgeEvidence([]);
    setSavedEdgeEvidenceError("");
    setSavedEdgeEvidenceLoading(false);
    setSavingEvidenceUrl(null);
    setDeletingEvidenceId(null);
    setManualEdgeEvidenceTitle("");
    setManualEdgeEvidenceUrl("");
    setManualEdgeEvidenceYear("");
    setManualEdgeEvidenceJournal("");
    setManualEdgeEvidenceAuthors("");
    setManualEdgeEvidenceReason("");
    setManualEdgeEvidenceError("");
    setManualEdgeEvidenceSaving(false);
    setEdgeNotes("");
    setEdgeNotesError("");
    setEdgeNotesLoading(false);
    setEdgeNotesSaving(false);
    setEdgeNotesSavedAt(null);
  }, [selectedLink]);

  useEffect(() => {
    if (!selectedLink || !selectedMapId) return;

    const effectiveMapId = isCombinedMapId(selectedMapId)
      ? selectedLinkMapId
      : selectedMapId;
    if (!effectiveMapId) {
      setSavedEdgeEvidence([]);
      setSavedEdgeEvidenceError("");
      setSavedEdgeEvidenceLoading(false);
      setEdgeNotes("");
      setEdgeNotesError("");
      setEdgeNotesLoading(false);
      setEdgeNotesSavedAt(null);
      return;
    }

    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    const params = new URLSearchParams({
      mapId: effectiveMapId,
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
  }, [selectedLink, selectedMapId, selectedLinkMapId]);

  const applyRecommendedLayoutSettings = useCallback(
    (similarity: number, cluster: number, linkForce: number) => {
      const nextSimilarity = clampValue(similarity, 0.05, 0.6);
      const nextCluster = clampValue(cluster, 0.2, 0.7);
      const nextLinkForce = clampValue(linkForce, 0.5, 3);

      setThreshold(nextSimilarity);
      setClusterThreshold(nextCluster);
      setLinkForceScale(nextLinkForce);
      if (selectedMapId) {
        saveMapLayoutSettings(selectedMapId, {
          similarityThreshold: nextSimilarity,
          clusterThreshold: nextCluster,
          linkForceScale: nextLinkForce,
        });
      }
    },
    [selectedMapId]
  );

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

  function handleLayoutModeChange(mode: GraphLayoutMode) {
    setLayoutMode(mode);
    if (selectedMapId) {
      saveMapLayoutSettings(selectedMapId, { layoutMode: mode });
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
      setMapCreateOpen(false);
    } catch (err) {
      console.error("Failed to create map:", err);
      setError("Failed to create map");
    } finally {
      setCreatingMap(false);
    }
  }

  async function handleDeleteMap() {
    if (!selectedMapId || isCombinedMapId(selectedMapId)) {
      setError("Select a specific map to delete.");
      return;
    }

    const mapToDelete = maps.find((map) => map.id === selectedMapId);
    const mapName = mapToDelete?.name || "this map";
    const confirmed = window.confirm(
      `Delete "${mapName}"?\n\nThis will remove its topics, notes, edge notes, and saved evidence. This cannot be undone.`
    );
    if (!confirmed) return;

    const mapIdToDelete = selectedMapId;
    const remainingMaps = maps.filter((map) => map.id !== mapIdToDelete);

    setDeletingMap(true);
    setError("");
    setShareError("");
    setShareToast("");
    setMapExportError("");
    setMapExportFeedback("");

    try {
      const res = await fetch("/api/maps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: mapIdToDelete }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to delete map");
        return;
      }

      setMaps(remainingMaps);
      setSelectedMapId((prev) =>
        prev === mapIdToDelete ? remainingMaps[0]?.id || COMBINED_MAP_ID : prev
      );

      setSelectedTopic(null);
      setSelectedLink(null);
      setNotesTopic(null);
      closeTopicPanelImmediate();
      closeEdgePanelImmediate();

      if (typeof window !== "undefined") {
        localStorage.removeItem(getMapLayoutStorageKey(mapIdToDelete));
      }
    } catch (err) {
      console.error("Failed to delete map:", err);
      setError("Failed to delete map");
    } finally {
      setDeletingMap(false);
    }
  }

  async function handleEnableSharing(regenerate = false) {
    if (!selectedMapId) return;
    if (isCombinedMapId(selectedMapId)) {
      setShareError("Combined map cannot be shared. Share an individual map instead.");
      return;
    }

    setShareActionLoading(true);
    setShareError("");
    try {
      const res = await fetch("/api/maps/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: selectedMapId, regenerate }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShareError(data.error || "Failed to enable sharing");
        return;
      }

      setMaps((prev) =>
        prev.map((map) =>
          map.id === selectedMapId
            ? {
                ...map,
                is_public: data.isPublic,
                share_slug: data.shareSlug,
                shared_at: data.sharedAt,
              }
            : map
        )
      );

      const shareUrl =
        typeof data.shareSlug === "string" && data.shareSlug.length > 0
          ? buildPublicShareUrlWithLayout(data.shareSlug, {
              similarityThreshold: threshold,
              clusterThreshold,
              linkForceScale,
              layoutMode,
            })
          : typeof data.shareUrl === "string"
            ? data.shareUrl
            : "";

      let copied = false;
      if (shareUrl && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          copied = true;
        } catch {
          copied = false;
        }
      }

      showShareToast(copied ? "Copied" : "Sharing enabled");
    } catch {
      setShareError("Failed to enable sharing");
    } finally {
      setShareActionLoading(false);
    }
  }

  async function handleDisableSharing() {
    if (!selectedMapId) return;
    if (isCombinedMapId(selectedMapId)) {
      setShareError("Combined map cannot be shared.");
      return;
    }

    setShareActionLoading(true);
    setShareError("");
    try {
      const res = await fetch("/api/maps/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: selectedMapId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShareError(data.error || "Failed to disable sharing");
        return;
      }

      setMaps((prev) =>
        prev.map((map) =>
          map.id === selectedMapId
            ? {
                ...map,
                is_public: false,
                share_slug: null,
                shared_at: null,
              }
            : map
        )
      );

      showShareToast("Sharing disabled");
    } catch {
      setShareError("Failed to disable sharing");
    } finally {
      setShareActionLoading(false);
    }
  }

  async function handleCopyShareLink(shareSlug: string) {
    const shareUrl = buildPublicShareUrlWithLayout(shareSlug, {
      similarityThreshold: threshold,
      clusterThreshold,
      linkForceScale,
      layoutMode,
    });
    setShareError("");
    try {
      await navigator.clipboard.writeText(shareUrl);
      showShareToast("Copied");
    } catch {
      setShareError("Failed to copy share link");
    }
  }

  async function handleDownloadMapExport() {
    if (!selectedMapId || isCombinedMapId(selectedMapId)) {
      setMapExportError("Select a specific map to download an export.");
      return;
    }

    if (interests.length === 0) {
      setMapExportError("No nodes to export in this map.");
      return;
    }

    setMapExportLoading(true);
    setMapExportError("");
    setMapExportFeedback("");

    try {
      const mapId = selectedMapId;
      const selectedMapName = selectedMap?.name || "map";
      let hasPartialFailures = false;

      const nodeEvidenceResults = await Promise.allSettled(
        interests.map(async (interest) => {
          const params = new URLSearchParams({
            mapId,
            interestId: interest.id,
          });
          const res = await fetch(`/api/interests/evidence?${params.toString()}`);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to load node evidence");
          }
          const data: SavedInterestEvidence[] = await res.json();
          return data;
        })
      );

      const nodeBlocks = interests.map((interest, index) => {
        const result = nodeEvidenceResults[index];
        if (result.status === "fulfilled") {
          return buildNodeExportBlock(interest, result.value, index);
        }
        hasPartialFailures = true;
        return buildNodeExportBlock(interest, [], index);
      });

      const interestNameById = new Map<string, string>();
      for (const interest of interests) {
        interestNameById.set(interest.id, interest.name);
      }

      const uniqueEdges = new Map<
        string,
        {
          sourceId: string;
          targetId: string;
          sourceName: string;
          targetName: string;
        }
      >();

      for (const link of graphData.links) {
        const sourceId = getGraphEndpointId(link.source as unknown);
        const targetId = getGraphEndpointId(link.target as unknown);
        if (!sourceId || !targetId || sourceId === targetId) continue;

        const pair = normalizeEdgePair(sourceId, targetId);
        const key = `${pair.a}::${pair.b}`;
        if (uniqueEdges.has(key)) continue;

        uniqueEdges.set(key, {
          sourceId: pair.a,
          targetId: pair.b,
          sourceName: interestNameById.get(pair.a) || pair.a,
          targetName: interestNameById.get(pair.b) || pair.b,
        });
      }

      const edgeEntries = Array.from(uniqueEdges.values()).sort((a, b) => {
        const sourceCompare = a.sourceName.localeCompare(b.sourceName);
        if (sourceCompare !== 0) return sourceCompare;
        return a.targetName.localeCompare(b.targetName);
      });

      const edgeResults = await Promise.allSettled(
        edgeEntries.map(async (edge) => {
          const params = new URLSearchParams({
            mapId,
            interestAId: edge.sourceId,
            interestBId: edge.targetId,
          });

          const [evidenceRes, notesRes] = await Promise.all([
            fetch(`/api/edges/evidence?${params.toString()}`),
            fetch(`/api/edges/notes?${params.toString()}`),
          ]);

          if (!evidenceRes.ok) {
            const data = await evidenceRes.json().catch(() => ({}));
            throw new Error(data.error || "Failed to load edge evidence");
          }

          if (!notesRes.ok) {
            const data = await notesRes.json().catch(() => ({}));
            throw new Error(data.error || "Failed to load edge notes");
          }

          const evidence: SavedEdgeEvidence[] = await evidenceRes.json();
          const notesData: EdgeNotesRecord = await notesRes.json();
          return {
            evidence,
            notes: notesData.notes || "",
          };
        })
      );

      const edgeBlocks = edgeEntries.map((edge, index) => {
        const result = edgeResults[index];
        const edgeName = `${edge.sourceName} <-> ${edge.targetName}`;
        if (result.status === "fulfilled") {
          return buildEdgeExportBlock(
            edgeName,
            result.value.evidence,
            result.value.notes,
            index
          );
        }
        hasPartialFailures = true;
        return buildEdgeExportBlock(edgeName, [], "", index);
      });

      const output = [
        "KnowledgeMap Export",
        `Map: ${selectedMapName}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        "Nodes",
        "",
        nodeBlocks.join("\n\n"),
        "",
        "Edges",
        "",
        edgeBlocks.length > 0 ? edgeBlocks.join("\n\n") : "No edges in current graph.",
        "",
      ].join("\n");

      const filename = `${toSafeFilenameSegment(
        selectedMapName
      )}-export-${new Date().toISOString().slice(0, 10)}.txt`;
      const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setMapExportFeedback(
        hasPartialFailures
          ? "Downloaded with partial data (some evidence/notes could not be loaded)."
          : "Map export downloaded."
      );
    } catch (err) {
      console.error("Failed to download map export:", err);
      setMapExportError("Failed to generate map export.");
    } finally {
      setMapExportLoading(false);
    }
  }

  async function handleAddInterest(name: string) {
    if (!selectedMapId) {
      setError("Create or select a map first");
      return;
    }
    if (isCombinedMapId(selectedMapId)) {
      setError("Combined map is automatic. Add topics in a specific map.");
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

  async function handleFloatingAddSubmit() {
    const value = floatingAddInput.trim();
    if (!value) return;
    if (interests.some((interest) => interest.name === value)) {
      setError("That topic already exists in this map.");
      return;
    }
    await handleAddInterest(value);
    setFloatingAddInput("");
    setFloatingAddOpen(false);
  }

  async function handleRemoveInterest(name: string) {
    if (isCombinedMapId(selectedMapId)) {
      setError("Combined map is read-only. Remove topics in a specific map.");
      return;
    }

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
          closeTopicPanelImmediate();
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
    if (isCombinedMapId(selectedMapId)) {
      throw new Error("Combined map is read-only");
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

  function closeTopicPanelImmediate() {
    if (topicCloseTimerRef.current !== null) {
      window.clearTimeout(topicCloseTimerRef.current);
      topicCloseTimerRef.current = null;
    }
    if (topicEnterRafRef.current !== null) {
      window.cancelAnimationFrame(topicEnterRafRef.current);
      topicEnterRafRef.current = null;
    }
    setTopicPanelClosing(false);
    setTopicPanelEntering(false);
    setSelectedTopic(null);
    setTopicPanelExpanded(false);
  }

  function closeEdgePanelImmediate() {
    if (edgeCloseTimerRef.current !== null) {
      window.clearTimeout(edgeCloseTimerRef.current);
      edgeCloseTimerRef.current = null;
    }
    if (edgeEnterRafRef.current !== null) {
      window.cancelAnimationFrame(edgeEnterRafRef.current);
      edgeEnterRafRef.current = null;
    }
    setEdgePanelClosing(false);
    setEdgePanelEntering(false);
    setSelectedLink(null);
    setEdgePanelExpanded(false);
  }

  function closeTopicPanelSmooth() {
    if (!selectedTopic) {
      closeTopicPanelImmediate();
      return;
    }

    if (topicCloseTimerRef.current !== null) {
      window.clearTimeout(topicCloseTimerRef.current);
    }

    setTopicPanelClosing(true);
    topicCloseTimerRef.current = window.setTimeout(() => {
      closeTopicPanelImmediate();
    }, PANEL_TRANSITION_MS);
  }

  function closeEdgePanelSmooth() {
    if (!selectedLink) {
      closeEdgePanelImmediate();
      return;
    }

    if (edgeCloseTimerRef.current !== null) {
      window.clearTimeout(edgeCloseTimerRef.current);
    }

    setEdgePanelClosing(true);
    edgeCloseTimerRef.current = window.setTimeout(() => {
      closeEdgePanelImmediate();
    }, PANEL_TRANSITION_MS);
  }

  function handleStartConnect(topicName: string) {
    if (isCombinedMapId(selectedMapId)) {
      setError("Combined map is read-only. Create connections in a specific map.");
      return;
    }
    setConnectingFrom(topicName);
    setConnectingResult(null);
    closeEdgePanelImmediate();
    closeTopicPanelImmediate();
    setNotesTopic(null);
  }

  async function handleCompleteConnect(topicB: string) {
    if (!connectingFrom || connectingFrom === topicB || !selectedMapId) return;
    if (isCombinedMapId(selectedMapId)) {
      setError("Combined map is read-only. Create connections in a specific map.");
      return;
    }

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

  async function handleToggleMapFullscreen() {
    const container = mapViewportRef.current;
    if (!container || typeof document === "undefined") return;

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
        return;
      }

      await container.requestFullscreen();
      setTopicPanelExpanded(true);
      setEdgePanelExpanded(true);
    } catch {
      setError("Fullscreen is blocked by this browser/session.");
    }
  }

  function handleNodeClick(nodeId: string, nodeName: string) {
    if (connectingFrom) {
      handleCompleteConnect(nodeName);
      return;
    }

    setConnectingResult(null);
    closeEdgePanelImmediate();
    if (topicCloseTimerRef.current !== null) {
      window.clearTimeout(topicCloseTimerRef.current);
      topicCloseTimerRef.current = null;
      setTopicPanelClosing(false);
    }
    const isSameNode = selectedTopic?.id === nodeId;
    if (isSameNode) {
      closeTopicPanelSmooth();
      setNotesTopic(null);
      return;
    }

    setSelectedTopic({ id: nodeId, name: nodeName });
    if (isMapFullscreen) {
      setTopicPanelExpanded(true);
    }
    if (notesTopic && notesTopic.id !== nodeId) {
      setNotesTopic(null);
    }
  }

  function handleLinkClick(link: GraphLinkSelection) {
    if (connectingFrom) return;
    setConnectingResult(null);
    closeTopicPanelImmediate();
    setNotesTopic(null);
    if (edgeCloseTimerRef.current !== null) {
      window.clearTimeout(edgeCloseTimerRef.current);
      edgeCloseTimerRef.current = null;
      setEdgePanelClosing(false);
    }
    setSelectedLink(link);
    if (isMapFullscreen) {
      setEdgePanelExpanded(true);
    }
  }

  function getActiveTopicParams() {
    if (!selectedTopic || !selectedMapId || isCombinedMapId(selectedMapId)) {
      return null;
    }
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

  async function handleSaveTopicEvidenceSource(
    source: EvidenceSource
  ): Promise<boolean> {
    if (isCombinedMapId(selectedMapId)) {
      setSavedTopicEvidenceError(
        "Combined map is read-only. Save evidence in a specific map."
      );
      return false;
    }

    const topicParams = getActiveTopicParams();
    if (!topicParams) return false;

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
            sourceProvider:
              typeof source.sourceProvider === "string" &&
              source.sourceProvider.trim().length > 0
                ? source.sourceProvider.trim()
                : "openalex",
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedTopicEvidenceError(
          data.error || "Failed to save topic evidence"
        );
        return false;
      }

      const saved: SavedInterestEvidence = await res.json();
      setSavedTopicEvidence((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        if (exists) {
          return prev.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...prev];
      });
      return true;
    } catch {
      setSavedTopicEvidenceError("Failed to save topic evidence");
      return false;
    } finally {
      setSavingTopicEvidenceUrl(null);
    }
  }

  async function handleDeleteSavedTopicEvidence(id: string) {
    if (isCombinedMapId(selectedMapId)) {
      setSavedTopicEvidenceError(
        "Combined map is read-only. Remove evidence in a specific map."
      );
      return;
    }

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
    if (!selectedLink || !selectedMapId || isCombinedMapId(selectedMapId)) {
      return null;
    }
    const pair = normalizeEdgePair(selectedLink.sourceId, selectedLink.targetId);
    return {
      mapId: selectedMapId,
      interestAId: pair.a,
      interestBId: pair.b,
    };
  }

  async function handleSaveEvidenceSource(source: EvidenceSource): Promise<boolean> {
    if (isCombinedMapId(selectedMapId)) {
      setSavedEdgeEvidenceError(
        "Combined map is read-only. Save edge evidence in a specific map."
      );
      return false;
    }

    const edgeParams = getActiveEdgeParams();
    if (!edgeParams) return false;

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
            sourceProvider:
              typeof source.sourceProvider === "string" &&
              source.sourceProvider.trim().length > 0
                ? source.sourceProvider.trim()
                : "openalex",
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSavedEdgeEvidenceError(data.error || "Failed to save evidence");
        return false;
      }

      const saved: SavedEdgeEvidence = await res.json();
      setSavedEdgeEvidence((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        if (exists) {
          return prev.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...prev];
      });
      return true;
    } catch {
      setSavedEdgeEvidenceError("Failed to save evidence");
      return false;
    } finally {
      setSavingEvidenceUrl(null);
    }
  }

  async function handleSaveManualEdgeEvidence() {
    const title = manualEdgeEvidenceTitle.trim();
    const url = normalizePaperUrl(manualEdgeEvidenceUrl);
    if (!title || !url) {
      setManualEdgeEvidenceError("Title and URL are required.");
      return;
    }

    let year: number | null = null;
    if (manualEdgeEvidenceYear.trim()) {
      const parsedYear = Number(manualEdgeEvidenceYear.trim());
      if (!Number.isFinite(parsedYear)) {
        setManualEdgeEvidenceError("Year must be a valid number.");
        return;
      }
      year = Math.trunc(parsedYear);
    }

    const authors = manualEdgeEvidenceAuthors
      .split(",")
      .map((author) => author.trim())
      .filter((author) => author.length > 0)
      .slice(0, 8);

    const source: EvidenceSource = {
      title,
      url,
      year,
      journal: manualEdgeEvidenceJournal.trim() || "User provided source",
      authors,
      reason:
        manualEdgeEvidenceReason.trim() ||
        `User-added evidence for ${selectedLink?.sourceName || "this"} ↔ ${
          selectedLink?.targetName || "connection"
        }.`,
      sourceProvider: "manual",
    };

    setManualEdgeEvidenceSaving(true);
    setManualEdgeEvidenceError("");
    const saved = await handleSaveEvidenceSource(source);
    setManualEdgeEvidenceSaving(false);

    if (!saved) {
      setManualEdgeEvidenceError("Failed to save paper link.");
      return;
    }

    setManualEdgeEvidenceTitle("");
    setManualEdgeEvidenceUrl("");
    setManualEdgeEvidenceYear("");
    setManualEdgeEvidenceJournal("");
    setManualEdgeEvidenceAuthors("");
    setManualEdgeEvidenceReason("");
  }

  async function handleDeleteSavedEvidence(id: string) {
    if (isCombinedMapId(selectedMapId)) {
      setSavedEdgeEvidenceError(
        "Combined map is read-only. Remove edge evidence in a specific map."
      );
      return;
    }

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
    if (isCombinedMapId(selectedMapId)) {
      setEdgeNotesError(
        "Combined map is read-only. Save edge notes in a specific map."
      );
      return;
    }

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

  function handleAppendEdgeNoteTemplate(template: string) {
    setEdgeNotes((prev) => {
      const trimmed = prev.trimEnd();
      const spacer = trimmed.length > 0 ? "\n\n" : "";
      return `${trimmed}${spacer}${template}`;
    });
    if (edgeNotesError) {
      setEdgeNotesError("");
    }
  }

  async function handleSaveNotes(topicId: string, notes: string) {
    if (isCombinedMapId(selectedMapId)) {
      throw new Error("Combined map is read-only.");
    }

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

  const showTopicDetail = Boolean(
    selectedTopic && !connectingFrom && !assistantPanelOpen
  );
  const showNotesSidebar = Boolean(
    notesTopic && !connectingFrom && !assistantPanelOpen
  );
  const showLinkDetail = Boolean(
    selectedLink && !connectingFrom && !assistantPanelOpen
  );
  const edgeResearchQuery = selectedLink ? buildResearchQuery(selectedLink) : "";
  const edgeResearchQuestions = selectedLink
    ? buildEdgeResearchQuestions(selectedLink)
    : [];
  const edgeResearchSearchAngles = selectedLink
    ? buildEdgeSearchAngles(selectedLink)
    : [];
  const edgeNoteTemplates = selectedLink
    ? buildEdgeNoteTemplates(selectedLink)
    : [];
  const edgeNotesWordCount = edgeNotes.trim()
    ? edgeNotes.trim().split(/\s+/).length
    : 0;
  const edgeNotesCharCount = edgeNotes.length;

  useEffect(() => {
    if (isMapFullscreen && showTopicDetail) {
      setTopicPanelExpanded(true);
    }
  }, [isMapFullscreen, showTopicDetail]);

  useEffect(() => {
    if (isMapFullscreen && showLinkDetail) {
      setEdgePanelExpanded(true);
    }
  }, [isMapFullscreen, showLinkDetail]);

  const combinedMapOption: KnowledgeMap = {
    id: COMBINED_MAP_ID,
    user_id: "",
    name: COMBINED_MAP_NAME,
    created_at: "",
  };
  const mapOptions: KnowledgeMap[] = [combinedMapOption, ...maps];
  const isCombinedMapSelected = isCombinedMapId(selectedMapId);
  const selectedMap = selectedMapId
    ? mapOptions.find((map) => map.id === selectedMapId) || null
    : null;
  const selectedMapShareUrl =
    selectedMap?.share_slug && selectedMap.is_public
      ? buildPublicShareUrlWithLayout(selectedMap.share_slug, {
          similarityThreshold: threshold,
          clusterThreshold,
          linkForceScale,
          layoutMode,
        })
      : null;
  const recommendedSimilarityThreshold =
    typeof tdaHealth?.recommendedSimilarityThreshold === "number"
      ? clampValue(tdaHealth.recommendedSimilarityThreshold, 0.05, 0.6)
      : null;
  const recommendedClusterThreshold =
    typeof tdaHealth?.recommendedClusterThreshold === "number"
      ? clampValue(tdaHealth.recommendedClusterThreshold, 0.2, 0.7)
      : null;
  const recommendedLinkForceScale =
    typeof tdaHealth?.recommendedLinkForceScale === "number"
      ? clampValue(tdaHealth.recommendedLinkForceScale, 0.5, 3)
      : null;
  const isRecommendedLayoutApplied =
    recommendedSimilarityThreshold !== null &&
    recommendedClusterThreshold !== null &&
    recommendedLinkForceScale !== null &&
    Math.abs(threshold - recommendedSimilarityThreshold) < 0.005 &&
    Math.abs(clusterThreshold - recommendedClusterThreshold) < 0.005 &&
    Math.abs(linkForceScale - recommendedLinkForceScale) < 0.005;

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
                {mapOptions.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleDeleteMap}
                disabled={!selectedMapId || isCombinedMapSelected || deletingMap}
                className="h-9 w-9 rounded-md border border-red-500/60 text-red-300 hover:text-red-200 hover:border-red-400/70 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
                title="Delete selected map"
                aria-label="Delete selected map"
              >
                {deletingMap ? (
                  <span className="text-[10px]">...</span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4.5 w-4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M6.5 6l1 14h9l1-14" />
                    <path d="M10 10v7" />
                    <path d="M14 10v7" />
                  </svg>
                )}
              </button>
              <button
                onClick={handleDownloadMapExport}
                disabled={
                  !selectedMapId ||
                  isCombinedMapSelected ||
                  mapExportLoading ||
                  interests.length === 0
                }
                className="h-9 w-9 rounded-md border border-gray-700 text-gray-200 hover:border-gray-500 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
                title="Download map export (.txt)"
                aria-label="Download map export"
              >
                {mapExportLoading ? (
                  <span className="text-[10px]">...</span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4.5 w-4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 4v10" />
                    <path d="m8.5 11.5 3.5 3.5 3.5-3.5" />
                    <path d="M4 18.5h16" />
                  </svg>
                )}
              </button>

              {mapCreateOpen ? (
                <div className="flex items-center gap-2 rounded-full border border-white/20 bg-gray-950/70 px-2 py-2 shadow-xl backdrop-blur">
                  <input
                    type="text"
                    value={newMapName}
                    onChange={(e) => setNewMapName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!creatingMap && newMapName.trim()) {
                          void handleCreateMap();
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMapCreateOpen(false);
                        setNewMapName("");
                      }
                    }}
                    placeholder="New map name..."
                    className="w-52 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-gray-400 focus:border-cyan-500/70 focus:outline-none"
                    autoFocus
                    disabled={creatingMap}
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateMap()}
                    disabled={creatingMap || !newMapName.trim()}
                    className="rounded-full border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
                  >
                    {creatingMap ? "Creating..." : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapCreateOpen(false);
                      setNewMapName("");
                    }}
                    className="rounded-full border border-white/20 px-2 py-1.5 text-xs text-gray-200 hover:text-white"
                    aria-label="Close new map input"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setMapCreateOpen(true)}
                  className="h-9 w-9 rounded-full border border-white/30 bg-white/5 text-lg font-medium leading-none text-white/90 shadow-lg backdrop-blur transition hover:border-cyan-400/70 hover:bg-cyan-500/10"
                  title="Create new map"
                  aria-label="Create new map"
                >
                  +
                </button>
              )}

              {selectedMapId && !isCombinedMapSelected && (
                <div ref={sharePanelRef} className="relative">
                  {sharePanelOpen ? (
                    <div className="flex flex-col gap-2 rounded-xl border border-white/20 bg-gray-950/80 px-3 py-2 shadow-xl backdrop-blur">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedMap?.is_public && selectedMap?.share_slug ? (
                          <>
                            <button
                              onClick={() => handleCopyShareLink(selectedMap.share_slug!)}
                              className="px-2.5 py-1 rounded-md border border-gray-700 text-xs text-gray-200 hover:border-gray-500"
                            >
                              Copy link
                            </button>
                            {selectedMapShareUrl && (
                              <a
                                href={selectedMapShareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 rounded-md border border-gray-700 text-xs text-gray-200 hover:border-gray-500"
                              >
                                Open shared page
                              </a>
                            )}
                            <button
                              onClick={() => handleEnableSharing(true)}
                              disabled={shareActionLoading}
                              className="px-2.5 py-1 rounded-md border border-amber-500/60 text-xs text-amber-300 hover:text-amber-200 disabled:opacity-60"
                            >
                              {shareActionLoading ? "Working..." : "Regenerate"}
                            </button>
                            <button
                              onClick={handleDisableSharing}
                              disabled={shareActionLoading}
                              className="px-2.5 py-1 rounded-md border border-red-500/60 text-xs text-red-300 hover:text-red-200 disabled:opacity-60"
                            >
                              {shareActionLoading ? "Working..." : "Disable"}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleEnableSharing(false)}
                            disabled={shareActionLoading}
                            className="px-2.5 py-1 rounded-md border border-blue-500/60 text-xs text-blue-300 hover:text-blue-200 disabled:opacity-60"
                          >
                            {shareActionLoading ? "Working..." : "Share read-only map"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSharePanelOpen(false)}
                          className="rounded-full border border-white/20 px-2 py-1 text-xs text-gray-200 hover:text-white"
                          aria-label="Close share panel"
                        >
                          ✕
                        </button>
                      </div>
                      {shareError && (
                        <div className="text-xs text-red-300">{shareError}</div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMapCreateOpen(false);
                        setSharePanelOpen(true);
                      }}
                      className="h-9 w-9 rounded-md border border-blue-500/60 bg-blue-500/10 text-blue-300 hover:text-blue-200 hover:border-blue-400/70 flex items-center justify-center"
                      title="Share map"
                      aria-label="Share map"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4.5 w-4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="18" cy="5" r="2.2" />
                        <circle cx="6" cy="12" r="2.2" />
                        <circle cx="18" cy="19" r="2.2" />
                        <path d="M7.9 11 16.1 6.1" />
                        <path d="m7.9 13 8.2 4.9" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
	            </div>
	          </div>

          {shareToast && (
            <div className="fixed right-6 top-20 z-50 rounded-md border border-emerald-500/50 bg-gray-950/90 px-3 py-1.5 text-xs text-emerald-200 shadow-lg backdrop-blur">
              {shareToast}
            </div>
          )}

          {(mapExportFeedback || mapExportError) && (
            <div className="mb-2 text-xs space-x-2">
              {mapExportFeedback && (
                <span className="text-green-300">{mapExportFeedback}</span>
              )}
              {mapExportError && (
                <span className="text-red-300">{mapExportError}</span>
              )}
            </div>
          )}

          {isCombinedMapSelected && (
            <p className="text-xs text-cyan-300 mb-2">
              Combined map is automatic and read-only. Edit individual maps to update
              it.
            </p>
          )}

	          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
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
          <button
            onClick={() => setFastSettleMode((prev) => !prev)}
            className={`ml-auto px-2.5 py-1 rounded-md border text-xs transition-colors ${
              fastSettleMode
                ? "border-cyan-500/70 text-cyan-200 bg-cyan-500/10"
                : "border-gray-700 text-gray-300 hover:border-gray-500"
            }`}
            title="Reduce post-drag drift by making the simulation settle faster."
          >
            Fast settle: {fastSettleMode ? "On" : "Off"}
          </button>
        </div>

        <details className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
          <summary className="text-xs text-gray-400 cursor-pointer select-none">
            Advanced layout
          </summary>
          <div className="space-y-3 mt-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 whitespace-nowrap w-24">
                Layout mode
              </label>
              <div className="inline-flex rounded-md border border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleLayoutModeChange("classic")}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    layoutMode === "classic"
                      ? "bg-gray-700 text-white"
                      : "bg-gray-900/50 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  Classic
                </button>
                <button
                  type="button"
                  onClick={() => handleLayoutModeChange("umap")}
                  className={`px-3 py-1.5 text-xs border-l border-gray-700 transition-colors ${
                    layoutMode === "umap"
                      ? "bg-cyan-700/60 text-cyan-100"
                      : "bg-gray-900/50 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  UMAP (beta)
                </button>
              </div>
              <span className="text-xs text-gray-500">
                UMAP uses embeddings directly for initial 2D placement.
              </span>
            </div>
            <div className="rounded-md border border-cyan-900/60 bg-cyan-950/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-cyan-300">
                  TDA recommendation
                </span>
                {tdaLoading ? (
                  <span className="text-xs text-gray-500">Analyzing topology...</span>
                ) : tdaError ? (
                  <span className="text-xs text-red-300">{tdaError}</span>
                ) : recommendedSimilarityThreshold !== null &&
                  recommendedClusterThreshold !== null &&
                  recommendedLinkForceScale !== null ? (
                  <>
                    <span className="text-xs text-gray-300">
                      Similarity{" "}
                      <span className="font-mono text-white">
                        {recommendedSimilarityThreshold.toFixed(2)}
                      </span>
                      {"  "}Cluster{" "}
                      <span className="font-mono text-white">
                        {recommendedClusterThreshold.toFixed(2)}
                      </span>
                      {"  "}Link pull{" "}
                      <span className="font-mono text-white">
                        {recommendedLinkForceScale.toFixed(2)}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        applyRecommendedLayoutSettings(
                          recommendedSimilarityThreshold,
                          recommendedClusterThreshold,
                          recommendedLinkForceScale
                        )
                      }
                      disabled={isRecommendedLayoutApplied}
                      className="ml-auto rounded-md bg-gradient-to-r from-cyan-500 to-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-cyan-400 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isRecommendedLayoutApplied
                        ? "Recommendation applied"
                        : "Apply recommendation"}
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-gray-500">
                    Add more embedded topics to compute a recommendation.
                  </span>
                )}
              </div>
              {!tdaLoading &&
                !tdaError &&
                recommendedSimilarityThreshold !== null &&
                recommendedClusterThreshold !== null &&
                recommendedLinkForceScale !== null && (
                  <p className="mt-2 text-[11px] leading-relaxed text-cyan-100/70">
                    {tdaHealth?.recommendationReason} {tdaHealth?.clusterRecommendationReason}{" "}
                    {tdaHealth?.linkForceRecommendationReason}
                  </p>
                )}
            </div>
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

        <div
          ref={mapViewportRef}
          className={`relative flex-1 min-h-0 ${
            isMapFullscreen ? "bg-gray-950 p-3" : ""
          }`}
        >
          {selectedMapId && (
            <button
              type="button"
              onClick={handleToggleMapFullscreen}
              className="absolute top-3 left-3 z-40 rounded-md border border-gray-700 bg-gray-950/90 px-2 py-1 text-[11px] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
            >
              {isMapFullscreen ? "Exit full size" : "Full size"}
            </button>
          )}

          {selectedMapId ? (
            <KnowledgeGraph
              data={graphData}
              selectedNodeId={selectedTopic?.id}
              selectedLink={selectedLink}
              connectingFromName={connectingFrom}
              linkForceScale={linkForceScale}
              layoutMode={layoutMode}
              fastSettle={fastSettleMode}
              fullscreen={isMapFullscreen}
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
              onBackgroundClick={() => {
                closeTopicPanelSmooth();
                closeEdgePanelSmooth();
                setNotesTopic(null);
              }}
              reservedWidth={0}
            />
          ) : (
            <div className="h-[560px] flex items-center justify-center border border-gray-800 rounded-lg bg-gray-950/50">
              <p className="text-gray-500">Create a map to get started.</p>
            </div>
          )}

          {selectedMapId && !isCombinedMapSelected && (
            <div
              className={`absolute z-40 ${
                isMapFullscreen ? "bottom-6 left-6" : "bottom-3 left-3"
              }`}
            >
              {floatingAddOpen ? (
                <div className="flex items-center gap-2 rounded-full border border-white/20 bg-gray-950/70 px-2 py-2 shadow-xl backdrop-blur">
                  <input
                    type="text"
                    value={floatingAddInput}
                    onChange={(e) => setFloatingAddInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!loading) {
                          void handleFloatingAddSubmit();
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setFloatingAddOpen(false);
                        setFloatingAddInput("");
                      }
                    }}
                    placeholder="Add topic..."
                    className="w-56 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-gray-400 focus:border-cyan-500/70 focus:outline-none"
                    autoFocus
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => void handleFloatingAddSubmit()}
                    disabled={loading || !floatingAddInput.trim()}
                    className="rounded-full border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
                  >
                    {loading ? "Adding..." : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFloatingAddOpen(false);
                      setFloatingAddInput("");
                    }}
                    className="rounded-full border border-white/20 px-2 py-1.5 text-xs text-gray-200 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFloatingAddOpen(true)}
                  className="h-11 w-11 rounded-full border border-white/30 bg-white/5 text-xl font-medium text-white/90 shadow-lg backdrop-blur transition hover:border-cyan-400/70 hover:bg-cyan-500/10"
                  title="Add topic"
                  aria-label="Add topic"
                >
                  +
                </button>
              )}
            </div>
          )}

          <GraphAssistantPanel
            mapId={selectedMapId}
            mapName={selectedMap?.name || null}
            isCombinedMap={isCombinedMapSelected}
            selectedTopic={selectedTopic}
            selectedLink={selectedLink}
            fullscreen={isMapFullscreen}
            onOpenChange={setAssistantPanelOpen}
            onMapCreated={(mapId) => {
              setSelectedMapId(mapId);
              void fetchMaps();
            }}
            onMapExtended={() => {
              void fetchInterests();
            }}
          />

          {showTopicDetail && selectedTopic && (
            <div
              className={
                isMapFullscreen
                  ? `absolute inset-0 z-30 flex items-center justify-center p-4 transition-opacity duration-200 ease-out ${
                      topicPanelClosing || topicPanelEntering
                        ? "bg-black/0 opacity-0 pointer-events-none"
                        : "bg-black/45 opacity-100"
                    }`
                  : `absolute top-3 right-3 z-20 overflow-y-auto transition-all duration-200 ease-out ${
                      topicPanelExpanded
                        ? "w-[44rem] max-w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)]"
                        : "w-72 max-h-[calc(100%-1.5rem)]"
                    } ${
                      topicPanelClosing || topicPanelEntering
                        ? "opacity-0 translate-y-2 pointer-events-none"
                        : "opacity-100 translate-y-0"
                    }`
              }
            >
              <div
                className={
                  isMapFullscreen
                    ? `w-full max-w-6xl h-[min(92vh,920px)] overflow-y-auto transition-all duration-200 ease-out ${
                        topicPanelClosing || topicPanelEntering
                          ? "opacity-0 translate-y-2 scale-[0.985]"
                          : "opacity-100 translate-y-0 scale-100"
                      }`
                    : ""
                }
              >
                <TopicDetail
                  key={selectedTopic.id}
                  name={selectedTopic.name}
                  relatedTopics={
                    interests.find((i) => i.id === selectedTopic.id)?.related_topics ||
                    []
                  }
                  readOnly={isCombinedMapSelected}
                  connectingFrom={connectingFrom}
                  isExpanded={topicPanelExpanded}
                  onToggleExpand={() =>
                    setTopicPanelExpanded((prevExpanded) => !prevExpanded)
                  }
                  onClose={() => {
                    closeTopicPanelSmooth();
                  }}
                  onExpand={handleExpand}
                  onRemove={(name) => {
                    handleRemoveInterest(name);
                  }}
                  onStartConnect={handleStartConnect}
                  onOpenNotes={() => {
                    if (isCombinedMapSelected) {
                      setError("Combined map is read-only. Edit notes in a specific map.");
                      return;
                    }
                    setNotesTopic(selectedTopic);
                    closeTopicPanelImmediate();
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
              className={
                isMapFullscreen
                  ? `absolute inset-0 z-30 flex items-center justify-center p-4 transition-opacity duration-200 ease-out ${
                      edgePanelClosing || edgePanelEntering
                        ? "bg-black/0 opacity-0 pointer-events-none"
                        : "bg-black/45 opacity-100"
                    }`
                  : `absolute top-3 right-3 z-20 overflow-y-auto transition-all duration-200 ease-out ${
                      edgePanelExpanded
                        ? "w-[48rem] max-w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)]"
                        : "w-80 max-h-[calc(100%-1.5rem)]"
                    } ${
                      edgePanelClosing || edgePanelEntering
                        ? "opacity-0 translate-y-2 pointer-events-none"
                        : "opacity-100 translate-y-0"
                    }`
              }
            >
              <aside
                className={`border border-gray-700 rounded-lg bg-gray-900 p-4 space-y-4 ${
                  isMapFullscreen
                    ? `w-full max-w-6xl h-[min(92vh,920px)] overflow-y-auto transition-all duration-200 ease-out ${
                        edgePanelClosing || edgePanelEntering
                          ? "opacity-0 translate-y-2 scale-[0.985]"
                          : "opacity-100 translate-y-0 scale-100"
                      }`
                    : ""
                }`}
              >
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
                      onClick={() => setEdgeResearchMode((prev) => !prev)}
                      className={`px-2 py-1 rounded-md border text-xs transition-colors ${
                        edgeResearchMode
                          ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                          : "border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
                      }`}
                    >
                      {edgeResearchMode ? "Research on" : "Research"}
                    </button>
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
                        closeEdgePanelSmooth();
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

                {edgeResearchMode && (
                  <div className="rounded-md border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-cyan-300 font-medium">
                        Research workspace
                      </p>
                      <span className="text-[10px] uppercase tracking-wide text-cyan-200/70">
                        edge
                      </span>
                    </div>
                    <p className="text-xs text-cyan-100/75">
                      Explore deeper evidence around this link using broader
                      literature sources and focused research prompts.
                    </p>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <a
                        href={`https://scholar.google.com/scholar?q=${encodeURIComponent(edgeResearchQuery)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        Google Scholar
                      </a>
                      <a
                        href={`https://www.semanticscholar.org/search?q=${encodeURIComponent(edgeResearchQuery)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        Semantic Scholar
                      </a>
                      <a
                        href={getArxivSearchUrl(edgeResearchQuery)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        arXiv
                      </a>
                      <a
                        href={getCrossrefSearchUrl(edgeResearchQuery)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        Crossref
                      </a>
                      <a
                        href={getCoreSearchUrl(edgeResearchQuery)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        CORE
                      </a>
                      <a
                        href={getPubMedSearchUrl(edgeResearchQuery)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-md border border-cyan-800/50 text-xs text-cyan-100 hover:border-cyan-500/60"
                      >
                        PubMed
                      </a>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[11px] text-cyan-100/75">
                        Suggested link questions
                      </p>
                      <ul className="space-y-1">
                        {edgeResearchQuestions.map((question) => (
                          <li
                            key={question}
                            className="text-xs text-cyan-50/90 rounded-md border border-cyan-900/40 bg-cyan-950/30 px-2.5 py-1.5"
                          >
                            {question}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[11px] text-cyan-100/75">Paper search angles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {edgeResearchSearchAngles.map((angle) => (
                          <a
                            key={angle}
                            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(angle)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-full border border-cyan-800/50 px-2 py-1 text-[11px] text-cyan-100 hover:border-cyan-500/60"
                          >
                            {angle}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

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
                                    disabled={isCombinedMapSelected || saved || saving}
                                    className="px-2 py-1 rounded-md border border-emerald-600/70 text-emerald-300 text-xs disabled:opacity-60"
                                  >
                                    {isCombinedMapSelected
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

                  {!isCombinedMapSelected && (
                    <details className="rounded-md border border-blue-800/40 bg-blue-950/10 px-3 py-2">
                      <summary className="cursor-pointer select-none text-xs text-blue-200">
                        Add your own paper link
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={manualEdgeEvidenceTitle}
                            onChange={(e) => setManualEdgeEvidenceTitle(e.target.value)}
                            placeholder="Paper title *"
                            className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          />
                          <input
                            type="text"
                            value={manualEdgeEvidenceUrl}
                            onChange={(e) => setManualEdgeEvidenceUrl(e.target.value)}
                            placeholder="URL or DOI link *"
                            className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          />
                          <input
                            type="text"
                            value={manualEdgeEvidenceJournal}
                            onChange={(e) => setManualEdgeEvidenceJournal(e.target.value)}
                            placeholder="Journal / venue (optional)"
                            className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          />
                          <input
                            type="text"
                            value={manualEdgeEvidenceYear}
                            onChange={(e) => setManualEdgeEvidenceYear(e.target.value)}
                            placeholder="Year (optional)"
                            className="rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <input
                          type="text"
                          value={manualEdgeEvidenceAuthors}
                          onChange={(e) => setManualEdgeEvidenceAuthors(e.target.value)}
                          placeholder="Authors (optional, comma-separated)"
                          className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                        <textarea
                          value={manualEdgeEvidenceReason}
                          onChange={(e) => setManualEdgeEvidenceReason(e.target.value)}
                          placeholder="Why this paper supports this connection (optional)"
                          className="w-full min-h-[64px] rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                        {manualEdgeEvidenceError && (
                          <p className="text-xs text-red-300">{manualEdgeEvidenceError}</p>
                        )}
                        <button
                          onClick={handleSaveManualEdgeEvidence}
                          disabled={manualEdgeEvidenceSaving}
                          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs text-white"
                        >
                          {manualEdgeEvidenceSaving ? "Saving..." : "Save paper link"}
                        </button>
                      </div>
                    </details>
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
                                disabled={
                                  isCombinedMapSelected ||
                                  deletingEvidenceId === source.id
                                }
                                className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50"
                              >
                                {isCombinedMapSelected
                                  ? "Read-only"
                                  : deletingEvidenceId === source.id
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">Edge notes</p>
                      <span className="text-[11px] text-gray-500">
                        {edgeNotesWordCount} words · {edgeNotesCharCount} chars
                      </span>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-800/40 p-2 space-y-1.5">
                      <p className="text-[11px] text-gray-500">Quick note blocks</p>
                      <div className="flex flex-wrap gap-1.5">
                        {edgeNoteTemplates.map((template) => (
                          <button
                            key={template}
                            type="button"
                            onClick={() => handleAppendEdgeNoteTemplate(template)}
                            disabled={edgeNotesLoading || isCombinedMapSelected}
                            className="rounded-full border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-blue-500/60 hover:text-blue-200 disabled:opacity-60"
                          >
                            {template.split(":")[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      value={edgeNotes}
                      onChange={(e) => {
                        setEdgeNotes(e.target.value);
                        if (edgeNotesError) setEdgeNotesError("");
                      }}
                      placeholder="Capture claims, caveats, and why this link matters..."
                      disabled={edgeNotesLoading || isCombinedMapSelected}
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
                        disabled={
                          edgeNotesLoading ||
                          edgeNotesSaving ||
                          isCombinedMapSelected
                        }
                        className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm text-white"
                      >
                        {isCombinedMapSelected
                          ? "Read-only"
                          : edgeNotesSaving
                            ? "Saving..."
                            : "Save edge notes"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      closeEdgePanelImmediate();
                      setSelectedTopic({
                        id: selectedLink.sourceId,
                        name: selectedLink.sourceName,
                      });
                    }}
                    className="flex-1 px-3 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/60 text-sm text-gray-200"
                  >
                    Open {selectedLink.sourceName}
                  </button>
                  <button
                    onClick={() => {
                      closeEdgePanelImmediate();
                      setSelectedTopic({
                        id: selectedLink.targetId,
                        name: selectedLink.targetName,
                      });
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
