"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphData } from "@/lib/types";
import * as d3 from "d3-force";

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

interface KnowledgeGraphProps {
  data: GraphData;
  selectedNodeId?: string | null;
  connectingFromName?: string | null;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  onBackgroundClick?: () => void;
  reservedWidth?: number;
}

export default function KnowledgeGraph({
  data,
  selectedNodeId,
  connectingFromName,
  onNodeClick,
  onBackgroundClick,
  reservedWidth,
}: KnowledgeGraphProps) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [forcesApplied, setForcesApplied] = useState(0);

  // Apply forces — retry until the ref is populated (dynamic import delay)
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) {
      const timer = setTimeout(() => setForcesApplied((n) => n + 1), 200);
      return () => clearTimeout(timer);
    }

    fg.d3Force("charge", d3.forceManyBody().strength(-300).distanceMax(400));
    fg.d3Force("collision", d3.forceCollide(40));
    fg.d3Force("center", d3.forceCenter().strength(0.05));

    // Pull all nodes toward center — keeps disconnected components nearby
    fg.d3Force("x", d3.forceX(0).strength(0.08));
    fg.d3Force("y", d3.forceY(0).strength(0.08));

    const linkForce = fg.d3Force("link");
    if (linkForce) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkForce.distance((link: any) => {
        const sim = link.similarity || 0.3;
        return 250 - sim * 180;
      });
      linkForce.strength(0.4);
    }

    fg.d3ReheatSimulation();
  }, [data, forcesApplied]);

  useEffect(() => {
    function handleResize() {
      const sidebar = reservedWidth ?? (selectedNodeId ? 288 + 16 : 0);
      setDimensions({
        width: Math.max(Math.min(window.innerWidth - 48, 1200) - sidebar, 320),
        height: Math.max(window.innerHeight - 220, 500),
      });
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [selectedNodeId, reservedWidth]);

  // Build a quick lookup: nodeId -> cluster color
  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of data.nodes) {
      map.set(node.id, getClusterColor(node.cluster));
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
    const inFocusedComponent =
      !hasFocus ||
      (focusedComponent?.has(sourceId) && focusedComponent?.has(targetId));

    const sourceColor = nodeColorMap.get(sourceId) || "#3b82f6";
    const targetColor = nodeColorMap.get(targetId) || "#3b82f6";
    const similarity = link.similarity || 0.3;
    const alpha = inFocusedComponent
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
    ctx.lineWidth = inFocusedComponent ? 1 + similarity * 2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }, [hasFocus, focusedComponent, nodeColorMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback((node: any) => {
    if (onNodeClick && node.id && node.name) {
      onNodeClick(node.id, node.name);
    }
  }, [onNodeClick]);

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
    <div className="border border-gray-800 rounded-lg overflow-hidden" style={{ background: "radial-gradient(ellipse at center, #0f172a 0%, #030712 100%)" }}>
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        backgroundColor="rgba(0,0,0,0)"
        d3AlphaDecay={0.01}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
