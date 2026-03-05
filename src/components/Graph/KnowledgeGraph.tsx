"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GraphData,
  GraphLayoutMode,
  GraphLinkSelection,
  GraphRenderMode,
} from "@/lib/types";
import * as d3 from "d3-force";
import * as THREE from "three";
import { UMAP } from "umap-js";

// Dynamic import to avoid SSR issues
import dynamic from "next/dynamic";
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
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

const CLUSTER_NODE_PREFIX = "__cluster__:";
const CLUSTER_DOUBLE_CLICK_WINDOW_MS = 320;
const NODE_RADIUS_SCALE = 2;
const COLLISION_RADIUS_2D = 72;
const COLLISION_RADIUS_3D = 60;
const CHARGE_STRENGTH_2D = -240;
const CHARGE_STRENGTH_3D = -190;
const ANCHOR_FORCE_SCALE_2D = 0.48;
const ANCHOR_FORCE_SCALE_3D_XY = 0.24;
const ANCHOR_FORCE_SCALE_3D_Z = 0.28;
const SPAWN_Z_JITTER = 56;
const UMAP_3D_MIN_DEPTH = 280;
const UMAP_3D_DEPTH_PER_NODE = 88;
const UMAP_3D_Z_SCALE_MIN_RATIO = 0.9;
const UMAP_3D_Z_SCALE_MAX_RATIO = 2.35;
const UMAP_3D_AXIS_SCALE_MIN_RATIO = 0.78;
const UMAP_3D_AXIS_SCALE_MAX_RATIO = 2.45;
const UMAP_3D_ANCHOR_JITTER = 9;
const LINK_FORCE_OFFSET = 0.04;
const LINK_FORCE_SIM_SCALE = 0.17;
const LINK_FORCE_GLOBAL_SCALE = 0.45;
const HUB_DAMPING_EXPONENT = 0.62;
const HUB_DAMPING_MIN = 0.12;
const NODE_HITBOX_PADDING = 8;
const THREE_FOG_DENSITY = 0.00032;
const THREE_AUTO_ROTATE_SPEED = 1.2;
const THREE_LAYOUT_STORAGE_PREFIX = "km:3d-layout:v1:";
const THREE_LAYOUT_SIGNATURE_VERSION = "r3d-v2";
const CLUSTER_LABEL_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "those",
  "these",
  "about",
  "over",
  "under",
  "between",
  "through",
  "across",
  "using",
  "use",
  "based",
  "study",
  "studies",
  "analysis",
  "approach",
  "methods",
  "method",
  "systems",
  "system",
  "introduction",
  "advanced",
  "foundations",
  "fundamentals",
]);

function clusterNodeId(clusterId: number): string {
  return `${CLUSTER_NODE_PREFIX}${clusterId}`;
}

function isClusterNodeId(nodeId: string): boolean {
  return nodeId.startsWith(CLUSTER_NODE_PREFIX);
}

function getClusterColor(cluster: number): string {
  return CLUSTER_COLORS[cluster % CLUSTER_COLORS.length];
}

function collectClusterLabelTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !CLUSTER_LABEL_STOP_WORDS.has(token) &&
        !/^\d+$/.test(token)
    );
}

function titleCaseToken(token: string): string {
  if (token.length === 0) return token;
  return `${token[0].toUpperCase()}${token.slice(1)}`;
}

function truncateLabel(label: string, maxLength = 38): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildClusterSemanticLabel(clusterNodes: Array<{ name: string }>): string {
  if (clusterNodes.length === 0) return "Cluster";
  if (clusterNodes.length === 1) {
    return truncateLabel(clusterNodes[0].name.trim() || "Cluster");
  }

  const tokenFrequency = new Map<string, number>();
  for (const node of clusterNodes) {
    const uniqueTokens = new Set(collectClusterLabelTokens(node.name));
    for (const token of uniqueTokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
    }
  }

  if (tokenFrequency.size > 0) {
    const sortedTokens = Array.from(tokenFrequency.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      if (b[0].length !== a[0].length) return b[0].length - a[0].length;
      return a[0].localeCompare(b[0]);
    });

    const tokenThreshold = Math.max(2, Math.ceil(clusterNodes.length * 0.25));
    const strongTokens = sortedTokens
      .filter(([, count]) => count >= tokenThreshold)
      .slice(0, 2);
    const pickedTokens = (strongTokens.length > 0 ? strongTokens : sortedTokens)
      .slice(0, 2)
      .map(([token]) => titleCaseToken(token));

    if (pickedTokens.length > 0) {
      return truncateLabel(pickedTokens.join(" / "));
    }
  }

  const exemplars = [...clusterNodes]
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 2);

  if (exemplars.length === 0) return "Cluster";
  return truncateLabel(exemplars.join(" + "));
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

function normalizeLinkKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const safeHex = hex.replace("#", "");
  if (safeHex.length !== 6) {
    return `rgba(156, 163, 175, ${alpha})`;
  }
  const r = parseInt(safeHex.slice(0, 2), 16);
  const g = parseInt(safeHex.slice(2, 4), 16);
  const b = parseInt(safeHex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return `rgba(156, 163, 175, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveNodeRadius(params: {
  isSuperNode: boolean;
  memberCount: number | null;
  inFocusedComponent: boolean;
  isConnectSource: boolean;
  isSelected: boolean;
  inConnectMode: boolean;
}): number {
  const {
    isSuperNode,
    memberCount,
    inFocusedComponent,
    isConnectSource,
    isSelected,
    inConnectMode,
  } = params;
  const superNodeSize =
    (memberCount !== null
      ? Math.max(10, Math.min(26, 10 + Math.sqrt(memberCount) * 2.6))
      : 14) * NODE_RADIUS_SCALE;

  let radius = isSuperNode ? superNodeSize : 6.5 * NODE_RADIUS_SCALE;

  if (!inFocusedComponent) {
    radius = isSuperNode
      ? Math.max(8.5 * NODE_RADIUS_SCALE, superNodeSize - 1.5 * NODE_RADIUS_SCALE)
      : 5 * NODE_RADIUS_SCALE;
  }

  if (inFocusedComponent && isConnectSource) {
    radius = 10 * NODE_RADIUS_SCALE;
  } else if (inFocusedComponent && isSelected && !isSuperNode) {
    radius = 9.5 * NODE_RADIUS_SCALE;
  } else if (inFocusedComponent && inConnectMode && !isSuperNode) {
    radius = 7.5 * NODE_RADIUS_SCALE;
  }

  return radius;
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

type NodeAnchor = { x: number; y: number; z: number };
type CameraPreset = "perspective" | "top" | "side";
type Persisted3DLayout = {
  signature: string;
  positions: Record<string, { x: number; y: number; z: number }>;
};

function buildNodeAnchors(data: GraphData): {
  anchors: Map<string, NodeAnchor>;
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

  const anchors = new Map<string, NodeAnchor>();
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

      anchors.set(id, { x: center.x + offsetX, y: center.y + offsetY, z: 0 });
      strengths.set(id, clusterStrength);
    }
  }

  return { anchors, strengths };
}

function buildUmapAnchors(
  data: GraphData,
  layoutSignature: string,
  nComponents: 2 | 3
): { anchors: Map<string, NodeAnchor>; strengths: Map<string, number> } | null {
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

  let projection: number[][];
  try {
    const umap = new UMAP({
      nComponents,
      nNeighbors,
      minDist: 0.12,
      random,
    });
    projection = umap.fit(alignedRows.map((row) => row.embedding));
  } catch {
    return null;
  }

  if (!Array.isArray(projection) || projection.length !== alignedRows.length) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of projection) {
    if (!Array.isArray(point) || point.length < 2) return null;
    if (nComponents === 3 && point.length < 3) return null;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
    const z = nComponents === 3 ? point[2] : 0;
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const spreadX = Math.max(maxX - minX, 1e-6);
  const spreadY = Math.max(maxY - minY, 1e-6);
  const spreadZ = Math.max(maxZ - minZ, 1e-6);
  const spread = Math.max(spreadX, spreadY, spreadZ, 1e-6);
  const targetSpan = Math.max(340, Math.sqrt(alignedRows.length) * 95);
  const scale = targetSpan / spread;
  const baseXYScale = targetSpan / Math.max(spreadX, spreadY, 1e-6);
  const minAxisScale = scale * UMAP_3D_AXIS_SCALE_MIN_RATIO;
  const maxAxisScale = scale * UMAP_3D_AXIS_SCALE_MAX_RATIO;
  const xScale =
    nComponents === 3
      ? Math.max(minAxisScale, Math.min(maxAxisScale, targetSpan / spreadX))
      : scale;
  const yScale =
    nComponents === 3
      ? Math.max(minAxisScale, Math.min(maxAxisScale, targetSpan / spreadY))
      : scale;
  const targetDepth =
    nComponents === 3
      ? Math.max(UMAP_3D_MIN_DEPTH, Math.sqrt(alignedRows.length) * UMAP_3D_DEPTH_PER_NODE)
      : targetSpan;
  const rawZScale = targetDepth / spreadZ;
  const minZScale = baseXYScale * UMAP_3D_Z_SCALE_MIN_RATIO;
  const maxZScale = baseXYScale * UMAP_3D_Z_SCALE_MAX_RATIO;
  const zScale =
    nComponents === 3
      ? Math.max(minZScale, Math.min(maxZScale, rawZScale))
      : scale;

  const anchors = new Map<string, NodeAnchor>();
  const strengths = new Map<string, number>();
  for (let i = 0; i < alignedRows.length; i++) {
    const row = alignedRows[i];
    const point = projection[i];
    const jitterSeed = hashString(`${layoutSignature}|${row.id}|3d-anchor`);
    const jitterNorm = (jitterSeed % 1000) / 999;
    const jitter = (jitterNorm * 2 - 1) * UMAP_3D_ANCHOR_JITTER;
    const scaledZ = ((nComponents === 3 ? point[2] : 0) - centerZ) * zScale;
    anchors.set(row.id, {
      x: (point[0] - centerX) * xScale + (nComponents === 3 ? jitter : 0),
      y: (point[1] - centerY) * yScale - (nComponents === 3 ? jitter * 0.6 : 0),
      z: scaledZ + (nComponents === 3 ? jitter * 0.9 : 0),
    });
    strengths.set(row.id, nComponents === 3 ? 0.16 : 0.2);
  }

  return { anchors, strengths };
}

function dotProduct(a: number[], b: number[]): number {
  let total = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    total += a[i] * b[i];
  }
  return total;
}

function orthogonalizeInPlace(vector: number[], basis: number[][]): void {
  for (const base of basis) {
    const projection = dotProduct(vector, base);
    if (Math.abs(projection) <= 1e-12) continue;
    for (let i = 0; i < vector.length; i++) {
      vector[i] -= projection * base[i];
    }
  }
}

function normalizeInPlace(vector: number[]): number {
  let normSq = 0;
  for (let i = 0; i < vector.length; i++) {
    normSq += vector[i] * vector[i];
  }
  if (normSq <= 1e-20) return 0;
  const norm = Math.sqrt(normSq);
  const invNorm = 1 / norm;
  for (let i = 0; i < vector.length; i++) {
    vector[i] *= invNorm;
  }
  return norm;
}

function buildPcaAnchors(
  data: GraphData,
  layoutSignature: string,
  nComponents: 2 | 3
): { anchors: Map<string, NodeAnchor>; strengths: Map<string, number> } | null {
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
  if (alignedRows.length < Math.max(4, nComponents + 1)) return null;

  const means = new Array(dimension).fill(0);
  for (const row of alignedRows) {
    for (let i = 0; i < dimension; i++) {
      means[i] += row.embedding[i];
    }
  }
  for (let i = 0; i < dimension; i++) {
    means[i] /= alignedRows.length;
  }

  const centeredRows: number[][] = [];
  let centeredEnergy = 0;
  for (const row of alignedRows) {
    const centered = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      const value = row.embedding[i] - means[i];
      centered[i] = value;
      centeredEnergy += Math.abs(value);
    }
    centeredRows.push(centered);
  }
  if (centeredEnergy <= 1e-8) return null;

  const random = createSeededRandom(hashString(`${layoutSignature}|pca|${nComponents}`));
  const basis: number[][] = [];
  const maxIterations = 28;

  for (let component = 0; component < nComponents; component++) {
    let vector = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      vector[i] = random() * 2 - 1;
    }
    orthogonalizeInPlace(vector, basis);
    if (normalizeInPlace(vector) === 0) break;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const next = new Array(dimension).fill(0);
      for (const row of centeredRows) {
        const rowProjection = dotProduct(row, vector);
        if (Math.abs(rowProjection) <= 1e-14) continue;
        for (let i = 0; i < dimension; i++) {
          next[i] += row[i] * rowProjection;
        }
      }
      orthogonalizeInPlace(next, basis);
      if (normalizeInPlace(next) === 0) break;
      vector = next;
    }

    if (normalizeInPlace(vector) === 0) break;
    basis.push(vector);
  }

  if (basis.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const projected = alignedRows.map((row, rowIndex) => {
    const values = centeredRows[rowIndex] || new Array(dimension).fill(0);
    const x = basis[0] ? dotProduct(values, basis[0]) : 0;
    const y = basis[1] ? dotProduct(values, basis[1]) : 0;
    const z = nComponents === 3 && basis[2] ? dotProduct(values, basis[2]) : 0;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    return { id: row.id, x, y, z };
  });

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const spreadX = Math.max(maxX - minX, 1e-6);
  const spreadY = Math.max(maxY - minY, 1e-6);
  const spreadZ = Math.max(maxZ - minZ, 1e-6);
  const spread = Math.max(spreadX, spreadY, spreadZ, 1e-6);
  const targetSpan = Math.max(340, Math.sqrt(alignedRows.length) * 95);
  const scale = targetSpan / spread;
  const baseXYScale = targetSpan / Math.max(spreadX, spreadY, 1e-6);
  const minAxisScale = scale * UMAP_3D_AXIS_SCALE_MIN_RATIO;
  const maxAxisScale = scale * UMAP_3D_AXIS_SCALE_MAX_RATIO;
  const xScale =
    nComponents === 3
      ? Math.max(minAxisScale, Math.min(maxAxisScale, targetSpan / spreadX))
      : scale;
  const yScale =
    nComponents === 3
      ? Math.max(minAxisScale, Math.min(maxAxisScale, targetSpan / spreadY))
      : scale;
  const targetDepth =
    nComponents === 3
      ? Math.max(UMAP_3D_MIN_DEPTH, Math.sqrt(alignedRows.length) * UMAP_3D_DEPTH_PER_NODE)
      : targetSpan;
  const rawZScale = targetDepth / spreadZ;
  const minZScale = baseXYScale * UMAP_3D_Z_SCALE_MIN_RATIO;
  const maxZScale = baseXYScale * UMAP_3D_Z_SCALE_MAX_RATIO;
  const zScale =
    nComponents === 3
      ? Math.max(minZScale, Math.min(maxZScale, rawZScale))
      : scale;

  const anchors = new Map<string, NodeAnchor>();
  const strengths = new Map<string, number>();
  for (const point of projected) {
    const jitterSeed = hashString(`${layoutSignature}|${point.id}|pca-anchor`);
    const jitterNorm = (jitterSeed % 1000) / 999;
    const jitter = (jitterNorm * 2 - 1) * (UMAP_3D_ANCHOR_JITTER * 0.7);
    anchors.set(point.id, {
      x: (point.x - centerX) * xScale + (nComponents === 3 ? jitter : 0),
      y: (point.y - centerY) * yScale - (nComponents === 3 ? jitter * 0.5 : 0),
      z: (point.z - centerZ) * zScale + (nComponents === 3 ? jitter * 0.8 : 0),
    });
    strengths.set(point.id, nComponents === 3 ? 0.15 : 0.2);
  }

  return { anchors, strengths };
}

function createAnchorForceZ(params: {
  anchors: Map<string, NodeAnchor>;
  strengths: Map<string, number>;
  scale: number;
}) {
  const { anchors, strengths, scale } = params;
  let nodes: Array<
    d3.SimulationNodeDatum & { id?: unknown; z?: number; vz?: number }
  > = [];

  const force = (alpha: number) => {
    for (const node of nodes) {
      const rawId = node.id;
      const nodeId = typeof rawId === "string" ? rawId : "";
      const targetZ = anchors.get(nodeId)?.z ?? 0;
      const currentZ = typeof node.z === "number" ? node.z : 0;
      const strength = Math.max(0, (strengths.get(nodeId) ?? 0.08) * scale);
      const vz = typeof node.vz === "number" ? node.vz : 0;
      node.vz = vz + (targetZ - currentZ) * strength * alpha;
    }
  };

  force.initialize = (
    initialNodes: Array<
      d3.SimulationNodeDatum & { id?: unknown; z?: number; vz?: number }
    >
  ) => {
    nodes = initialNodes;
  };

  return force;
}

type DisplayNode = GraphData["nodes"][number] & {
  isSuperNode?: boolean;
  memberCount?: number;
};

type DisplayLink = GraphData["links"][number] & {
  isAggregate?: boolean;
  aggregateCount?: number;
};
type PointerNode = {
  id?: unknown;
  name?: unknown;
  isSuperNode?: unknown;
  memberCount?: unknown;
  x?: unknown;
  y?: unknown;
};
type LabelTextureEntry = {
  texture: THREE.CanvasTexture;
  aspect: number;
};
type Node3DVisualState = {
  nodeId: string;
  radius: number;
  displayColor: string;
  alpha: number;
  glowOpacity: number;
  labelColor: string;
  labelOpacity: number;
  label: string;
  isSuperNode: boolean;
  inFocusedComponent: boolean;
};
type Node3DCacheEntry = {
  group: THREE.Group;
  glowSprite: THREE.Sprite;
  glowMaterial: THREE.SpriteMaterial;
  coreMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  coreMaterial: THREE.MeshStandardMaterial;
  rimMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  rimMaterial: THREE.MeshBasicMaterial;
  labelSprite: THREE.Sprite | null;
  labelMaterial: THREE.SpriteMaterial | null;
  labelKey: string | null;
};

function disposeNode3DCacheEntry(entry: Node3DCacheEntry): void {
  if (entry.labelSprite) {
    entry.group.remove(entry.labelSprite);
  }
  if (entry.labelMaterial) {
    entry.labelMaterial.dispose();
  }
  entry.group.remove(entry.glowSprite);
  entry.group.remove(entry.coreMesh);
  entry.group.remove(entry.rimMesh);
  entry.glowMaterial.dispose();
  entry.coreMaterial.dispose();
  entry.rimMaterial.dispose();
}

interface KnowledgeGraphProps {
  data: GraphData;
  selectedNodeId?: string | null;
  focusNodeRequest?: { nodeId: string; token: number } | null;
  connectingFromName?: string | null;
  selectedLink?: Pick<GraphLinkSelection, "sourceId" | "targetId"> | null;
  linkForceScale?: number;
  renderLinkTopK?: number;
  fastSettle?: boolean;
  layoutMode?: GraphLayoutMode;
  renderMode?: GraphRenderMode;
  fullscreen?: boolean;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  onLinkClick?: (link: GraphLinkSelection) => void;
  onBackgroundClick?: () => void;
  reservedWidth?: number;
  clusterOverviewEnabled?: boolean;
  onClusterOverviewEnabledChange?: (enabled: boolean) => void;
  focusedClusterId?: number | null;
  onFocusedClusterIdChange?: (clusterId: number | null) => void;
  showClusterToggleButton?: boolean;
  threeDLayoutPersistenceKey?: string | null;
}

export default function KnowledgeGraph({
  data,
  selectedNodeId,
  focusNodeRequest = null,
  connectingFromName,
  selectedLink,
  linkForceScale = 1,
  renderLinkTopK = 0,
  fastSettle = false,
  layoutMode = "classic",
  renderMode = "2d",
  fullscreen = false,
  onNodeClick,
  onLinkClick,
  onBackgroundClick,
  reservedWidth,
  clusterOverviewEnabled: clusterOverviewEnabledProp,
  onClusterOverviewEnabledChange,
  focusedClusterId: focusedClusterIdProp,
  onFocusedClusterIdChange,
  showClusterToggleButton = true,
  threeDLayoutPersistenceKey = null,
}: KnowledgeGraphProps) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastClusterClickRef = useRef<{ nodeId: string; at: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph2DRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph3DRef = useRef<any>(null);
  const sphereGeometryCacheRef = useRef<Map<number, THREE.SphereGeometry>>(new Map());
  const labelTextureCacheRef = useRef<Map<string, LabelTextureEntry>>(new Map());
  const node3DCacheRef = useRef<Map<string, Node3DCacheEntry>>(new Map());
  const [clusterOffsetState, setClusterOffsetState] = useState<{
    signature: string;
    offsets: Record<number, { x: number; y: number }>;
  }>({
    signature: "",
    offsets: {},
  });
  const [forcesApplied, setForcesApplied] = useState(0);
  const [armed3DForKey, setArmed3DForKey] = useState("");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
  const [autoOrbit, setAutoOrbit] = useState(false);
  const autoOrbitRef = useRef(autoOrbit);
  const renderModeRef = useRef<GraphRenderMode>(renderMode);
  const last3DControlSyncAtRef = useRef(0);
  const lastFocusTokenRef = useRef<number | null>(null);
  const lastSearchFocusAtRef = useRef(0);
  const glowTexture = useMemo(() => {
    if (typeof document === "undefined") {
      return new THREE.Texture();
    }
    const canvas = document.createElement("canvas");
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        size * 0.08,
        size / 2,
        size / 2,
        size * 0.5
      );
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.28, "rgba(255,255,255,0.7)");
      gradient.addColorStop(0.62, "rgba(255,255,255,0.2)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }, []);
  const persisted3DLayoutRef = useRef<Persisted3DLayout | null>(null);
  const [internalClusterOverviewEnabled, setInternalClusterOverviewEnabled] =
    useState(false);
  const [internalFocusedClusterId, setInternalFocusedClusterId] = useState<
    number | null
  >(null);
  const clusterOverviewEnabled =
    clusterOverviewEnabledProp ?? internalClusterOverviewEnabled;
  const focusedClusterId =
    focusedClusterIdProp !== undefined
      ? focusedClusterIdProp
      : internalFocusedClusterId;
  const updateClusterOverviewEnabled = useCallback(
    (next: boolean) => {
      if (clusterOverviewEnabledProp === undefined) {
        setInternalClusterOverviewEnabled(next);
      }
      onClusterOverviewEnabledChange?.(next);
    },
    [clusterOverviewEnabledProp, onClusterOverviewEnabledChange]
  );
  const updateFocusedClusterId = useCallback(
    (next: number | null) => {
      if (focusedClusterIdProp === undefined) {
        setInternalFocusedClusterId(next);
      }
      onFocusedClusterIdChange?.(next);
    },
    [focusedClusterIdProp, onFocusedClusterIdChange]
  );
  const handleToggleClusterOverview = useCallback(() => {
    updateFocusedClusterId(null);
    updateClusterOverviewEnabled(!clusterOverviewEnabled);
  }, [clusterOverviewEnabled, updateClusterOverviewEnabled, updateFocusedClusterId]);
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
  const threeDStorageKey = useMemo(() => {
    if (!threeDLayoutPersistenceKey) return null;
    return `${THREE_LAYOUT_STORAGE_PREFIX}${threeDLayoutPersistenceKey}`;
  }, [threeDLayoutPersistenceKey]);
  useEffect(() => {
    if (!threeDStorageKey || typeof window === "undefined") {
      persisted3DLayoutRef.current = null;
      return;
    }
    try {
      const raw = localStorage.getItem(threeDStorageKey);
      if (!raw) {
        persisted3DLayoutRef.current = null;
        return;
      }
      const parsed = JSON.parse(raw) as Persisted3DLayout;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.signature !== "string" ||
        !parsed.positions ||
        typeof parsed.positions !== "object"
      ) {
        persisted3DLayoutRef.current = null;
        return;
      }
      persisted3DLayoutRef.current = parsed;
    } catch {
      persisted3DLayoutRef.current = null;
    }
  }, [threeDStorageKey]);
  useEffect(() => {
    return () => {
      glowTexture.dispose();
    };
  }, [glowTexture]);
  useEffect(() => {
    const sphereCache = sphereGeometryCacheRef.current;
    const labelCache = labelTextureCacheRef.current;
    const node3DCache = node3DCacheRef.current;
    return () => {
      for (const entry of node3DCache.values()) {
        disposeNode3DCacheEntry(entry);
      }
      node3DCache.clear();
      for (const geometry of sphereCache.values()) {
        geometry.dispose();
      }
      sphereCache.clear();
      for (const entry of labelCache.values()) {
        entry.texture.dispose();
      }
      labelCache.clear();
    };
  }, []);
  const clusterNodeMap = useMemo(() => {
    const map = new Map<number, DisplayNode[]>();
    for (const node of data.nodes) {
      const nodes = map.get(node.cluster) || [];
      nodes.push(node);
      map.set(node.cluster, nodes);
    }
    return map;
  }, [data.nodes]);
  const selectedClusterId = useMemo(() => {
    if (!selectedNodeId) return null;
    const selected = data.nodes.find((node) => node.id === selectedNodeId);
    return selected ? selected.cluster : null;
  }, [data.nodes, selectedNodeId]);
  const activeFocusedClusterId = useMemo(
    () =>
      clusterOverviewEnabled &&
      focusedClusterId !== null &&
      clusterNodeMap.has(focusedClusterId)
        ? focusedClusterId
        : null,
    [clusterNodeMap, clusterOverviewEnabled, focusedClusterId]
  );
  const effectiveExpandedClusters = useMemo(() => {
    if (!clusterOverviewEnabled) return new Set<number>();

    const validClusters = new Set<number>(Array.from(clusterNodeMap.keys()));
    const next = new Set<number>();
    if (selectedClusterId !== null && validClusters.has(selectedClusterId)) {
      next.add(selectedClusterId);
    }
    return next;
  }, [clusterNodeMap, clusterOverviewEnabled, selectedClusterId]);

  const baseDisplayData = useMemo<{
    nodes: DisplayNode[];
    links: DisplayLink[];
  }>(() => {
    return {
      nodes: data.nodes,
      links: data.links,
    };
  }, [data.links, data.nodes]);

  const clusterOverviewDisplayData = useMemo<{
    nodes: DisplayNode[];
    links: DisplayLink[];
  } | null>(() => {
    if (!clusterOverviewEnabled) return null;

    if (activeFocusedClusterId !== null) {
      const focusedNodes = clusterNodeMap.get(activeFocusedClusterId) || [];
      const focusedNodeIdSet = new Set(focusedNodes.map((node) => node.id));
      const focusedLinks: DisplayLink[] = [];

      for (const link of data.links) {
        const sourceId = getEndpointId(link.source);
        const targetId = getEndpointId(link.target);
        if (!sourceId || !targetId) continue;
        if (!focusedNodeIdSet.has(sourceId) || !focusedNodeIdSet.has(targetId)) {
          continue;
        }
        focusedLinks.push(link);
      }

      return {
        nodes: focusedNodes,
        links: focusedLinks,
      };
    }

    const nodeById = new Map<string, DisplayNode>();
    for (const node of data.nodes) {
      nodeById.set(node.id, node);
    }

    const visibleNodes: DisplayNode[] = [];
    const visibleNodeIdSet = new Set<string>();
    const sortedClusters = Array.from(clusterNodeMap.entries()).sort((a, b) => a[0] - b[0]);

    for (const [clusterId, clusterNodes] of sortedClusters) {
      if (clusterNodes.length <= 1 || effectiveExpandedClusters.has(clusterId)) {
        for (const node of clusterNodes) {
          visibleNodes.push(node);
          visibleNodeIdSet.add(node.id);
        }
      } else {
        const memberCount = clusterNodes.length;
        const semanticLabel = buildClusterSemanticLabel(clusterNodes);
        const superNode: DisplayNode = {
          id: clusterNodeId(clusterId),
          name: `${semanticLabel} (${memberCount})`,
          cluster: clusterId,
          embedding: null,
          isSuperNode: true,
          memberCount,
        };
        visibleNodes.push(superNode);
        visibleNodeIdSet.add(superNode.id);
      }
    }

    const toVisibleNodeId = (nodeId: string): string | null => {
      const node = nodeById.get(nodeId);
      if (!node) return null;
      const clusterNodes = clusterNodeMap.get(node.cluster);
      const clusterSize = clusterNodes?.length ?? 0;
      const shouldCollapseCluster =
        clusterSize > 1 && !effectiveExpandedClusters.has(node.cluster);
      return shouldCollapseCluster ? clusterNodeId(node.cluster) : nodeId;
    };

    const linkAggregate = new Map<
      string,
      { source: string; target: string; similaritySum: number; count: number }
    >();

    for (const link of data.links) {
      const sourceId = getEndpointId(link.source);
      const targetId = getEndpointId(link.target);
      if (!sourceId || !targetId) continue;

      const visibleSourceId = toVisibleNodeId(sourceId);
      const visibleTargetId = toVisibleNodeId(targetId);
      if (!visibleSourceId || !visibleTargetId) continue;
      if (
        visibleSourceId === visibleTargetId ||
        !visibleNodeIdSet.has(visibleSourceId) ||
        !visibleNodeIdSet.has(visibleTargetId)
      ) {
        continue;
      }

      const [a, b] =
        visibleSourceId < visibleTargetId
          ? [visibleSourceId, visibleTargetId]
          : [visibleTargetId, visibleSourceId];
      const key = `${a}::${b}`;
      const current = linkAggregate.get(key);
      const similarity =
        typeof link.similarity === "number" && Number.isFinite(link.similarity)
          ? link.similarity
          : 0;
      if (!current) {
        linkAggregate.set(key, {
          source: a,
          target: b,
          similaritySum: similarity,
          count: 1,
        });
      } else {
        current.similaritySum += similarity;
        current.count += 1;
      }
    }

    const visibleLinks: DisplayLink[] = Array.from(linkAggregate.values()).map((item) => ({
      source: item.source,
      target: item.target,
      similarity: item.count > 0 ? item.similaritySum / item.count : 0,
      isAggregate:
        item.count > 1 || isClusterNodeId(item.source) || isClusterNodeId(item.target),
      aggregateCount: item.count,
    }));

    return {
      nodes: visibleNodes,
      links: visibleLinks,
    };
  }, [
    activeFocusedClusterId,
    clusterNodeMap,
    clusterOverviewEnabled,
    data.links,
    data.nodes,
    effectiveExpandedClusters,
  ]);
  const displayData = clusterOverviewDisplayData ?? baseDisplayData;
  useEffect(() => {
    // When displayData changes (e.g. clustering slider), react-force-graph-3d removes
    // existing node objects from the scene and re-calls nodeThreeObject. We must clear
    // the cache so fresh THREE.Groups are created — reusing the same object reference
    // after the library detaches it causes nodes to disappear.
    const cache = node3DCacheRef.current;
    if (cache.size === 0) return;

    for (const entry of cache.values()) {
      disposeNode3DCacheEntry(entry);
    }
    cache.clear();
  }, [displayData.nodes]);

  const clusterOffsets = useMemo(
    () =>
      clusterOffsetState.signature === clusterSignature
        ? clusterOffsetState.offsets
        : {},
    [clusterOffsetState, clusterSignature]
  );
  const nodeAnchorLayout = useMemo(() => {
    const classicLayout = buildNodeAnchors(displayData);
    const semanticLayout =
      layoutMode === "umap"
        ? buildUmapAnchors(
            displayData,
            clusterSignature,
            renderMode === "3d" ? 3 : 2
          )
        : layoutMode === "pca3d"
          ? buildPcaAnchors(
              displayData,
              clusterSignature,
              renderMode === "3d" ? 3 : 2
            )
          : null;
    const hasOffsets = Object.keys(clusterOffsets).length > 0;
    const anchors = new Map<string, NodeAnchor>();
    const strengths = new Map<string, number>();

    for (const node of displayData.nodes) {
      const base =
        semanticLayout?.anchors.get(node.id) ||
        classicLayout.anchors.get(node.id) || { x: 0, y: 0, z: 0 };
      const strength =
        semanticLayout?.strengths.get(node.id) ||
        classicLayout.strengths.get(node.id) ||
        0.1;
      const offset = hasOffsets ? clusterOffsets[node.cluster] : null;

      anchors.set(node.id, {
        x: base.x + (offset?.x || 0),
        y: base.y + (offset?.y || 0),
        z: base.z,
      });
      strengths.set(node.id, strength);
    }

    return { anchors, strengths };
  }, [displayData, clusterOffsets, layoutMode, clusterSignature, renderMode]);
  const safeLinkForceScale = Math.max(0.1, Math.min(4, linkForceScale));
  const alphaDecay = fastSettle ? 0.05 : 0.018;
  const velocityDecay = fastSettle ? 0.68 : 0.52;
  const cooldownTicks = fastSettle ? 120 : undefined;
  const threeDLayoutSignature = `${THREE_LAYOUT_SIGNATURE_VERSION}|${clusterSignature}|${UMAP_3D_Z_SCALE_MIN_RATIO}|${UMAP_3D_Z_SCALE_MAX_RATIO}|${UMAP_3D_AXIS_SCALE_MIN_RATIO}|${UMAP_3D_AXIS_SCALE_MAX_RATIO}|${SPAWN_Z_JITTER}`;
  const threeDArmingKey = `${threeDLayoutSignature}|${displayData.nodes.length}|${displayData.links.length}`;
  const is3DEngineArmed = armed3DForKey === threeDArmingKey;
  const effectiveCooldownTicks =
    renderMode === "3d" && !is3DEngineArmed ? 0 : cooldownTicks;
  const persistCurrent3DLayout = useCallback(() => {
    if (!threeDStorageKey || typeof window === "undefined") return;
    const fg = graph3DRef.current;
    if (!fg || typeof fg.graphData !== "function") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentData = fg.graphData() as { nodes?: any[] } | undefined;
    const nodes = Array.isArray(currentData?.nodes) ? currentData.nodes : [];
    const positions: Persisted3DLayout["positions"] = {};
    for (const node of nodes) {
      const nodeId = typeof node?.id === "string" ? node.id : "";
      if (!nodeId) continue;
      const x = typeof node?.x === "number" ? node.x : NaN;
      const y = typeof node?.y === "number" ? node.y : NaN;
      const z = typeof node?.z === "number" ? node.z : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions[nodeId] = { x, y, z };
    }
    if (Object.keys(positions).length === 0) return;
    const payload: Persisted3DLayout = {
      signature: threeDLayoutSignature,
      positions,
    };
    persisted3DLayoutRef.current = payload;
    try {
      localStorage.setItem(threeDStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage write failures.
    }
  }, [threeDLayoutSignature, threeDStorageKey]);
  const getGraphBounds = useCallback(() => {
    const fg = graph3DRef.current;
    if (!fg || typeof fg.getGraphBbox !== "function") return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bbox = fg.getGraphBbox() as any;
    const x = Array.isArray(bbox?.x) ? bbox.x : null;
    const y = Array.isArray(bbox?.y) ? bbox.y : null;
    const z = Array.isArray(bbox?.z) ? bbox.z : null;
    if (!x || !y || !z) return null;
    const [minX, maxX] = x;
    const [minY, maxY] = y;
    const [minZ, maxZ] = z;
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxZ)
    ) {
      return null;
    }
    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };
    const span = {
      x: Math.max(1, maxX - minX),
      y: Math.max(1, maxY - minY),
      z: Math.max(1, maxZ - minZ),
    };
    return { center, span };
  }, []);
  const moveCameraToPreset = useCallback(
    (preset: CameraPreset, duration = 650) => {
      const fg = graph3DRef.current;
      if (!fg || typeof fg.cameraPosition !== "function") return;
      const bounds = getGraphBounds();
      const center = bounds?.center || { x: 0, y: 0, z: 0 };
      const maxSpan = bounds
        ? Math.max(bounds.span.x, bounds.span.y, bounds.span.z)
        : 320;
      const distance = Math.max(280, maxSpan * 1.8);
      const position =
        preset === "top"
          ? { x: center.x, y: center.y + distance, z: center.z }
          : preset === "side"
            ? { x: center.x + distance, y: center.y, z: center.z }
            : {
                x: center.x + distance * 0.9,
                y: center.y + distance * 0.65,
                z: center.z + distance * 0.95,
              };
      fg.cameraPosition(position, center, duration);
    },
    [getGraphBounds]
  );
  const handleCameraPresetChange = useCallback(
    (preset: CameraPreset) => {
      setCameraPreset(preset);
      moveCameraToPreset(preset, 700);
    },
    [moveCameraToPreset]
  );
  const handleReset3DView = useCallback(() => {
    moveCameraToPreset(cameraPreset, 700);
    const fg = graph3DRef.current;
    if (!fg) return;
    try {
      fg.zoomToFit?.(650, 90);
    } catch {
      // best effort only
    }
  }, [cameraPreset, moveCameraToPreset]);
  useEffect(() => {
    return () => {
      persistCurrent3DLayout();
    };
  }, [persistCurrent3DLayout]);
  const nodeClusterMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of displayData.nodes) {
      map.set(node.id, node.cluster);
    }
    return map;
  }, [displayData.nodes]);
  const safeRenderLinkTopK = Number.isFinite(renderLinkTopK)
    ? Math.max(0, Math.min(12, Math.trunc(renderLinkTopK)))
    : 0;
  const renderedLinkKeySet = useMemo(() => {
    if (safeRenderLinkTopK <= 0) return null;

    const byNode = new Map<string, Array<{ key: string; similarity: number }>>();
    for (const link of displayData.links) {
      const sourceId = getEndpointId(link.source);
      const targetId = getEndpointId(link.target);
      if (!sourceId || !targetId || sourceId === targetId) continue;

      const similarity =
        typeof link.similarity === "number" && Number.isFinite(link.similarity)
          ? link.similarity
          : 0;
      const key = normalizeLinkKey(sourceId, targetId);
      const edgeEntry = { key, similarity };

      const sourceEdges = byNode.get(sourceId) || [];
      sourceEdges.push(edgeEntry);
      byNode.set(sourceId, sourceEdges);

      const targetEdges = byNode.get(targetId) || [];
      targetEdges.push(edgeEntry);
      byNode.set(targetId, targetEdges);
    }

    const keep = new Set<string>();
    for (const edges of byNode.values()) {
      edges.sort((a, b) => b.similarity - a.similarity);
      for (let i = 0; i < Math.min(safeRenderLinkTopK, edges.length); i++) {
        keep.add(edges[i].key);
      }
    }

    if (selectedLink) {
      keep.add(normalizeLinkKey(selectedLink.sourceId, selectedLink.targetId));
    }
    return keep;
  }, [displayData.links, safeRenderLinkTopK, selectedLink]);
  const linkDegreeMap = useMemo(() => {
    const degree = new Map<string, number>();
    for (const link of displayData.links) {
      const sourceId = getEndpointId(link.source);
      const targetId = getEndpointId(link.target);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      if (
        renderedLinkKeySet &&
        !renderedLinkKeySet.has(normalizeLinkKey(sourceId, targetId))
      ) {
        continue;
      }
      degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
      degree.set(targetId, (degree.get(targetId) || 0) + 1);
    }
    return degree;
  }, [displayData.links, renderedLinkKeySet]);

  // Apply forces — retry until the ref is populated (dynamic import delay)
  useEffect(() => {
    const fg = renderMode === "3d" ? graph3DRef.current : graph2DRef.current;
    if (!fg || typeof fg.d3Force !== "function") {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }

    let linkForce: unknown;
    try {
      linkForce = fg.d3Force("link");
    } catch {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }
    if (!linkForce) {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }
    const chargeStrength =
      renderMode === "3d" ? CHARGE_STRENGTH_3D : CHARGE_STRENGTH_2D;
    const collisionRadius =
      renderMode === "3d" ? COLLISION_RADIUS_3D : COLLISION_RADIUS_2D;

    try {
      fg.d3Force(
        "charge",
        d3.forceManyBody().strength(chargeStrength).distanceMax(550)
      );
      fg.d3Force(
        "collision",
        d3.forceCollide(collisionRadius).strength(1).iterations(2)
      );
      fg.d3Force("center", d3.forceCenter(0, 0).strength(0.015));
    } catch {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }
    const anchorForceScale =
      renderMode === "3d" ? ANCHOR_FORCE_SCALE_3D_XY : ANCHOR_FORCE_SCALE_2D;

    // Seed the simulation with anchor positions.
    // In 3D mode we also seed z so the graph doesn't spawn as a flat sheet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graphDataValue = fg.graphData?.() as { nodes?: any[] } | undefined;
    const persistedPositions =
      renderMode === "3d" &&
      persisted3DLayoutRef.current?.signature === threeDLayoutSignature
        ? persisted3DLayoutRef.current.positions
        : null;
    if (graphDataValue?.nodes) {
      for (const node of graphDataValue.nodes) {
        const rawId = typeof node?.id === "string" ? node.id : "";
        if (!rawId) continue;
        const persisted = persistedPositions?.[rawId];
        const anchor = nodeAnchorLayout.anchors.get(rawId);
        if (!anchor) continue;
        if (
          persisted &&
          Number.isFinite(persisted.x) &&
          Number.isFinite(persisted.y) &&
          Number.isFinite(persisted.z)
        ) {
          node.x = persisted.x;
          node.y = persisted.y;
          if (renderMode === "3d") {
            node.z = persisted.z;
          }
          continue;
        }
        if (!Number.isFinite(node.x)) {
          const jitterX = renderMode === "3d" ? (Math.random() - 0.5) * 18 : 0;
          node.x = anchor.x + jitterX;
        }
        if (!Number.isFinite(node.y)) {
          const jitterY = renderMode === "3d" ? (Math.random() - 0.5) * 18 : 0;
          node.y = anchor.y + jitterY;
        }
        if (renderMode === "3d") {
          if (!Number.isFinite(node.z)) {
            const jitterSeed = hashString(`${threeDLayoutSignature}|${rawId}|z`) % 1000;
            const jitter = ((jitterSeed / 999) * 2 - 1) * SPAWN_Z_JITTER;
            node.z = anchor.z + jitter;
          }
        } else if (Number.isFinite(node.z)) {
          node.z = 0;
        }
      }
    }

    // Pull nodes toward their cluster anchor so bridged mega-components stay readable.
    try {
      fg.d3Force(
        "x",
        d3
          .forceX((node: d3.SimulationNodeDatum) => {
            const rawId = (node as { id?: unknown }).id;
            const nodeId = typeof rawId === "string" ? rawId : "";
            return nodeAnchorLayout.anchors.get(nodeId)?.x ?? 0;
          })
          .strength((node: d3.SimulationNodeDatum) => {
            const rawId = (node as { id?: unknown }).id;
            const nodeId = typeof rawId === "string" ? rawId : "";
            return (nodeAnchorLayout.strengths.get(nodeId) ?? 0.09) * anchorForceScale;
          })
      );
      fg.d3Force(
        "y",
        d3
          .forceY((node: d3.SimulationNodeDatum) => {
            const rawId = (node as { id?: unknown }).id;
            const nodeId = typeof rawId === "string" ? rawId : "";
            return nodeAnchorLayout.anchors.get(nodeId)?.y ?? 0;
          })
          .strength((node: d3.SimulationNodeDatum) => {
            const rawId = (node as { id?: unknown }).id;
            const nodeId = typeof rawId === "string" ? rawId : "";
            return (nodeAnchorLayout.strengths.get(nodeId) ?? 0.09) * anchorForceScale;
          })
      );
      if (renderMode === "3d") {
        fg.d3Force(
          "z",
          createAnchorForceZ({
            anchors: nodeAnchorLayout.anchors,
            strengths: nodeAnchorLayout.strengths,
            scale: ANCHOR_FORCE_SCALE_3D_Z,
          })
        );
      } else {
        fg.d3Force("z", null);
      }
    } catch {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }

    const linkForceAny = linkForce;
    const linkForceObj =
      typeof linkForceAny === "object" && linkForceAny !== null
        ? (linkForceAny as { distance?: (fn: unknown) => void; strength?: (fn: unknown) => void })
        : null;
    if (linkForceObj?.distance && linkForceObj?.strength) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkForceObj.distance((link: any) => {
        const sourceId = getEndpointId(link?.source);
        const targetId = getEndpointId(link?.target);
        const isRendered =
          !renderedLinkKeySet ||
          (sourceId !== null &&
            targetId !== null &&
            renderedLinkKeySet.has(normalizeLinkKey(sourceId, targetId)));
        if (!isRendered) {
          return 360;
        }
        const sim = link.similarity || 0.3;
        return 300 - sim * 210;
      });
      // Weaker low-similarity edges reduce large-cluster tangling.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkForceObj.strength((link: any) => {
        const sourceId = getEndpointId(link?.source);
        const targetId = getEndpointId(link?.target);
        const isRendered =
          !renderedLinkKeySet ||
          (sourceId !== null &&
            targetId !== null &&
            renderedLinkKeySet.has(normalizeLinkKey(sourceId, targetId)));
        if (!isRendered) {
          return 0.01 * safeLinkForceScale;
        }
        const sim = link.similarity || 0.3;
        const baseStrength =
          (LINK_FORCE_OFFSET + sim * LINK_FORCE_SIM_SCALE) *
          safeLinkForceScale *
          LINK_FORCE_GLOBAL_SCALE;
        const sourceDegree = sourceId ? linkDegreeMap.get(sourceId) || 1 : 1;
        const targetDegree = targetId ? linkDegreeMap.get(targetId) || 1 : 1;
        const hubDegree = Math.max(sourceDegree, targetDegree, 1);
        const hubDamping = Math.max(
          HUB_DAMPING_MIN,
          1 / Math.pow(hubDegree, HUB_DAMPING_EXPONENT)
        );
        return baseStrength * hubDamping;
      });
    }

    try {
      if (typeof fg.d3ReheatSimulation === "function") {
        fg.d3ReheatSimulation();
      }
    } catch {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }
  }, [
    displayData,
    forcesApplied,
    renderMode,
    armed3DForKey,
    threeDLayoutSignature,
    nodeAnchorLayout,
    safeLinkForceScale,
    renderedLinkKeySet,
    linkDegreeMap,
  ]);

  useEffect(() => {
    if (renderMode !== "3d") return;
    if (!is3DEngineArmed) return;
    if (Date.now() - lastSearchFocusAtRef.current < 1200) return;
    const fg = graph3DRef.current;
    if (!fg) return;

    const timer = window.setTimeout(() => {
      try {
        if (Date.now() - lastSearchFocusAtRef.current < 1200) {
          return;
        }
        moveCameraToPreset(cameraPreset, 520);
        fg.zoomToFit?.(520, 95);
      } catch {
        // best effort only
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [
    cameraPreset,
    displayData.nodes.length,
    is3DEngineArmed,
    moveCameraToPreset,
    renderMode,
  ]);

  useEffect(() => {
    autoOrbitRef.current = autoOrbit;
  }, [autoOrbit]);

  useEffect(() => {
    const prev = renderModeRef.current;
    renderModeRef.current = renderMode;

    // Persist 3D layout to localStorage before unmounting
    // (graph3DRef is null after unmount, but persisted3DLayoutRef already has the data from onEngineStop)
    if (prev === "3d" && renderMode !== "3d" && threeDStorageKey && persisted3DLayoutRef.current) {
      try {
        localStorage.setItem(threeDStorageKey, JSON.stringify(persisted3DLayoutRef.current));
      } catch {
        // Ignore storage write failures.
      }
    }

    // Clean up 3D caches when switching away from 3D
    if (prev === "3d" && renderMode !== "3d") {
      const node3DCache = node3DCacheRef.current;
      for (const entry of node3DCache.values()) {
        disposeNode3DCacheEntry(entry);
      }
      node3DCache.clear();

      const sphereCache = sphereGeometryCacheRef.current;
      for (const geometry of sphereCache.values()) {
        geometry.dispose();
      }
      sphereCache.clear();

      const labelCache = labelTextureCacheRef.current;
      for (const entry of labelCache.values()) {
        entry.texture.dispose();
      }
      labelCache.clear();
    }
  }, [renderMode, threeDStorageKey]);
  const sync3DControlsAndScene = useCallback(() => {
    const fg = graph3DRef.current;
    if (!fg) return;

    const mode = renderModeRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = typeof fg.controls === "function" ? (fg.controls() as any) : null;
    if (controls) {
      if ("enableDamping" in controls) {
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
      }
      if ("maxDistance" in controls) {
        controls.maxDistance = 4000;
      }
      if ("minDistance" in controls) {
        controls.minDistance = 70;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scene = typeof fg.scene === "function" ? (fg.scene() as any) : null;
    if (scene && scene instanceof THREE.Scene) {
      scene.fog =
        mode === "3d"
          ? new THREE.FogExp2(new THREE.Color("#030712"), THREE_FOG_DENSITY)
          : null;
    }
  }, []);

  // Manual orbit: rotate camera around the graph center each frame
  useEffect(() => {
    sync3DControlsAndScene();
    const delayed = window.setTimeout(sync3DControlsAndScene, 140);

    let rafId = 0;
    if (renderMode === "3d" && autoOrbit) {
      const angularSpeed = THREE_AUTO_ROTATE_SPEED * 0.005; // radians per frame
      const tick = () => {
        const fg = graph3DRef.current;
        if (fg && typeof fg.cameraPosition === "function" && typeof fg.camera === "function") {
          const camera = fg.camera() as THREE.Camera | null;
          if (camera) {
            const pos = camera.position;
            const cosA = Math.cos(angularSpeed);
            const sinA = Math.sin(angularSpeed);
            const newX = pos.x * cosA + pos.z * sinA;
            const newZ = -pos.x * sinA + pos.z * cosA;
            fg.cameraPosition({ x: newX, y: pos.y, z: newZ });
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      window.clearTimeout(delayed);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [autoOrbit, renderMode, sync3DControlsAndScene]);

  useEffect(() => {
    function handleResize() {
      const sidebar = fullscreen ? 0 : reservedWidth ?? 0;
      const fallbackWidth = Math.min(window.innerWidth - 32, 1800);
      const fallbackHeight = fullscreen
        ? window.innerHeight - 24
        : Math.max(window.innerHeight - 200, 560);
      const containerWidth =
        containerRef.current?.clientWidth ??
        fallbackWidth;
      const containerHeight = containerRef.current?.clientHeight ?? fallbackHeight;

      setDimensions({
        width: Math.max(containerWidth - sidebar, 320),
        height: Math.max(containerHeight, 320),
      });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [reservedWidth, fullscreen]);

  // Build a quick lookup: nodeId -> cluster color
  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of displayData.nodes) {
      map.set(node.id, getClusterColor(node.cluster));
    }
    return map;
  }, [displayData.nodes]);
  const nodeColorMapRef = useRef(nodeColorMap);
  nodeColorMapRef.current = nodeColorMap;

  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of displayData.nodes) {
      map.set(node.id, node.name);
    }
    return map;
  }, [displayData.nodes]);
  const labelYOffsetMap = useMemo(() => {
    // Stagger labels for spatially close nodes so text lines don't stack.
    const laneCandidates = [0, -1, 1, -2, 2, -3, 3];
    const laneSpacing = 7;
    const proximityX = 170;
    const proximityY = 58;
    const placed: Array<{ x: number; y: number; lane: number }> = [];
    const positionedNodes = displayData.nodes
      .map((node) => {
        const anchor = nodeAnchorLayout.anchors.get(node.id);
        return {
          id: node.id,
          x: anchor?.x ?? 0,
          y: anchor?.y ?? 0,
        };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const offsets = new Map<string, number>();
    for (const node of positionedNodes) {
      const laneUseCount = new Map<number, number>();
      for (const prior of placed) {
        if (
          Math.abs(node.x - prior.x) <= proximityX &&
          Math.abs(node.y - prior.y) <= proximityY
        ) {
          laneUseCount.set(prior.lane, (laneUseCount.get(prior.lane) || 0) + 1);
        }
      }

      let chosenLane = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const lane of laneCandidates) {
        const conflicts = laneUseCount.get(lane) || 0;
        const score = conflicts * 10 + Math.abs(lane);
        if (score < bestScore) {
          bestScore = score;
          chosenLane = lane;
        }
      }

      placed.push({ x: node.x, y: node.y, lane: chosenLane });
      offsets.set(node.id, chosenLane * laneSpacing);
    }

    return offsets;
  }, [displayData.nodes, nodeAnchorLayout.anchors]);

  const getSphereGeometry = useCallback((radius: number) => {
    const key = Math.max(1, Math.round(radius * 10) / 10);
    const cached = sphereGeometryCacheRef.current.get(key);
    if (cached) return cached;
    const geometry = new THREE.SphereGeometry(key, 20, 20);
    sphereGeometryCacheRef.current.set(key, geometry);
    return geometry;
  }, []);

  const getLabelTexture = useCallback((text: string, color: string) => {
    const safeText = text.trim() || "Topic";
    const key = `${safeText}|${color}`;
    const cached = labelTextureCacheRef.current.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    const fontSize = 54;
    const paddingX = 18;
    const paddingY = 12;
    const tempCtx = canvas.getContext("2d");
    if (!tempCtx) {
      const fallback = new THREE.CanvasTexture(canvas);
      const fallbackEntry = { texture: fallback, aspect: 3 };
      labelTextureCacheRef.current.set(key, fallbackEntry);
      return fallbackEntry;
    }
    tempCtx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    const textWidth = Math.ceil(tempCtx.measureText(safeText).width);
    canvas.width = Math.max(128, textWidth + paddingX * 2);
    canvas.height = fontSize + paddingY * 2;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 8;
      ctx.fillText(safeText, canvas.width / 2, canvas.height / 2 + 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const entry = {
      texture,
      aspect: canvas.width / Math.max(1, canvas.height),
    };
    labelTextureCacheRef.current.set(key, entry);

    // Prevent unbounded cache growth if many labels/states are generated.
    if (labelTextureCacheRef.current.size > 1400) {
      for (const [cacheKey, cacheEntry] of labelTextureCacheRef.current) {
        if (cacheKey === key) continue;
        cacheEntry.texture.dispose();
        labelTextureCacheRef.current.delete(cacheKey);
        if (labelTextureCacheRef.current.size <= 1000) {
          break;
        }
      }
    }

    return entry;
  }, []);

  // When a node is selected, find all nodes connected to it in the current graph.
  // Everything outside this component gets dimmed and desaturated.
  const focusedComponent = useMemo(() => {
    if (!selectedNodeId) return null;

    const adjacency = new Map<string, Set<string>>();
    for (const node of displayData.nodes) {
      adjacency.set(node.id, new Set());
    }
    for (const link of displayData.links) {
      // react-force-graph mutates links and may replace endpoint ids with node objects
      const sourceId = getEndpointId(link.source);
      const targetId = getEndpointId(link.target);
      if (!sourceId || !targetId) continue;
      if (
        renderedLinkKeySet &&
        !renderedLinkKeySet.has(normalizeLinkKey(sourceId, targetId))
      ) {
        continue;
      }

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
  }, [displayData.links, displayData.nodes, selectedNodeId, renderedLinkKeySet]);

  const selectedNodeVisible = useMemo(
    () =>
      Boolean(
        selectedNodeId && displayData.nodes.some((node) => node.id === selectedNodeId)
      ),
    [displayData.nodes, selectedNodeId]
  );
  const hasFocus = Boolean(selectedNodeVisible && focusedComponent);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const label = node.name || "";
    const nodeId = typeof node?.id === "string" ? node.id : "";
    const isSuperNode = node?.isSuperNode === true || isClusterNodeId(nodeId);
    const memberCount =
      typeof node?.memberCount === "number" && Number.isFinite(node.memberCount)
        ? node.memberCount
        : null;
    const isSelected = nodeId === selectedNodeId;
    const isConnectSource = connectingFromName === node.name;
    const inConnectMode = !!connectingFromName;
    const inFocusedComponent = !hasFocus || Boolean(focusedComponent?.has(nodeId));
    const color = nodeColorMap.get(nodeId) || "#3b82f6";
    const labelYOffset = labelYOffsetMap.get(nodeId) || 0;
    const x = node.x || 0;
    const y = node.y || 0;
    const radius = resolveNodeRadius({
      isSuperNode,
      memberCount,
      inFocusedComponent,
      isConnectSource,
      isSelected,
      inConnectMode,
    });
    let nodeColor = color;
    let glowColor = color;
    let nodeAlpha = 1;
    let labelColor = "#d1d5db";
    let labelAlpha = 1;

    if (!inFocusedComponent) {
      nodeColor = "#9ca3af";
      glowColor = "#9ca3af";
      nodeAlpha = 0.3;
      labelColor = "#9ca3af";
      labelAlpha = 0.35;
    }

    if (inFocusedComponent && isConnectSource) {
      nodeColor = "#a855f7";
      glowColor = "#a855f7";
      labelColor = "#c084fc";
    } else if (inFocusedComponent && isSelected && !isSuperNode) {
      labelColor = "#ffffff";
    } else if (inFocusedComponent && isSuperNode) {
      labelColor = "#ffffff";
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

    if (inFocusedComponent && isConnectSource && !isSuperNode) {
      // Pulsing ring for connect source
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (inFocusedComponent && isSelected && !isSuperNode) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (inFocusedComponent && isSuperNode) {
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();

    // Draw label with subtle shadow for readability
    ctx.save();
    ctx.font = isSuperNode
      ? "bold 11px Inter, sans-serif"
      : isConnectSource
        ? "bold 10px Inter, sans-serif"
        : "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.globalAlpha = labelAlpha;
    ctx.fillStyle = labelColor;
    const labelBaseOffset =
      isSuperNode
        ? radius + 12
        : 14 + 7 * Math.max(0, NODE_RADIUS_SCALE - 1);
    ctx.fillText(label, x, y + labelBaseOffset + labelYOffset);
    ctx.restore();
  }, [
    selectedNodeId,
    connectingFromName,
    hasFocus,
    focusedComponent,
    nodeColorMap,
    labelYOffsetMap,
  ]);
  const nodePointerAreaPaint = useCallback(
    (node: PointerNode, color: string, ctx: CanvasRenderingContext2D) => {
      const nodeId = typeof node?.id === "string" ? node.id : "";
      const isSuperNode = node?.isSuperNode === true || isClusterNodeId(nodeId);
      const memberCount =
        typeof node?.memberCount === "number" && Number.isFinite(node.memberCount)
          ? node.memberCount
          : null;
      const isSelected = nodeId === selectedNodeId;
      const nodeName = typeof node?.name === "string" ? node.name : "";
      const isConnectSource = connectingFromName === nodeName;
      const inConnectMode = !!connectingFromName;
      const inFocusedComponent = !hasFocus || Boolean(focusedComponent?.has(nodeId));
      const radius =
        resolveNodeRadius({
          isSuperNode,
          memberCount,
          inFocusedComponent,
          isConnectSource,
          isSelected,
          inConnectMode,
        }) + NODE_HITBOX_PADDING;

      const x = typeof node?.x === "number" ? node.x : 0;
      const y = typeof node?.y === "number" ? node.y : 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    },
    [selectedNodeId, connectingFromName, hasFocus, focusedComponent]
  );

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
    const normalizedCurrent = normalizeLinkKey(sourceId, targetId);
    if (renderedLinkKeySet && !renderedLinkKeySet.has(normalizedCurrent)) {
      return;
    }

    const normalizedSelected = selectedLink
      ? normalizeLinkKey(selectedLink.sourceId, selectedLink.targetId)
      : null;
    const isSelectedLink =
      normalizedSelected !== null && normalizedCurrent === normalizedSelected;

    const inFocusedComponent =
      !hasFocus ||
      (focusedComponent?.has(sourceId) && focusedComponent?.has(targetId));

    const sourceColor = nodeColorMap.get(sourceId) || "#3b82f6";
    const targetColor = nodeColorMap.get(targetId) || "#3b82f6";
    const similarity = link.similarity || 0.3;
    const aggregateCount =
      typeof link.aggregateCount === "number" && Number.isFinite(link.aggregateCount)
        ? Math.max(1, link.aggregateCount)
        : 1;
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
        ? 1 + similarity * 2 + Math.min(1.6, Math.log2(aggregateCount) * 0.35)
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
  }, [hasFocus, focusedComponent, nodeColorMap, selectedLink, renderedLinkKeySet]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getNode3DVisualState = useCallback((node: any): Node3DVisualState => {
    const nodeId = typeof node?.id === "string" ? node.id : "";
    const isSuperNode = node?.isSuperNode === true || isClusterNodeId(nodeId);
    const memberCount =
      typeof node?.memberCount === "number" && Number.isFinite(node.memberCount)
        ? node.memberCount
        : null;
    const isSelected = nodeId === selectedNodeId;
    const isConnectSource = connectingFromName === node.name;
    const inConnectMode = !!connectingFromName;
    const inFocusedComponent = !hasFocus || Boolean(focusedComponent?.has(nodeId));
    const baseColor = nodeColorMap.get(nodeId) || "#3b82f6";
    const radius = resolveNodeRadius({
      isSuperNode,
      memberCount,
      inFocusedComponent,
      isConnectSource,
      isSelected,
      inConnectMode,
    });
    let displayColor = baseColor;
    let alpha = Math.max(0.35, Math.min(0.95, 0.45 + radius / 34));
    let glowOpacity = inFocusedComponent ? 0.44 : 0.13;
    let labelColor = inFocusedComponent ? "#f8fafc" : "#9ca3af";
    let labelOpacity = inFocusedComponent ? 0.95 : 0.45;

    if (inFocusedComponent && isConnectSource) {
      displayColor = "#a855f7";
      alpha = 0.97;
      glowOpacity = 0.62;
      labelColor = "#d8b4fe";
    } else if (inFocusedComponent && isSelected && !isSuperNode) {
      displayColor = "#ffffff";
      alpha = 0.98;
      glowOpacity = 0.7;
      labelColor = "#ffffff";
    } else if (!inFocusedComponent) {
      displayColor = "#9ca3af";
      alpha = 0.22;
      glowOpacity = 0.09;
      labelColor = "#9ca3af";
      labelOpacity = 0.38;
    }

    return {
      nodeId,
      radius: Math.max(2.5, radius * 0.37),
      displayColor,
      alpha,
      glowOpacity,
      labelColor,
      labelOpacity,
      label: typeof node?.name === "string" ? node.name : "",
      isSuperNode,
      inFocusedComponent,
    };
  }, [selectedNodeId, connectingFromName, hasFocus, focusedComponent, nodeColorMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node3DLabel = useCallback((_node: any) => {
    // Labels are rendered via sprites in node3DObject, so suppress the default tooltip
    return "";
  }, []);

  const createNode3DCacheEntry = useCallback((): Node3DCacheEntry => {
    const group = new THREE.Group();
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color("#ffffff"),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    group.add(glowSprite);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#ffffff"),
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0.6,
      roughness: 0.32,
      metalness: 0.05,
      transparent: true,
      opacity: 0.8,
    });
    const coreMesh = new THREE.Mesh(getSphereGeometry(2.5), coreMaterial);
    coreMesh.castShadow = false;
    coreMesh.receiveShadow = false;
    group.add(coreMesh);

    const rimMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffffff"),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rimMesh = new THREE.Mesh(getSphereGeometry(3), rimMaterial);
    group.add(rimMesh);

    return {
      group,
      glowSprite,
      glowMaterial,
      coreMesh,
      coreMaterial,
      rimMesh,
      rimMaterial,
      labelSprite: null,
      labelMaterial: null,
      labelKey: null,
    };
  }, [getSphereGeometry, glowTexture]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node3DObject = useCallback((node: any) => {
    const nodeId = typeof node?.id === "string" ? node.id : "";
    const isSuperNode = node?.isSuperNode === true || isClusterNodeId(nodeId);
    const label = typeof node?.name === "string" ? node.name : "";
    const cache = node3DCacheRef.current;
    let entry = nodeId.length > 0 ? (cache.get(nodeId) ?? null) : null;
    if (!entry) {
      entry = createNode3DCacheEntry();
      if (nodeId.length > 0) {
        cache.set(nodeId, entry);
      }
    }

    // Set initial default appearance — visual state updates happen in a separate effect
    const baseColor = nodeColorMapRef.current.get(nodeId) || "#3b82f6";
    const radius = resolveNodeRadius({
      isSuperNode,
      memberCount: typeof node?.memberCount === "number" ? node.memberCount : null,
      inFocusedComponent: true,
      isConnectSource: false,
      isSelected: false,
      inConnectMode: false,
    }) * 0.37;
    const rimRadius = radius * (isSuperNode ? 1.34 : 1.28);

    const coreGeometry = getSphereGeometry(Math.max(2.5, radius));
    if (entry.coreMesh.geometry !== coreGeometry) {
      entry.coreMesh.geometry = coreGeometry;
    }
    const rimGeometry = getSphereGeometry(rimRadius);
    if (entry.rimMesh.geometry !== rimGeometry) {
      entry.rimMesh.geometry = rimGeometry;
    }

    entry.glowMaterial.color.set(baseColor);
    entry.glowMaterial.opacity = 0.44;
    const glowScale = Math.max(2.5, radius) * 7.2;
    entry.glowSprite.scale.set(glowScale, glowScale, 1);

    entry.coreMaterial.color.set(baseColor);
    entry.coreMaterial.emissive.set(baseColor);
    entry.coreMaterial.emissiveIntensity = 0.88;
    entry.coreMaterial.opacity = 0.8;

    entry.rimMaterial.color.set(baseColor);
    entry.rimMaterial.opacity = 0.26;

    // Set up label
    if (label.length > 0) {
      const labelColor = "#f8fafc";
      const { texture, aspect } = getLabelTexture(label, labelColor);
      if (!entry.labelSprite || !entry.labelMaterial) {
        entry.labelMaterial = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          depthTest: false,
        });
        entry.labelSprite = new THREE.Sprite(entry.labelMaterial);
        entry.labelSprite.renderOrder = 999;
        entry.group.add(entry.labelSprite);
      } else if (entry.labelMaterial.map !== texture) {
        entry.labelMaterial.map = texture;
        entry.labelMaterial.needsUpdate = true;
      }
      entry.labelMaterial.opacity = 0.95;
      entry.labelKey = `${label}|${labelColor}`;

      const safeRadius = Math.max(2.5, radius);
      const labelHeight = isSuperNode
        ? Math.max(6.5, Math.min(13, safeRadius * 0.6))
        : Math.max(5.5, Math.min(11, safeRadius * 0.55));
      entry.labelSprite.scale.set(labelHeight * aspect, labelHeight, 1);
      entry.labelSprite.position.set(0, safeRadius + labelHeight * 0.82 + 2.5, 0);
    } else {
      if (entry.labelSprite && entry.labelMaterial) {
        entry.group.remove(entry.labelSprite);
        entry.labelMaterial.dispose();
      }
      entry.labelSprite = null;
      entry.labelMaterial = null;
      entry.labelKey = null;
    }

    return entry.group;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createNode3DCacheEntry, getLabelTexture, getSphereGeometry]);

  // Update 3D node materials reactively when selection/focus state changes
  // This avoids changing the nodeThreeObject callback identity on every click
  useEffect(() => {
    if (renderMode !== "3d") return;
    const cache = node3DCacheRef.current;
    if (cache.size === 0) return;

    for (const [nodeId, entry] of cache) {
      const style = getNode3DVisualState({ id: nodeId, name: nodeNameMap.get(nodeId) || "", isSuperNode: isClusterNodeId(nodeId) });
      const radius = style.radius;
      const rimRadius = radius * (style.isSuperNode ? 1.34 : 1.28);

      const coreGeometry = getSphereGeometry(radius);
      if (entry.coreMesh.geometry !== coreGeometry) {
        entry.coreMesh.geometry = coreGeometry;
      }
      const rimGeometry = getSphereGeometry(rimRadius);
      if (entry.rimMesh.geometry !== rimGeometry) {
        entry.rimMesh.geometry = rimGeometry;
      }

      entry.glowMaterial.color.set(style.displayColor);
      entry.glowMaterial.opacity = style.glowOpacity;
      const glowScale = radius * 7.2;
      entry.glowSprite.scale.set(glowScale, glowScale, 1);

      entry.coreMaterial.color.set(style.displayColor);
      entry.coreMaterial.emissive.set(style.displayColor);
      entry.coreMaterial.emissiveIntensity = style.inFocusedComponent ? 0.88 : 0.28;
      entry.coreMaterial.opacity = style.alpha;

      entry.rimMaterial.color.set(style.displayColor);
      entry.rimMaterial.opacity = style.inFocusedComponent ? 0.26 : 0.12;

      // Update label color/opacity
      if (entry.labelSprite && entry.labelMaterial) {
        const label = style.label;
        const labelColor = style.labelColor;
        const nextLabelKey = label.length > 0 ? `${label}|${labelColor}` : null;

        if (!nextLabelKey) {
          entry.group.remove(entry.labelSprite);
          entry.labelMaterial.dispose();
          entry.labelSprite = null;
          entry.labelMaterial = null;
          entry.labelKey = null;
        } else {
          const { texture } = getLabelTexture(label, labelColor);
          if (entry.labelMaterial.map !== texture) {
            entry.labelMaterial.map = texture;
            entry.labelMaterial.needsUpdate = true;
          }
          entry.labelMaterial.opacity = style.labelOpacity;
          entry.labelKey = nextLabelKey;
        }
      }
    }
  }, [renderMode, getNode3DVisualState, getSphereGeometry, getLabelTexture, nodeNameMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const link3DColor = useCallback((link: any) => {
    const sourceId = getEndpointId(link?.source);
    const targetId = getEndpointId(link?.target);
    if (!sourceId || !targetId) return "rgba(156, 163, 175, 0.12)";
    const normalizedCurrent = normalizeLinkKey(sourceId, targetId);
    if (renderedLinkKeySet && !renderedLinkKeySet.has(normalizedCurrent)) {
      return "rgba(156, 163, 175, 0.05)";
    }

    const normalizedSelected = selectedLink
      ? normalizeLinkKey(selectedLink.sourceId, selectedLink.targetId)
      : null;
    const isSelectedLink =
      normalizedSelected !== null && normalizedCurrent === normalizedSelected;
    const inFocusedComponent =
      !hasFocus ||
      (focusedComponent?.has(sourceId) && focusedComponent?.has(targetId));
    const sourceColor = nodeColorMap.get(sourceId) || "#3b82f6";
    const similarity =
      typeof link?.similarity === "number" && Number.isFinite(link.similarity)
        ? link.similarity
        : 0;

    if (isSelectedLink) return "rgba(255,255,255,0.95)";
    if (!inFocusedComponent) return "rgba(156,163,175,0.08)";
    return hexToRgba(sourceColor, 0.1 + similarity * 0.45);
  }, [renderedLinkKeySet, selectedLink, hasFocus, focusedComponent, nodeColorMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const link3DWidth = useCallback((link: any) => {
    const sourceId = getEndpointId(link?.source);
    const targetId = getEndpointId(link?.target);
    if (!sourceId || !targetId) return 0.5;
    const normalizedCurrent = normalizeLinkKey(sourceId, targetId);
    if (renderedLinkKeySet && !renderedLinkKeySet.has(normalizedCurrent)) {
      return 0.4;
    }

    const normalizedSelected = selectedLink
      ? normalizeLinkKey(selectedLink.sourceId, selectedLink.targetId)
      : null;
    const isSelectedLink =
      normalizedSelected !== null && normalizedCurrent === normalizedSelected;
    const inFocusedComponent =
      !hasFocus ||
      (focusedComponent?.has(sourceId) && focusedComponent?.has(targetId));
    const similarity =
      typeof link?.similarity === "number" && Number.isFinite(link.similarity)
        ? link.similarity
        : 0;

    if (isSelectedLink) return 3.2;
    if (!inFocusedComponent) return 0.55;
    return 0.7 + similarity * 2.1;
  }, [renderedLinkKeySet, selectedLink, hasFocus, focusedComponent]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback((node: any) => {
    const nodeId = typeof node?.id === "string" ? node.id : "";
    const clusterId =
      typeof node?.cluster === "number" && Number.isFinite(node.cluster)
        ? node.cluster
        : null;
    const isSuperNode = node?.isSuperNode === true || isClusterNodeId(nodeId);
    if (clusterOverviewEnabled && isSuperNode && clusterId !== null) {
      const now = Date.now();
      const last = lastClusterClickRef.current;
      const isDoubleClick =
        last !== null &&
        last.nodeId === nodeId &&
        now - last.at <= CLUSTER_DOUBLE_CLICK_WINDOW_MS;

      if (isDoubleClick) {
        updateFocusedClusterId(clusterId);
        lastClusterClickRef.current = null;
      } else {
        lastClusterClickRef.current = { nodeId, at: now };
      }
      return;
    }

    lastClusterClickRef.current = null;

    if (onNodeClick && node.id && node.name) {
      onNodeClick(node.id, node.name);
    }
  }, [clusterOverviewEnabled, onNodeClick, updateFocusedClusterId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeDragEnd = useCallback((node: any) => {
    const nodeId = typeof node?.id === "string" ? node.id : null;
    if (!nodeId) return;

    if (renderMode === "3d") {
      if (typeof node === "object" && node) {
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      }
      window.setTimeout(() => {
        persistCurrent3DLayout();
      }, 80);
      return;
    }

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
  }, [
    clusterSignature,
    nodeAnchorLayout.anchors,
    nodeClusterMap,
    persistCurrent3DLayout,
    renderMode,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLinkClick = useCallback((link: any) => {
    if (!onLinkClick) return;
    if (link?.isAggregate) return;
    const sourceId = getEndpointId(link?.source);
    const targetId = getEndpointId(link?.target);
    if (!sourceId || !targetId) return;
    if (
      renderedLinkKeySet &&
      !renderedLinkKeySet.has(normalizeLinkKey(sourceId, targetId))
    ) {
      return;
    }
    if (isClusterNodeId(sourceId) || isClusterNodeId(targetId)) return;

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
  }, [onLinkClick, nodeNameMap, renderedLinkKeySet]);

  const handleBackgroundClick = useCallback(() => {
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  useEffect(() => {
    const requestNodeId = focusNodeRequest?.nodeId;
    const requestToken = focusNodeRequest?.token ?? null;
    if (!requestNodeId || !Number.isFinite(requestToken)) return;
    if (lastFocusTokenRef.current === requestToken) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    let followupTimer: number | null = null;
    let attempts = 0;
    let hasFocused = false;

    const focusRequestedNode = (isFollowup = false) => {
      if (cancelled) return;

      const fg = renderMode === "3d" ? graph3DRef.current : graph2DRef.current;
      if (!fg || typeof fg.graphData !== "function") {
        if (!isFollowup && attempts < 24) {
          attempts += 1;
          retryTimer = window.setTimeout(focusRequestedNode, 90);
        }
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentData = fg.graphData() as { nodes?: any[] } | undefined;
      const nodes = Array.isArray(currentData?.nodes) ? currentData.nodes : [];
      let visibleNodeId = requestNodeId;
      let targetNode = nodes.find((node) => node?.id === visibleNodeId);
      const sourceNode = data.nodes.find((node) => node.id === requestNodeId);

      if (!targetNode) {
        if (sourceNode) {
          const superNodeId = clusterNodeId(sourceNode.cluster);
          const clusterNode = nodes.find((node) => node?.id === superNodeId);
          if (clusterNode) {
            targetNode = clusterNode;
            visibleNodeId = superNodeId;
          }
        }
      }

      const fallbackAnchorId =
        targetNode && visibleNodeId
          ? visibleNodeId
          : sourceNode
            ? clusterNodeId(sourceNode.cluster)
            : requestNodeId;
      const anchor =
        nodeAnchorLayout.anchors.get(fallbackAnchorId) ||
        nodeAnchorLayout.anchors.get(requestNodeId);

      if (!targetNode && !anchor) {
        if (!isFollowup && attempts < 24) {
          attempts += 1;
          retryTimer = window.setTimeout(focusRequestedNode, 90);
        }
        return;
      }

      const x =
        typeof targetNode.x === "number" && Number.isFinite(targetNode.x)
          ? targetNode.x
          : (anchor?.x ?? 0);
      const y =
        typeof targetNode.y === "number" && Number.isFinite(targetNode.y)
          ? targetNode.y
          : (anchor?.y ?? 0);
      const z =
        typeof targetNode.z === "number" && Number.isFinite(targetNode.z)
          ? targetNode.z
          : (anchor?.z ?? 0);

      if (renderMode === "3d" && typeof fg.cameraPosition === "function") {
        let distance = 360;
        if (typeof fg.camera === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const camera = fg.camera() as any;
          const camX = camera?.position?.x;
          const camY = camera?.position?.y;
          const camZ = camera?.position?.z;
          if (
            Number.isFinite(camX) &&
            Number.isFinite(camY) &&
            Number.isFinite(camZ)
          ) {
            const currentDistance = Math.hypot(camX - x, camY - y, camZ - z);
            if (Number.isFinite(currentDistance)) {
              distance = Math.max(220, Math.min(980, currentDistance * 0.75));
            }
          }
        }
        fg.cameraPosition(
          {
            x: x + distance * 0.72,
            y: y + distance * 0.46,
            z: z + distance * 0.9,
          },
          { x, y, z },
          isFollowup ? 520 : 820
        );
        if (targetNode && typeof fg.zoomToFit === "function") {
          try {
            fg.zoomToFit(
              isFollowup ? 420 : 760,
              100,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (node: any) => node?.id === visibleNodeId
            );
          } catch {
            // no-op fallback
          }
        }
      } else {
        if (typeof fg.centerAt === "function") {
          fg.centerAt(x, y, isFollowup ? 420 : 760);
        }
        if (typeof fg.zoom === "function") {
          let nextZoom = 2.4;
          try {
            const currentZoom = Number(fg.zoom());
            if (Number.isFinite(currentZoom)) {
              nextZoom = Math.max(2.2, Math.min(5, Math.max(currentZoom, 2.2)));
            }
          } catch {
            nextZoom = 2.4;
          }
          fg.zoom(nextZoom, isFollowup ? 420 : 760);
        }
        if (targetNode && typeof fg.zoomToFit === "function") {
          try {
            fg.zoomToFit(
              isFollowup ? 420 : 760,
              140,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (node: any) => node?.id === visibleNodeId
            );
          } catch {
            // no-op fallback
          }
        }
      }

      hasFocused = true;
      lastSearchFocusAtRef.current = Date.now();
      lastFocusTokenRef.current = requestToken;

      // Run a short follow-up center pass after simulation movement settles.
      if (!isFollowup) {
        followupTimer = window.setTimeout(() => {
          focusRequestedNode(true);
        }, 320);
      }
    };

    focusRequestedNode();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      if (followupTimer !== null) {
        window.clearTimeout(followupTimer);
      }
      if (!hasFocused && attempts >= 24) {
        // Give up and consume this request token after bounded retries.
        lastFocusTokenRef.current = requestToken;
      }
    };
  }, [data.nodes, focusNodeRequest, nodeAnchorLayout.anchors, renderMode]);

  if (displayData.nodes.length === 0) {
    return (
      <div
        ref={containerRef}
        className="h-full w-full flex items-center justify-center border border-gray-800 rounded-lg bg-gray-950/50"
      >
        <p className="text-gray-500">
          Add some interests to see your knowledge graph
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full border border-gray-800 rounded-lg overflow-hidden"
      style={{ background: "radial-gradient(ellipse at center, #0f172a 0%, #030712 100%)" }}
    >
      {showClusterToggleButton && (
        <button
          type="button"
          onClick={handleToggleClusterOverview}
          className={`absolute right-3 top-3 z-10 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors ${
            clusterOverviewEnabled
              ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-100"
              : "border-gray-700 bg-gray-950/85 text-gray-300 hover:border-gray-500 hover:text-white"
          }`}
        >
          Cluster
        </button>
      )}
      {renderMode === "3d" && (
        <div className="absolute left-3 top-12 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-700/80 bg-gray-950/80 px-2 py-1.5 backdrop-blur">
          <button
            type="button"
            onClick={handleReset3DView}
            className="rounded-md border border-gray-600 bg-gray-900/70 px-2 py-1 text-[11px] text-gray-200 hover:border-gray-400"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => handleCameraPresetChange("perspective")}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              cameraPreset === "perspective"
                ? "border-cyan-400/80 bg-cyan-500/20 text-cyan-100"
                : "border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400"
            }`}
          >
            Persp
          </button>
          <button
            type="button"
            onClick={() => handleCameraPresetChange("top")}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              cameraPreset === "top"
                ? "border-cyan-400/80 bg-cyan-500/20 text-cyan-100"
                : "border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400"
            }`}
          >
            Top
          </button>
          <button
            type="button"
            onClick={() => handleCameraPresetChange("side")}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              cameraPreset === "side"
                ? "border-cyan-400/80 bg-cyan-500/20 text-cyan-100"
                : "border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400"
            }`}
          >
            Side
          </button>
          <button
            type="button"
            onClick={() => setAutoOrbit((value) => !value)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              autoOrbit
                ? "border-emerald-400/80 bg-emerald-500/20 text-emerald-100"
                : "border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400"
            }`}
          >
            Orbit {autoOrbit ? "On" : "Off"}
          </button>
        </div>
      )}
      {renderMode === "2d" && (
        <div className="absolute inset-0">
          <ForceGraph2D
            ref={graph2DRef}
            graphData={displayData}
            width={dimensions.width}
            height={dimensions.height}
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={nodePointerAreaPaint}
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
      )}
      {renderMode === "3d" && (
        <div className="absolute inset-0">
          <ForceGraph3D
            ref={graph3DRef}
            graphData={displayData}
            numDimensions={3}
            width={dimensions.width}
            height={dimensions.height}
            nodeLabel={node3DLabel}
            nodeThreeObject={node3DObject}
            linkColor={link3DColor}
            linkWidth={link3DWidth}
            onNodeClick={handleNodeClick}
            onNodeDragEnd={handleNodeDragEnd}
            onLinkClick={handleLinkClick}
            onBackgroundClick={handleBackgroundClick}
            onEngineTick={() => {
              if (armed3DForKey !== threeDArmingKey) {
                setArmed3DForKey(threeDArmingKey);
              }
              const now = performance.now();
              if (now - last3DControlSyncAtRef.current > 140) {
                last3DControlSyncAtRef.current = now;
                sync3DControlsAndScene();
              }
            }}
            onEngineStop={() => {
              if (armed3DForKey !== threeDArmingKey) {
                setArmed3DForKey(threeDArmingKey);
              }
              persistCurrent3DLayout();
            }}
            backgroundColor="rgba(0,0,0,0)"
            d3AlphaDecay={alphaDecay}
            d3VelocityDecay={velocityDecay}
            cooldownTicks={effectiveCooldownTicks}
          />
        </div>
      )}
    </div>
  );
}
