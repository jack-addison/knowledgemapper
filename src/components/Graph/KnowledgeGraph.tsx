"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphData, GraphLayoutMode, GraphLinkSelection } from "@/lib/types";
import * as d3 from "d3-force";
import { UMAP } from "umap-js";

// Dynamic import to avoid SSR issues
import dynamic from "next/dynamic";
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// Vibrant color palette for clusters
const CLUSTER_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#e11d48", // rose
];

function getClusterColor(cluster: number): string {
  return CLUSTER_COLORS[cluster % CLUSTER_COLORS.length];
}

function getEndpointId(endpoint: unknown): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (!endpoint || typeof endpoint !== "object") return null;
  const id = (endpoint as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function getEndpointName(endpoint: unknown): string | null {
  if (!endpoint || typeof endpoint !== "object") return null;
  const name = (endpoint as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function toFiniteEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const embedding = value.filter(
    (item) => typeof item === "number" && Number.isFinite(item)
  );
  return embedding.length === value.length ? embedding : null;
}

function dominantDimension(embeddings: number[][]): number | null {
  if (embeddings.length === 0) return null;
  const counts = new Map<number, number>();
  for (const embedding of embeddings) {
    counts.set(embedding.length, (counts.get(embedding.length) || 0) + 1);
  }

  let winner: number | null = null;
  let winnerCount = -1;
  for (const [dimension, count] of counts.entries()) {
    if (count > winnerCount || (count === winnerCount && dimension > (winner || 0))) {
      winner = dimension;
      winnerCount = count;
    }
  }
  return winner;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNodeAnchors(data: GraphData): {
  anchors: Map<string, { x: number; y: number }>;
  strengths: Map<string, number>;
} {
  const clusters = new Map<number, string[]>();
  for (const node of data.nodes) {
    const ids = clusters.get(node.cluster) || [];
    ids.push(node.id);
    clusters.set(node.cluster, ids);
  }

  const clusterSpecs = Array.from(clusters.entries())
    .map(([clusterId, ids]) => ({
      clusterId,
      ids,
      radius: Math.max(85, Math.sqrt(ids.length) * 52),
    }))
    .sort((a, b) => b.radius - a.radius);

  const centersByCluster = new Map<number, { x: number; y: number }>();
  const placed: Array<{ x: number; y: number; radius: number }> = [];
  const gap = 56;
  const spiralBaseRadius = 150;
  const spiralGrowthRate = 6.8;

  for (let i = 0; i < clusterSpecs.length; i++) {
    const cluster = clusterSpecs[i];
    if (i === 0) {
      centersByCluster.set(cluster.clusterId, { x: 0, y: 0 });
      placed.push({ x: 0, y: 0, radius: cluster.radius });
      continue;
    }

    let chosen = { x: 0, y: 0 };
    let found = false;

    // Spiral search for nearest non-overlapping cluster center.
    for (let attempt = 0; attempt < 1600; attempt++) {
      const theta = attempt * 0.5;
      const spiralR = spiralBaseRadius + attempt * spiralGrowthRate;
      const x = Math.cos(theta) * spiralR;
      const y = Math.sin(theta) * spiralR;

      const overlaps = placed.some((item) => {
        const dx = x - item.x;
        const dy = y - item.y;
        return Math.hypot(dx, dy) < cluster.radius + item.radius + gap;
      });

      if (!overlaps) {
        chosen = { x, y };
        found = true;
        break;
      }
    }

    if (!found) {
      chosen = { x: i * 220, y: 0 };
    }

    centersByCluster.set(cluster.clusterId, chosen);
    placed.push({ ...chosen, radius: cluster.radius });
  }

  const anchors = new Map<string, { x: number; y: number }>();
  const strengths = new Map<string, number>();

  for (const { clusterId, ids } of clusterSpecs) {
    const center = centersByCluster.get(clusterId) || { x: 0, y: 0 };
    const sortedIds = [...ids].sort();
    const clusterStrength = Math.max(
      0.12,
      Math.min(0.2, 0.12 + Math.log2(sortedIds.length + 1) * 0.015)
    );
    const nodeSpacing = 24;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Give each node a compact anchor around the cluster center.
    // This keeps same-cluster nodes together even when links are sparse.
    for (let i = 0; i < sortedIds.length; i++) {
      const id = sortedIds[i];
      let offsetX = 0;
      let offsetY = 0;

      if (i > 0) {
        const angle = i * goldenAngle;
        const radius = nodeSpacing * Math.sqrt(i);
        offsetX = Math.cos(angle) * radius;
        offsetY = Math.sin(angle) * radius;
      }

      anchors.set(id, { x: center.x + offsetX, y: center.y + offsetY });
      strengths.set(id, clusterStrength);
    }
  }

  return { anchors, strengths };
}

function buildUmapAnchors(
  data: GraphData,
  layoutSignature: string
): { anchors: Map<string, { x: number; y: number }>; strengths: Map<string, number> } | null {
  const embeddingRows = data.nodes
    .map((node) => {
      const embedding = toFiniteEmbedding(node.embedding);
      if (!embedding) return null;
      return { id: node.id, embedding };
    })
    .filter((item): item is { id: string; embedding: number[] } => Boolean(item));

  const dimension = dominantDimension(embeddingRows.map((row) => row.embedding));
  if (!dimension) return null;

  const alignedRows = embeddingRows.filter(
    (row) => row.embedding.length === dimension
  );
  if (alignedRows.length < 4) return null;

  const nNeighbors = Math.max(3, Math.min(14, alignedRows.length - 1));
  const random = createSeededRandom(hashString(layoutSignature));

  let embedding2D: number[][];
  try {
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors,
      minDist: 0.12,
      random,
    });
    embedding2D = umap.fit(alignedRows.map((row) => row.embedding));
  } catch {
    return null;
  }

  if (!Array.isArray(embedding2D) || embedding2D.length !== alignedRows.length) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of embedding2D) {
    if (!Array.isArray(point) || point.length < 2) return null;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const spread = Math.max(maxX - minX, maxY - minY, 1e-6);
  const targetSpan = Math.max(340, Math.sqrt(alignedRows.length) * 95);
  const scale = targetSpan / spread;

  const anchors = new Map<string, { x: number; y: number }>();
  const strengths = new Map<string, number>();
  for (let i = 0; i < alignedRows.length; i++) {
    const row = alignedRows[i];
    const point = embedding2D[i];
    anchors.set(row.id, {
      x: (point[0] - centerX) * scale,
      y: (point[1] - centerY) * scale,
    });
    strengths.set(row.id, 0.2);
  }

  return { anchors, strengths };
}

interface KnowledgeGraphProps {
  data: GraphData;
  selectedNodeId?: string | null;
  connectingFromName?: string | null;
  selectedLink?: Pick<GraphLinkSelection, "sourceId" | "targetId"> | null;
  linkForceScale?: number;
  fastSettle?: boolean;
  layoutMode?: GraphLayoutMode;
  fullscreen?: boolean;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  onLinkClick?: (link: GraphLinkSelection) => void;
  onBackgroundClick?: () => void;
  reservedWidth?: number;
}

export default function KnowledgeGraph({
  data,
  selectedNodeId,
  connectingFromName,
  selectedLink,
  linkForceScale = 1,
  fastSettle = false,
  layoutMode = "classic",
  fullscreen = false,
  onNodeClick,
  onLinkClick,
  onBackgroundClick,
  reservedWidth,
}: KnowledgeGraphProps) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [clusterOffsetState, setClusterOffsetState] = useState<{
    signature: string;
    offsets: Record<number, { x: number; y: number }>;
  }>({
    signature: "",
    offsets: {},
  });
  const [forcesApplied, setForcesApplied] = useState(0);
  const clusterSignature = useMemo(
    () =>
      `${layoutMode}|` +
      data.nodes
        .map(
          (node) =>
            `${node.id}:${node.cluster}:${Array.isArray(node.embedding) ? node.embedding.length : 0}`
        )
        .sort()
        .join("|"),
    [data.nodes, layoutMode]
  );
  const clusterOffsets = useMemo(
    () =>
      clusterOffsetState.signature === clusterSignature
        ? clusterOffsetState.offsets
        : {},
    [clusterOffsetState, clusterSignature]
  );
  const nodeAnchorLayout = useMemo(() => {
    const classicLayout = buildNodeAnchors(data);
    const umapLayout =
      layoutMode === "umap" ? buildUmapAnchors(data, clusterSignature) : null;
    const hasOffsets = Object.keys(clusterOffsets).length > 0;
    const anchors = new Map<string, { x: number; y: number }>();
    const strengths = new Map<string, number>();

    for (const node of data.nodes) {
      const base =
        umapLayout?.anchors.get(node.id) ||
        classicLayout.anchors.get(node.id) || { x: 0, y: 0 };
      const strength =
        umapLayout?.strengths.get(node.id) ||
        classicLayout.strengths.get(node.id) ||
        0.1;
      const offset = hasOffsets ? clusterOffsets[node.cluster] : null;

      anchors.set(node.id, {
        x: base.x + (offset?.x || 0),
        y: base.y + (offset?.y || 0),
      });
      strengths.set(node.id, strength);
    }

    return { anchors, strengths };
  }, [data, clusterOffsets, layoutMode, clusterSignature]);
  const safeLinkForceScale = Math.max(0.1, Math.min(4, linkForceScale));
  const alphaDecay = fastSettle ? 0.035 : 0.01;
  const velocityDecay = fastSettle ? 0.5 : 0.3;
  const cooldownTicks = fastSettle ? 120 : undefined;
  const nodeClusterMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of data.nodes) {
      map.set(node.id, node.cluster);
    }
    return map;
  }, [data.nodes]);

  // Apply forces — retry until the ref is populated (dynamic import delay)
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }

    fg.d3Force("charge", d3.forceManyBody().strength(-320).distanceMax(550));
    fg.d3Force("collision", d3.forceCollide(34).strength(1).iterations(2));
    fg.d3Force("center", d3.forceCenter(0, 0).strength(0.015));

    // Pull nodes toward their cluster anchor so bridged mega-components stay readable.
    fg.d3Force(
      "x",
      d3
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .forceX((node: any) => nodeAnchorLayout.anchors.get(node.id)?.x ?? 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .strength((node: any) => nodeAnchorLayout.strengths.get(node.id) ?? 0.09)
    );
    fg.d3Force(
      "y",
      d3
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .forceY((node: any) => nodeAnchorLayout.anchors.get(node.id)?.y ?? 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .strength((node: any) => nodeAnchorLayout.strengths.get(node.id) ?? 0.09)
    );

    const linkForce = fg.d3Force("link");
    if (linkForce) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkForce.distance((link: any) => {
        const sim = link.similarity || 0.3;
        return 300 - sim * 210;
      });
      // Weaker low-similarity edges reduce large-cluster tangling.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkForce.strength((link: any) => {
        const sim = link.similarity || 0.3;
        return (0.12 + sim * 0.45) * safeLinkForceScale;
      });
    }

    fg.d3ReheatSimulation();
  }, [data, forcesApplied, nodeAnchorLayout, safeLinkForceScale]);

  useEffect(() => {
    function handleResize() {
      const sidebar = fullscreen ? 0 : reservedWidth ?? 0;
      const containerWidth =
        containerRef.current?.clientWidth ??
        Math.min(window.innerWidth - 32, 1800);
      const containerHeight = fullscreen
        ? window.innerHeight - 24
        : window.innerHeight - 200;

      setDimensions({
        width: Math.max(containerWidth - sidebar, 320),
        height: fullscreen
          ? Math.max(containerHeight, 320)
          : Math.max(containerHeight, 560),
      });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [reservedWidth, fullscreen]);

  // Build a quick lookup: nodeId -> cluster color
  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of data.nodes) {
      map.set(node.id, getClusterColor(node.cluster));
    }
    return map;
  }, [data.nodes]);

  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of data.nodes) {
      map.set(node.id, node.name);
    }
    return map;
  }, [data.nodes]);

  // When a node is selected, find all nodes connected to it in the current graph.
  // Everything outside this component gets dimmed and desaturated.
  const focusedComponent = useMemo(() => {
    if (!selectedNodeId) return null;

    const adjacency = new Map<string, Set<string>>();
    for (const node of data.nodes) {
      adjacency.set(node.id, new Set());
    }
    for (const link of data.links) {
      // react-force-graph mutates links and may replace endpoint ids with node objects
      const sourceId = getEndpointId(link.source);
      const targetId = getEndpointId(link.target);
      if (!sourceId || !targetId) continue;

      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);
    }

    const visited = new Set<string>();
    const queue = [selectedNodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    // Keep the selected node in focus even if it has no edges.
    if (visited.size === 0) {
      visited.add(selectedNodeId);
    }

    return visited;
  }, [data.links, data.nodes, selectedNodeId]);

  const hasFocus = Boolean(selectedNodeId && focusedComponent);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const label = node.name || "";
    const isSelected = node.id === selectedNodeId;
    const isConnectSource = connectingFromName === node.name;
    const inConnectMode = !!connectingFromName;
    const inFocusedComponent = !hasFocus || focusedComponent?.has(node.id);
    const color = nodeColorMap.get(node.id) || "#3b82f6";
    const x = node.x || 0;
    const y = node.y || 0;

    let radius = 5;
    let nodeColor = color;
    let glowColor = color;
    let nodeAlpha = 1;
    let labelColor = "#d1d5db";
    let labelAlpha = 1;

    if (!inFocusedComponent) {
      radius = 4;
      nodeColor = "#9ca3af";
      glowColor = "#9ca3af";
      nodeAlpha = 0.3;
      labelColor = "#9ca3af";
      labelAlpha = 0.35;
    }

    if (inFocusedComponent && isConnectSource) {
      // Source node — purple with strong glow
      radius = 9;
      nodeColor = "#a855f7";
      glowColor = "#a855f7";
      labelColor = "#c084fc";
    } else if (inFocusedComponent && isSelected) {
      radius = 8;
      labelColor = "#ffffff";
    } else if (inFocusedComponent && inConnectMode) {
      // Other nodes in connect mode — slightly brighter to invite clicking
      radius = 6;
    }

    // Glow effect
    ctx.save();
    ctx.globalAlpha = nodeAlpha;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = !inFocusedComponent ? 0 : isConnectSource ? 25 : isSelected ? 20 : 10;

    // Draw node circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = nodeColor;
    ctx.fill();

    if (inFocusedComponent && isConnectSource) {
      // Pulsing ring for connect source
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (inFocusedComponent && isSelected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();

    // Draw label with subtle shadow for readability
    ctx.save();
    ctx.font = isConnectSource ? "bold 10px Inter, sans-serif" : "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.globalAlpha = labelAlpha;
    ctx.fillStyle = labelColor;
    ctx.fillText(label, x, y + 14);
    ctx.restore();
  }, [selectedNodeId, connectingFromName, hasFocus, focusedComponent, nodeColorMap]);

  // Link canvas — color based on connected node clusters, opacity from similarity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const source = link.source;
    const target = link.target;
    if (!source || !target) return;

    const sx = source.x || 0;
    const sy = source.y || 0;
    const tx = target.x || 0;
    const ty = target.y || 0;

    const sourceId = getEndpointId(source);
    const targetId = getEndpointId(target);
    if (!sourceId || !targetId) return;

    const normalizedSelected = selectedLink
      ? [selectedLink.sourceId, selectedLink.targetId].sort().join("::")
      : null;
    const normalizedCurrent = [sourceId, targetId].sort().join("::");
    const isSelectedLink =
      normalizedSelected !== null && normalizedCurrent === normalizedSelected;

    const inFocusedComponent =
      !hasFocus ||
      (focusedComponent?.has(sourceId) && focusedComponent?.has(targetId));

    const sourceColor = nodeColorMap.get(sourceId) || "#3b82f6";
    const targetColor = nodeColorMap.get(targetId) || "#3b82f6";
    const similarity = link.similarity || 0.3;
    const alpha = isSelectedLink
      ? 0.95
      : inFocusedComponent
        ? 0.15 + similarity * 0.4 // 0.15 - 0.55 opacity
        : 0.07;

    let stroke: CanvasGradient | string;
    if (inFocusedComponent) {
      // Gradient link between the two node colors
      const gradient = ctx.createLinearGradient(sx, sy, tx, ty);
      gradient.addColorStop(0, sourceColor);
      gradient.addColorStop(1, targetColor);
      stroke = gradient;
    } else {
      stroke = "#9ca3af";
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = isSelectedLink
      ? 4
      : inFocusedComponent
        ? 1 + similarity * 2
        : 1;
    if (isSelectedLink) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }, [hasFocus, focusedComponent, nodeColorMap, selectedLink]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback((node: any) => {
    if (onNodeClick && node.id && node.name) {
      onNodeClick(node.id, node.name);
    }
  }, [onNodeClick]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeDragEnd = useCallback((node: any) => {
    const nodeId = typeof node?.id === "string" ? node.id : null;
    if (!nodeId) return;

    const clusterId = nodeClusterMap.get(nodeId);
    if (clusterId === undefined) return;

    const anchor = nodeAnchorLayout.anchors.get(nodeId);
    const nodeX = typeof node?.x === "number" ? node.x : null;
    const nodeY = typeof node?.y === "number" ? node.y : null;
    if (!anchor || nodeX === null || nodeY === null) return;

    const deltaX = nodeX - anchor.x;
    const deltaY = nodeY - anchor.y;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

    setClusterOffsetState((prev) => {
      const activeOffsets =
        prev.signature === clusterSignature ? prev.offsets : {};
      const current = activeOffsets[clusterId] || { x: 0, y: 0 };
      return {
        signature: clusterSignature,
        offsets: {
          ...activeOffsets,
          [clusterId]: {
            x: current.x + deltaX,
            y: current.y + deltaY,
          },
        },
      };
    });

    if (typeof node === "object" && node) {
      node.fx = undefined;
      node.fy = undefined;
    }
  }, [nodeAnchorLayout.anchors, nodeClusterMap, clusterSignature]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLinkClick = useCallback((link: any) => {
    if (!onLinkClick) return;
    const sourceId = getEndpointId(link?.source);
    const targetId = getEndpointId(link?.target);
    if (!sourceId || !targetId) return;

    const sourceName =
      getEndpointName(link?.source) || nodeNameMap.get(sourceId) || sourceId;
    const targetName =
      getEndpointName(link?.target) || nodeNameMap.get(targetId) || targetId;
    const similarity =
      typeof link?.similarity === "number" && Number.isFinite(link.similarity)
        ? link.similarity
        : 0;

    onLinkClick({
      sourceId,
      sourceName,
      targetId,
      targetName,
      similarity,
    });
  }, [onLinkClick, nodeNameMap]);

  const handleBackgroundClick = useCallback(() => {
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center border border-gray-800 rounded-lg bg-gray-950/50" style={{ height: "500px" }}>
        <p className="text-gray-500">
          Add some interests to see your knowledge graph
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="border border-gray-800 rounded-lg overflow-hidden"
      style={{ background: "radial-gradient(ellipse at center, #0f172a 0%, #030712 100%)" }}
    >
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        onNodeClick={handleNodeClick}
        onNodeDragEnd={handleNodeDragEnd}
        onLinkClick={handleLinkClick}
        onBackgroundClick={handleBackgroundClick}
        backgroundColor="rgba(0,0,0,0)"
        d3AlphaDecay={alphaDecay}
        d3VelocityDecay={velocityDecay}
        cooldownTicks={cooldownTicks}
      />
    </div>
  );
}
