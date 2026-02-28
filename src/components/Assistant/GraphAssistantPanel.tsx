"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphAssistantBuildMapResponse,
  GraphAssistantExtractPaperResponse,
  GraphAssistantExtendMapResponse,
  GraphAssistantMode,
  GraphAssistantCitation,
  GraphAssistantQueryRequest,
  GraphAssistantQueryResponse,
  GraphAssistantScope,
  GraphLinkSelection,
} from "@/lib/types";

interface GraphAssistantPanelProps {
  mapId: string | null;
  mapName: string | null;
  isCombinedMap: boolean;
  selectedTopic: { id: string; name: string } | null;
  selectedLink: GraphLinkSelection | null;
  autoAskRequest?: {
    id: string;
    prompt: string;
    mode?: GraphAssistantMode;
    scope?: GraphAssistantScope;
  } | null;
  fullscreen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  onMapCreated?: (mapId: string) => void;
  onMapExtended?: () => void;
}

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  scope: GraphAssistantScope;
  assistantMode: GraphAssistantMode;
  createdAt: string;
  citations: GraphAssistantCitation[];
  suggestedFollowups: string[];
  insufficientEvidence: boolean;
  externalPaperCount: number;
  nodeId?: string | null;
  interestAId?: string | null;
  interestBId?: string | null;
}

interface InterestNotesRow {
  id: string;
  notes: string;
}

interface EdgeNotesPayload {
  notes: string;
  updated_at: string | null;
}

interface EvidenceSourcePayload {
  title: string;
  url: string;
  year: number | null;
  journal: string;
  authors: string[];
  reason: string;
  sourceProvider: string;
}

interface ActionStatus {
  type: "success" | "error";
  text: string;
}

interface PaperContextEntry {
  id: string;
  fileName: string;
  paperTitle: string;
  textCharCount: number | null;
  createdAt: string;
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function scopeLabel(scope: GraphAssistantScope): string {
  if (scope === "node") return "Node";
  if (scope === "edge") return "Edge";
  return "Map";
}

const COMPOSER_SUGGESTIONS = [
  "Biggest evidence gaps?",
  "Strongest node summary",
  "Next investigation step",
];

export default function GraphAssistantPanel({
  mapId,
  mapName,
  isCombinedMap,
  selectedTopic,
  selectedLink,
  autoAskRequest = null,
  fullscreen = false,
  onOpenChange,
  onMapCreated,
  onMapExtended,
}: GraphAssistantPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scope, setScope] = useState<GraphAssistantScope>("map");
  const assistantMode: GraphAssistantMode = "general";
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allowExternalPapers, setAllowExternalPapers] = useState(true);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [messageStatuses, setMessageStatuses] = useState<Record<string, ActionStatus>>(
    {}
  );
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [buildMapLoading, setBuildMapLoading] = useState(false);
  const [buildMapFeedback, setBuildMapFeedback] = useState("");
  const [buildMapError, setBuildMapError] = useState("");
  const [extendMapLoading, setExtendMapLoading] = useState(false);
  const [extendMapFeedback, setExtendMapFeedback] = useState("");
  const [extendMapError, setExtendMapError] = useState("");
  const [extractPaperLoading, setExtractPaperLoading] = useState(false);
  const [extractPaperFeedback, setExtractPaperFeedback] = useState("");
  const [extractPaperError, setExtractPaperError] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperFocusPrompt, setPaperFocusPrompt] = useState("");
  const [paperMaxTopics, setPaperMaxTopics] = useState(18);
  const [paperContexts, setPaperContexts] = useState<PaperContextEntry[]>([]);
  const [paperContextsLoading, setPaperContextsLoading] = useState(false);
  const [paperContextId, setPaperContextId] = useState("");
  const [paperToolsOpen, setPaperToolsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const paperInputRef = useRef<HTMLInputElement | null>(null);
  const handledAutoAskIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMessages([]);
    setQuestion("");
    setError("");
    setLoading(false);
    setScope("map");
    setAllowExternalPapers(true);
    setIsOpen(false);
    setMessageStatuses({});
    setActiveActionKey(null);
    setBuildMapLoading(false);
    setBuildMapFeedback("");
    setBuildMapError("");
    setExtendMapLoading(false);
    setExtendMapFeedback("");
    setExtendMapError("");
    setExtractPaperLoading(false);
    setExtractPaperFeedback("");
    setExtractPaperError("");
    setPaperFile(null);
    setPaperFocusPrompt("");
    setPaperMaxTopics(18);
    setPaperContexts([]);
    setPaperContextsLoading(false);
    setPaperContextId("");
    setPaperToolsOpen(false);
    if (paperInputRef.current) {
      paperInputRef.current.value = "";
    }
  }, [mapId]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    setScope((prev) => {
      if (prev === "edge" && !selectedLink) {
        return selectedTopic ? "node" : "map";
      }
      if (prev === "node" && !selectedTopic) {
        return selectedLink ? "edge" : "map";
      }
      return prev;
    });
  }, [selectedLink, selectedTopic]);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, isOpen]);

  const contextDescription = useMemo(() => {
    if (scope === "node") {
      return selectedTopic ? `Focused node: ${selectedTopic.name}` : "No node selected";
    }
    if (scope === "edge") {
      return selectedLink
        ? `Focused edge: ${selectedLink.sourceName} ↔ ${selectedLink.targetName}`
        : "No edge selected";
    }
    return mapName ? `Current map: ${mapName}` : "No map selected";
  }, [mapName, scope, selectedLink, selectedTopic]);

  const hasMap = Boolean(mapId);
  const dockOffsetClass = fullscreen ? "bottom-6 right-6" : "bottom-3 right-3";
  const scopeDisabled = {
    map: !hasMap || isCombinedMap,
    node: !hasMap || isCombinedMap || !selectedTopic,
    edge: !hasMap || isCombinedMap || !selectedLink,
  };

  const fetchPaperContexts = useCallback(async () => {
    if (!mapId || isCombinedMap) {
      setPaperContexts([]);
      setPaperContextId("");
      return;
    }

    setPaperContextsLoading(true);
    try {
      const params = new URLSearchParams({ mapId });
      const res = await fetch(`/api/assistant/paper-contexts?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to load saved paper contexts."
        );
      }

      const contexts = Array.isArray(data.contexts)
        ? (data.contexts as PaperContextEntry[])
        : [];
      setPaperContexts(contexts);
      setPaperContextId((prev) => {
        if (prev && contexts.some((item) => item.id === prev)) return prev;
        return contexts[0]?.id || "";
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load saved paper contexts.";
      setExtractPaperError(message);
    } finally {
      setPaperContextsLoading(false);
    }
  }, [isCombinedMap, mapId]);

  useEffect(() => {
    void fetchPaperContexts();
  }, [fetchPaperContexts]);

  async function handleBuildMapFromPrompt() {
    const prompt = question.trim();
    if (!prompt) {
      setBuildMapError("Enter a map prompt first.");
      return;
    }

    setBuildMapLoading(true);
    setBuildMapError("");
    setBuildMapFeedback("");
    setExtendMapError("");
    setExtendMapFeedback("");
    setExtractPaperError("");
    setExtractPaperFeedback("");

    try {
      const res = await fetch("/api/assistant/build-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to build map."
        );
      }

      const result = data as GraphAssistantBuildMapResponse;
      setBuildMapFeedback(
        `Created "${result.mapName}" with ${result.createdCount} topic${
          result.createdCount === 1 ? "" : "s"
        }.`
      );
      setQuestion("");
      onMapCreated?.(result.mapId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build map.";
      setBuildMapError(message);
    } finally {
      setBuildMapLoading(false);
    }
  }

  async function handleExtendMapFromPrompt() {
    if (!mapId) {
      setExtendMapError("Select a map first.");
      return;
    }
    if (isCombinedMap) {
      setExtendMapError("Combined map cannot be extended.");
      return;
    }

    const prompt = question.trim();
    if (!prompt) {
      setExtendMapError("Enter a prompt to steer how this map is extended.");
      return;
    }
    setExtendMapLoading(true);
    setExtendMapError("");
    setExtendMapFeedback("");
    setBuildMapError("");
    setBuildMapFeedback("");
    setExtractPaperError("");
    setExtractPaperFeedback("");

    try {
      const res = await fetch("/api/assistant/extend-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId,
          prompt,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to extend map."
        );
      }

      const result = data as GraphAssistantExtendMapResponse;
      if (result.createdCount === 0) {
        setExtendMapFeedback("No new unique topics were added. Try a more specific prompt.");
      } else {
        setExtendMapFeedback(
          `Added ${result.createdCount} topic${
            result.createdCount === 1 ? "" : "s"
          } to "${result.mapName}".`
        );
      }

      setQuestion("");
      onMapExtended?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to extend map.";
      setExtendMapError(message);
    } finally {
      setExtendMapLoading(false);
    }
  }

  async function handleExtractTermsFromPaper() {
    if (!mapId) {
      setExtractPaperError("Select a map first.");
      return;
    }
    if (isCombinedMap) {
      setExtractPaperError("Combined map cannot be extended from a paper.");
      return;
    }
    if (!paperFile) {
      setExtractPaperError("Choose a paper file first (PDF or text).");
      return;
    }

    setExtractPaperLoading(true);
    setExtractPaperError("");
    setExtractPaperFeedback("");
    setBuildMapError("");
    setBuildMapFeedback("");
    setExtendMapError("");
    setExtendMapFeedback("");

    try {
      const formData = new FormData();
      formData.append("mapId", mapId);
      formData.append("file", paperFile);
      formData.append("maxTopics", String(paperMaxTopics));
      if (paperFocusPrompt.trim()) {
        formData.append("focusPrompt", paperFocusPrompt.trim());
      }

      const res = await fetch("/api/assistant/extract-paper-terms", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to extract terms from this paper."
        );
      }

      const result = data as GraphAssistantExtractPaperResponse;
      if (result.createdCount === 0) {
        setExtractPaperFeedback(
          "No new unique topics were added from this paper."
        );
      } else {
        setExtractPaperFeedback(
          `Added ${result.createdCount} topic${
            result.createdCount === 1 ? "" : "s"
          } from "${result.paperTitle}".`
        );
      }
      if (result.paperContextId) {
        setPaperContextId(result.paperContextId);
      }
      setPaperFile(null);
      setPaperFocusPrompt("");
      if (paperInputRef.current) {
        paperInputRef.current.value = "";
      }
      await fetchPaperContexts();
      onMapExtended?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to extract terms from this paper.";
      setExtractPaperError(message);
    } finally {
      setExtractPaperLoading(false);
    }
  }

  async function handleExtractTermsFromSavedContext() {
    if (!mapId) {
      setExtractPaperError("Select a map first.");
      return;
    }
    if (isCombinedMap) {
      setExtractPaperError("Combined map cannot be extended from a paper.");
      return;
    }
    if (!paperContextId) {
      setExtractPaperError("Select a saved paper context first.");
      return;
    }

    setExtractPaperLoading(true);
    setExtractPaperError("");
    setExtractPaperFeedback("");
    setBuildMapError("");
    setBuildMapFeedback("");
    setExtendMapError("");
    setExtendMapFeedback("");

    try {
      const formData = new FormData();
      formData.append("mapId", mapId);
      formData.append("paperContextId", paperContextId);
      formData.append("maxTopics", String(paperMaxTopics));
      if (paperFocusPrompt.trim()) {
        formData.append("focusPrompt", paperFocusPrompt.trim());
      }

      const res = await fetch("/api/assistant/extract-paper-terms", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to extract additional terms from saved paper."
        );
      }

      const result = data as GraphAssistantExtractPaperResponse;
      if (result.createdCount === 0) {
        setExtractPaperFeedback(
          "No new unique topics were added from the saved paper context."
        );
      } else {
        setExtractPaperFeedback(
          `Added ${result.createdCount} topic${
            result.createdCount === 1 ? "" : "s"
          } from saved context "${result.paperTitle}".`
        );
      }
      onMapExtended?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to extract additional terms from saved paper.";
      setExtractPaperError(message);
    } finally {
      setExtractPaperLoading(false);
    }
  }

  function setMessageStatus(
    messageId: string,
    status: ActionStatus["type"],
    text: string
  ) {
    setMessageStatuses((prev) => ({
      ...prev,
      [messageId]: { type: status, text },
    }));
  }

  function buildAssistantNoteBlock(answer: string): string {
    const timestamp = new Date().toISOString();
    return `Assistant answer (${timestamp})\n${answer.trim()}`;
  }

  function appendNoteBlock(existing: string, block: string): string {
    const trimmed = existing.trimEnd();
    const spacer = trimmed.length > 0 ? "\n\n" : "";
    return `${trimmed}${spacer}${block}`;
  }

  function citationToEvidenceSource(
    citation: GraphAssistantCitation
  ): EvidenceSourcePayload | null {
    if (!citation.url) return null;
    return {
      title: (citation.paperTitle || citation.label || "").trim(),
      url: citation.url,
      year: typeof citation.year === "number" ? citation.year : null,
      journal: (citation.journal || "Unknown venue").trim() || "Unknown venue",
      authors: Array.isArray(citation.authors)
        ? citation.authors
            .filter((author): author is string => typeof author === "string")
            .map((author) => author.trim())
            .filter((author) => author.length > 0)
            .slice(0, 8)
        : [],
      reason:
        (citation.reason || citation.snippet || "Saved from assistant citation.")
          .trim()
          .slice(0, 500),
      sourceProvider: (citation.sourceProvider || "assistant").trim() || "assistant",
    };
  }

  async function handleSaveAnswerToNodeNotes(message: AssistantMessage) {
    if (!mapId || !message.nodeId) return;
    const actionKey = `${message.id}:node-notes`;
    setActiveActionKey(actionKey);
    setMessageStatus(message.id, "success", "");
    try {
      const params = new URLSearchParams({ mapId });
      const interestsRes = await fetch(`/api/interests?${params.toString()}`);
      if (!interestsRes.ok) {
        const data = await interestsRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load node notes");
      }

      const interests = (await interestsRes.json()) as InterestNotesRow[];
      const target = interests.find((interest) => interest.id === message.nodeId);
      if (!target) {
        throw new Error("Target node was not found.");
      }

      const mergedNotes = appendNoteBlock(
        typeof target.notes === "string" ? target.notes : "",
        buildAssistantNoteBlock(message.text)
      );

      const saveRes = await fetch("/api/interests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.nodeId, notes: mergedNotes }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save node notes");
      }

      setMessageStatus(message.id, "success", "Saved answer to node notes.");
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : "Failed to save node notes.";
      setMessageStatus(message.id, "error", messageText);
    } finally {
      setActiveActionKey(null);
    }
  }

  async function handleSaveAnswerToEdgeNotes(message: AssistantMessage) {
    if (!mapId || !message.interestAId || !message.interestBId) return;
    const actionKey = `${message.id}:edge-notes`;
    setActiveActionKey(actionKey);
    setMessageStatus(message.id, "success", "");
    try {
      const params = new URLSearchParams({
        mapId,
        interestAId: message.interestAId,
        interestBId: message.interestBId,
      });
      const currentRes = await fetch(`/api/edges/notes?${params.toString()}`);
      if (!currentRes.ok) {
        const data = await currentRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load edge notes");
      }
      const current = (await currentRes.json()) as EdgeNotesPayload;
      const mergedNotes = appendNoteBlock(
        typeof current.notes === "string" ? current.notes : "",
        buildAssistantNoteBlock(message.text)
      );

      const saveRes = await fetch("/api/edges/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId,
          interestAId: message.interestAId,
          interestBId: message.interestBId,
          notes: mergedNotes,
        }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save edge notes");
      }

      setMessageStatus(message.id, "success", "Saved answer to edge notes.");
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : "Failed to save edge notes.";
      setMessageStatus(message.id, "error", messageText);
    } finally {
      setActiveActionKey(null);
    }
  }

  async function handleSaveCitedPapers(message: AssistantMessage) {
    if (!mapId) return;
    const isNodeScope = message.scope === "node" && Boolean(message.nodeId);
    const isEdgeScope =
      message.scope === "edge" &&
      Boolean(message.interestAId) &&
      Boolean(message.interestBId);
    if (!isNodeScope && !isEdgeScope) return;

    const actionKey = `${message.id}:papers`;
    setActiveActionKey(actionKey);
    setMessageStatus(message.id, "success", "");
    try {
      const sources = message.citations
        .filter((citation) => citation.type === "paper")
        .map((citation) => citationToEvidenceSource(citation))
        .filter((source): source is EvidenceSourcePayload => Boolean(source));

      if (sources.length === 0) {
        throw new Error("No paper citations to save for this answer.");
      }

      const endpoint = isNodeScope ? "/api/interests/evidence" : "/api/edges/evidence";
      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          const body = isNodeScope
            ? {
                mapId,
                interestId: message.nodeId,
                source,
              }
            : {
                mapId,
                interestAId: message.interestAId,
                interestBId: message.interestBId,
                source,
              };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to save paper citation");
          }
        })
      );

      const successCount = settled.filter(
        (result) => result.status === "fulfilled"
      ).length;
      const failureCount = settled.length - successCount;

      if (successCount === 0) {
        throw new Error("Failed to save cited papers.");
      }

      setMessageStatus(
        message.id,
        failureCount === 0 ? "success" : "error",
        failureCount === 0
          ? `Saved ${successCount} cited paper${successCount === 1 ? "" : "s"}.`
          : `Saved ${successCount} paper(s), ${failureCount} failed.`
      );
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : "Failed to save cited papers.";
      setMessageStatus(message.id, "error", messageText);
    } finally {
      setActiveActionKey(null);
    }
  }

  const handleAsk = useCallback(async (
    directQuestion?: string,
    options?: { scope?: GraphAssistantScope }
  ) => {
    if (loading) return;

    const trimmed =
      typeof directQuestion === "string"
        ? directQuestion.trim()
        : question.trim();
    const effectiveMode = assistantMode;
    const effectiveScope = options?.scope ?? scope;
    if (!trimmed) {
      setError("Enter a question first.");
      return;
    }

    if (!mapId) {
      setError("Select a map first.");
      return;
    }

    if (isCombinedMap) {
      setError("Assistant currently runs on individual maps only.");
      return;
    }

    if (effectiveScope === "node" && !selectedTopic) {
      setError("Select a node for Node scope.");
      return;
    }

    if (effectiveScope === "edge" && !selectedLink) {
      setError("Select an edge for Edge scope.");
      return;
    }

    const userMessage: AssistantMessage = {
      id: createMessageId(),
      role: "user",
      text: trimmed,
      scope: effectiveScope,
      assistantMode: effectiveMode,
      createdAt: new Date().toISOString(),
      citations: [],
      suggestedFollowups: [],
      insufficientEvidence: false,
      externalPaperCount: 0,
      nodeId: effectiveScope === "node" ? selectedTopic?.id || null : null,
      interestAId:
        effectiveScope === "edge" ? selectedLink?.sourceId || null : null,
      interestBId:
        effectiveScope === "edge" ? selectedLink?.targetId || null : null,
    };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setError("");
    setBuildMapError("");
    setBuildMapFeedback("");
    setExtendMapError("");
    setExtendMapFeedback("");
    setLoading(true);

    const payload: GraphAssistantQueryRequest = {
      mapId,
      scope: effectiveScope,
      assistantMode: effectiveMode,
      question: trimmed,
      allowExternalPapers,
    };

    if (effectiveScope === "node" && selectedTopic) {
      payload.nodeId = selectedTopic.id;
    }

    if (effectiveScope === "edge" && selectedLink) {
      payload.interestAId = selectedLink.sourceId;
      payload.interestBId = selectedLink.targetId;
      payload.edgeSimilarity = selectedLink.similarity;
    }

    try {
      const res = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to get assistant answer."
        );
      }

      const answer = data as GraphAssistantQueryResponse;
      const assistantMessage: AssistantMessage = {
        id: createMessageId(),
        role: "assistant",
        text: answer.answer,
        scope: answer.scope,
        assistantMode: answer.assistantMode,
        createdAt: answer.generatedAt,
        citations: Array.isArray(answer.citations) ? answer.citations : [],
        suggestedFollowups: Array.isArray(answer.suggestedFollowups)
          ? answer.suggestedFollowups
          : [],
        insufficientEvidence: answer.insufficientEvidence === true,
        externalPaperCount:
          typeof answer.externalPaperCount === "number"
            ? answer.externalPaperCount
            : 0,
        nodeId: payload.nodeId || null,
        interestAId: payload.interestAId || null,
        interestBId: payload.interestBId || null,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get assistant answer.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    allowExternalPapers,
    assistantMode,
    isCombinedMap,
    loading,
    mapId,
    question,
    scope,
    selectedLink,
    selectedTopic,
  ]);

  useEffect(() => {
    if (!autoAskRequest) return;
    if (handledAutoAskIdRef.current === autoAskRequest.id) return;

    const prompt = autoAskRequest.prompt.trim();
    if (!prompt) return;

    handledAutoAskIdRef.current = autoAskRequest.id;

    const requestedScope = autoAskRequest.scope ?? "node";
    const resolvedScope: GraphAssistantScope =
      requestedScope === "node"
        ? scopeDisabled.node
          ? "map"
          : "node"
        : requestedScope === "edge"
          ? scopeDisabled.edge
            ? "map"
            : "edge"
          : "map";

    setScope(resolvedScope);
    setIsOpen(true);
    setError("");
    setQuestion(prompt);
    void handleAsk(prompt, { scope: resolvedScope });
  }, [autoAskRequest, handleAsk, scopeDisabled.edge, scopeDisabled.map, scopeDisabled.node]);

  if (!hasMap) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`absolute z-40 h-10 w-10 rounded-full border border-cyan-500/70 bg-cyan-500/10 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 ${dockOffsetClass}`}
          title="AI"
          aria-label="Open AI panel"
        >
          AI
        </button>
      )}

      {isOpen && (
        <aside className={`absolute z-40 flex h-[min(82vh,760px)] w-[min(46rem,calc(100%-1.5rem))] flex-col rounded-xl border border-gray-700/90 bg-gray-950/98 shadow-2xl backdrop-blur-[1px] ${dockOffsetClass}`}>
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-white">Graph Assistant</p>
              <p className="text-[11px] text-gray-400">{contextDescription}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setError("");
                  setMessageStatuses({});
                }}
                className="h-9 rounded-md border border-gray-700 px-3 text-xs font-medium text-gray-300 hover:border-gray-500 hover:text-white"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-sm text-gray-400 hover:border-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="border-b border-gray-800 px-3 py-2">
            <p className="mb-2 text-[11px] text-gray-400">
              Chat uses the selected focus and current map context.
            </p>
            <div className="flex items-center gap-2">
              {(["map", "node", "edge"] as GraphAssistantScope[]).map(
                (scopeOption) => (
                  <button
                    key={scopeOption}
                    type="button"
                    onClick={() => setScope(scopeOption)}
                    disabled={scopeDisabled[scopeOption]}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      scope === scopeOption
                        ? "border-cyan-500/70 bg-cyan-500/15 text-cyan-100"
                        : "border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {scopeLabel(scopeOption)}
                  </button>
                )
              )}
            </div>
            {isCombinedMap && (
              <p className="mt-2 text-[11px] text-amber-300">
                Assistant currently supports individual maps, not Combined.
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
              <input
                type="checkbox"
                checked={allowExternalPapers}
                onChange={(e) => setAllowExternalPapers(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 accent-cyan-500"
              />
              Explore external papers for this question
            </label>
            <div className="mt-2 space-y-2">
                <div className="rounded-md border border-cyan-900/60 bg-cyan-950/15">
                  <button
                    type="button"
                    onClick={() => setPaperToolsOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-2.5 py-2 text-left"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-cyan-200">
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 2.8h6l4 4V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 2.8V7h4"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Paper tools
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                      {paperContexts.length > 0 ? `${paperContexts.length} saved` : "No saved"}
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        className={`h-3.5 w-3.5 transition-transform ${
                          paperToolsOpen ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <path
                          d="M5 8l5 5 5-5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>

                  {paperToolsOpen && (
                    <div className="space-y-2 px-2.5 pb-2">
                      <p className="text-[11px] text-gray-400">
                        Uploaded paper contexts are available to assistant chat.
                      </p>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-gray-400">Saved paper contexts</p>
                          {paperContextsLoading && (
                            <span className="text-[11px] text-gray-500">Loading...</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={paperContextId}
                            onChange={(e) => setPaperContextId(e.target.value)}
                            className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-100 focus:border-cyan-500 focus:outline-none"
                          >
                            <option value="">Select saved paper context</option>
                            {paperContexts.map((context) => (
                              <option key={context.id} value={context.id}>
                                {context.paperTitle}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleExtractTermsFromSavedContext}
                            disabled={
                              extractPaperLoading ||
                              buildMapLoading ||
                              extendMapLoading ||
                              loading ||
                              isCombinedMap ||
                              !paperContextId
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-600/70 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200 hover:border-cyan-500 disabled:opacity-60"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path
                                d="M16 10a6 6 0 1 1-1.7-4.2M16 4.7v3.5h-3.5"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Add more
                          </button>
                        </div>
                        {paperContexts.length === 0 && !paperContextsLoading && (
                          <p className="text-[11px] text-gray-500">
                            Upload a paper once and it will appear here for reuse.
                          </p>
                        )}
                      </div>
                      <input
                        ref={paperInputRef}
                        type="file"
                        accept=".pdf,.txt,.md,.markdown,.tex,text/plain,application/pdf"
                        onChange={(e) => {
                          const nextFile = e.target.files?.[0] || null;
                          setPaperFile(nextFile);
                        }}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => paperInputRef.current?.click()}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-200 hover:border-gray-500"
                        >
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path
                              d="M10 13V3M10 3l-3 3m3-3l3 3M4 13.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2.5"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {paperFile ? "Change file" : "Upload"}
                        </button>
                        <span className="max-w-[19rem] truncate text-[11px] text-gray-400">
                          {paperFile ? paperFile.name : "No file selected"}
                        </span>
                        {paperFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaperFile(null);
                              if (paperInputRef.current) {
                                paperInputRef.current.value = "";
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path
                                d="M5 5l10 10M15 5L5 15"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Clear
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={paperFocusPrompt}
                        onChange={(e) => setPaperFocusPrompt(e.target.value)}
                        placeholder="Optional extraction focus (e.g. datasets + failure modes)"
                        className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-100 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-gray-400">Max topics</label>
                        <input
                          type="number"
                          min={6}
                          max={30}
                          step={1}
                          value={paperMaxTopics}
                          onChange={(e) => {
                            const parsed = Number(e.target.value);
                            if (!Number.isFinite(parsed)) return;
                            const clamped = Math.max(6, Math.min(30, Math.trunc(parsed)));
                            setPaperMaxTopics(clamped);
                          }}
                          className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-100 focus:border-cyan-500 focus:outline-none"
                        />
                        <span className="text-[11px] text-gray-500">
                          6-30 per upload
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleExtractTermsFromPaper}
                        disabled={
                          extractPaperLoading ||
                          buildMapLoading ||
                          extendMapLoading ||
                          loading ||
                          isCombinedMap
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/70 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200 hover:border-emerald-500 disabled:opacity-60"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            d="M10 3.5l2 4 4.5.7-3.3 3.2.8 4.5-4-2.1-4 2.1.8-4.5L3.5 8.2 8 7.5l2-4z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {extractPaperLoading
                          ? "Analyzing paper..."
                          : "Add terms from paper"}
                      </button>
                    </div>
                  )}
                </div>
                {buildMapFeedback && (
                  <p className="text-[11px] text-emerald-300">{buildMapFeedback}</p>
                )}
                {buildMapError && (
                  <p className="text-[11px] text-red-300">{buildMapError}</p>
                )}
                {extendMapFeedback && (
                  <p className="text-[11px] text-cyan-300">{extendMapFeedback}</p>
                )}
                {extendMapError && (
                  <p className="text-[11px] text-red-300">{extendMapError}</p>
                )}
                {extractPaperFeedback && (
                  <p className="text-[11px] text-emerald-300">
                    {extractPaperFeedback}
                  </p>
                )}
                {extractPaperError && (
                  <p className="text-[11px] text-red-300">{extractPaperError}</p>
                )}
              </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="flex min-h-full flex-col gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[92%] rounded-md border px-3 py-2 ${
                    message.role === "user"
                      ? "ml-auto border-blue-500/30 bg-blue-500/10 text-blue-100"
                      : "border-gray-700 bg-gray-900/80 text-gray-100"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    {message.role === "user"
                      ? "You"
                      : `Assistant · ${scopeLabel(message.scope)} focus`}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {message.text}
                  </p>

                  {message.role === "assistant" && message.assistantMode === "grounded" && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.scope === "node" && message.nodeId && (
                        <button
                          type="button"
                          onClick={() => handleSaveAnswerToNodeNotes(message)}
                          disabled={activeActionKey === `${message.id}:node-notes`}
                          className="rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-60"
                        >
                          {activeActionKey === `${message.id}:node-notes`
                            ? "Saving..."
                            : "Save to node notes"}
                        </button>
                      )}
                      {message.scope === "edge" &&
                        message.interestAId &&
                        message.interestBId && (
                          <button
                            type="button"
                            onClick={() => handleSaveAnswerToEdgeNotes(message)}
                            disabled={activeActionKey === `${message.id}:edge-notes`}
                            className="rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-60"
                          >
                            {activeActionKey === `${message.id}:edge-notes`
                              ? "Saving..."
                              : "Save to edge notes"}
                          </button>
                        )}
                      {((message.scope === "node" && message.nodeId) ||
                        (message.scope === "edge" &&
                          message.interestAId &&
                          message.interestBId)) && (
                        <button
                          type="button"
                          onClick={() => handleSaveCitedPapers(message)}
                          disabled={activeActionKey === `${message.id}:papers`}
                          className="rounded-md border border-cyan-700/60 px-2 py-1 text-[11px] text-cyan-200 hover:border-cyan-500 hover:text-cyan-100 disabled:opacity-60"
                        >
                          {activeActionKey === `${message.id}:papers`
                            ? "Saving..."
                            : "Save cited papers"}
                        </button>
                      )}
                    </div>
                  )}

                  {message.role === "assistant" &&
                    message.citations.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-gray-400">Citations</p>
                      {message.citations.map((citation) => (
                        <div
                          key={citation.id}
                          className="rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5"
                        >
                          {citation.url ? (
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-cyan-200 hover:text-cyan-100"
                            >
                              {citation.label}
                            </a>
                          ) : (
                            <p className="text-xs text-gray-200">{citation.label}</p>
                          )}
                          <p className="mt-0.5 text-[11px] text-gray-500">
                            {citation.snippet}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {message.role === "assistant" &&
                    message.suggestedFollowups.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {message.suggestedFollowups.map((followup) => (
                        <button
                          key={`${message.id}-${followup}`}
                          type="button"
                          onClick={() => {
                            void handleAsk(followup);
                          }}
                          className="rounded-full border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white"
                        >
                          {followup}
                        </button>
                        ))}
                      </div>
                    )}

                  {message.role === "assistant" && message.insufficientEvidence && (
                    <p className="mt-2 text-[11px] text-amber-300">
                      Limited map evidence for this answer.
                    </p>
                  )}
                  {message.role === "assistant" &&
                    message.externalPaperCount > 0 && (
                    <p className="mt-1 text-[11px] text-cyan-300">
                      Included {message.externalPaperCount} external paper result
                      {message.externalPaperCount === 1 ? "" : "s"}.
                    </p>
                  )}
                  {message.role === "assistant" && messageStatuses[message.id]?.text && (
                    <p
                      className={`mt-1 text-[11px] ${
                        messageStatuses[message.id]?.type === "error"
                          ? "text-red-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {messageStatuses[message.id]?.text}
                    </p>
                  )}
                </div>
              ))}

              {loading && (
                <div className="max-w-[92%]">
                  <div className="inline-flex items-center gap-1 rounded-2xl border border-cyan-700/40 bg-cyan-500/10 px-3 py-2">
                    <span
                      className="assistant-typing-dot"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="assistant-typing-dot"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="assistant-typing-dot"
                      style={{ animationDelay: "300ms" }}
                    />
                    <span className="sr-only">Assistant is typing</span>
                  </div>
                </div>
              )}

              <div className="mt-auto rounded-md border border-gray-800 bg-gray-950/80 px-2.5 py-2">
                {messages.length === 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {COMPOSER_SUGGESTIONS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => {
                          void handleAsk(starter);
                        }}
                        className="rounded-full border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-cyan-500/70 hover:text-cyan-100"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-stretch gap-2">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!loading) handleAsk();
                      }
                    }}
                    rows={2}
                    placeholder="Ask about this map, node, or edge..."
                    className="flex-1 resize-none rounded-md border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleBuildMapFromPrompt}
                    disabled={buildMapLoading || extendMapLoading || loading}
                    className="self-stretch rounded-md border border-emerald-500/70 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-60"
                  >
                    {buildMapLoading ? "Building..." : "Build"}
                  </button>
                  <button
                    type="button"
                    onClick={handleExtendMapFromPrompt}
                    disabled={
                      extendMapLoading ||
                      buildMapLoading ||
                      loading ||
                      isCombinedMap
                    }
                    className="self-stretch rounded-md border border-indigo-500/70 bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/25 disabled:opacity-60"
                  >
                    {extendMapLoading ? "Extending..." : "Extend"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAsk();
                    }}
                    disabled={loading}
                    className="self-stretch rounded-md border border-cyan-500/70 bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-60"
                  >
                    {loading ? "Asking..." : "Ask"}
                  </button>
                </div>
                <div className="mt-1 min-h-[1rem]">
                  {error ? (
                    <p className="text-xs text-red-300">{error}</p>
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      {`Map-aware chat with ${scopeLabel(scope).toLowerCase()} focus${
                        allowExternalPapers ? " + external paper metadata." : "."
                      }`}
                    </p>
                  )}
                </div>
              </div>
              <div ref={endRef} />
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
