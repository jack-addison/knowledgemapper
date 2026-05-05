"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AtlasDomain {
  id: string;
  display_name: string;
  description: string | null;
}

interface AtlasField {
  id: string;
  display_name: string;
  domain_id: string;
  description: string | null;
}

interface AtlasSubfield {
  id: string;
  display_name: string;
  field_id: string;
  description: string | null;
  works_count: number;
}

interface AtlasTopic {
  id: string;
  display_name: string;
  description: string | null;
  keywords: string[];
  subfield_id: string;
  works_count: number;
  cited_by_count: number;
  wikipedia_url: string | null;
  x: number;
  y: number;
}

interface AtlasEdge {
  topic_a_id: string;
  topic_b_id: string;
  similarity: number;
}

interface AtlasPaper {
  id: string;
  title: string;
  abstract: string | null;
  year: number | null;
  doi: string | null;
  journal: string | null;
  citation_count: number;
  topic_id: string;
  x: number;
  y: number;
}

interface AtlasPaperEdge {
  paper_a_id: string;
  paper_b_id: string;
  similarity: number;
}

interface AtlasData {
  domains: AtlasDomain[];
  fields: AtlasField[];
  subfields: AtlasSubfield[];
  topics: AtlasTopic[];
  edges: AtlasEdge[];
}

type ContinentMode = "off" | "field" | "domain";
type AtlasLayoutMode = "mixed" | "islands" | "islands-fields";

interface Point2D {
  x: number;
  y: number;
}

interface ContinentRegion {
  key: string;
  label: string;
  color: string;
  points: Point2D[];
  centroid: Point2D;
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_COLORS: Record<string, string> = {
  "fields/31": "#60a5fa", // Physics and Astronomy
  "fields/17": "#a78bfa", // Computer Science
  "fields/22": "#f97316", // Engineering
  "fields/16": "#22d3ee", // Chemistry
  "fields/26": "#facc15", // Mathematics
  "fields/25": "#fb923c", // Materials Science
  "fields/11": "#4ade80", // Agricultural and Biological Sciences
  "fields/13": "#34d399", // Biochemistry, Genetics
  "fields/23": "#a3e635", // Environmental Science
  "fields/19": "#c084fc", // Earth and Planetary Sciences
  "fields/21": "#fbbf24", // Energy
  "fields/15": "#2dd4bf", // Chemical Engineering
  "fields/28": "#f472b6", // Neuroscience
  "fields/24": "#86efac", // Immunology and Microbiology
  "fields/30": "#e879f9", // Pharmacology
};

const GENERATED_FIELD_COLORS = [
  "#38bdf8",
  "#818cf8",
  "#22d3ee",
  "#34d399",
  "#4ade80",
  "#fbbf24",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#f87171",
  "#2dd4bf",
  "#84cc16",
];
const NODE_BASE_RADIUS = 1.2;
const NODE_MAX_RADIUS = 4;
const COORD_SCALE = 28; // spread UMAP coordinates out
const PAPER_NODE_BASE_RADIUS = 2;
const PAPER_NODE_MAX_RADIUS = 6;
const PAPER_COORD_SCALE = 40; // spread paper UMAP coordinates
const TOPIC_MIN_DISTANCE = 1; // UMAP units
const PAPER_MIN_DISTANCE = 0.24; // UMAP units
const CONTINENT_PADDING = 10; // world units
const DOMAIN_ISLAND_PADDING = 6; // world units
const DOMAIN_ISLAND_GAP = 0; // world units
const DOMAIN_ISLAND_SHIFT_STRENGTH = 1;
const FIELD_ISLAND_PADDING = 3; // world units
const FIELD_ISLAND_GAP = 0; // world units
const FIELD_ISLAND_SHIFT_STRENGTH = 1;
const FIELD_CLUSTER_EXPANSION_BASE = 45.8;
const FIELD_CLUSTER_EXPANSION_LOG = 2.8;
const FIELD_CLUSTER_EXPANSION_MAX = 60;
const FIELD_NODE_MIN_DISTANCE = 5.4; // world units, prevents node overlap inside clusters
const WHEEL_ZOOM_SENSITIVITY = 0.0016;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFieldColor(fieldId: string): string {
  if (FIELD_COLORS[fieldId]) return FIELD_COLORS[fieldId];
  let hash = 0;
  for (let i = 0; i < fieldId.length; i++) {
    hash = ((hash << 5) - hash + fieldId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % GENERATED_FIELD_COLORS.length;
  return GENERATED_FIELD_COLORS[idx];
}

function getDomainColor(domainId: string): string {
  let hash = 0;
  for (let i = 0; i < domainId.length; i++) {
    hash = ((hash << 5) - hash + domainId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % GENERATED_FIELD_COLORS.length;
  return GENERATED_FIELD_COLORS[idx];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizedWheelDelta(e: WheelEvent): number {
  let delta = e.deltaY;
  // Browser wheel delta can be in pixels, lines, or pages.
  if (e.deltaMode === 1) delta *= 16;
  else if (e.deltaMode === 2) delta *= window.innerHeight;
  return delta;
}

function nodeRadius(worksCount: number): number {
  const logScale = Math.log10(Math.max(worksCount, 1));
  return clamp(NODE_BASE_RADIUS + logScale * 0.4, NODE_BASE_RADIUS, NODE_MAX_RADIUS);
}

function paperNodeRadius(citationCount: number): number {
  const logScale = Math.log10(Math.max(citationCount, 1));
  return clamp(PAPER_NODE_BASE_RADIUS + logScale * 0.5, PAPER_NODE_BASE_RADIUS, PAPER_NODE_MAX_RADIUS);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function openAlexWorkUrl(workId: string): string {
  return `https://openalex.org/${workId}`;
}

function pointCross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 2) return points.slice();

  const unique = new Map<string, Point2D>();
  for (const p of points) {
    unique.set(`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p);
  }
  const sorted = Array.from(unique.values()).sort((a, b) => {
    if (a.x === b.x) return a.y - b.y;
    return a.x - b.x;
  });
  if (sorted.length <= 2) return sorted;

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && pointCross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && pointCross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function centroidOfPoints(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function expandPolygon(points: Point2D[], padding: number): Point2D[] {
  if (points.length < 3 || padding <= 0) return points;
  const center = centroidOfPoints(points);
  return points.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return p;
    const scale = (dist + padding) / dist;
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  });
}

function expandPointsAroundCentroid<T extends { x: number; y: number }>(points: T[], factor: number): T[] {
  if (points.length === 0 || factor <= 1) return points;
  const center = centroidOfPoints(points);
  return points.map((point) => ({
    ...point,
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
}

function packNonOverlappingCenters(
  centers: Point2D[],
  radii: number[],
  gap: number,
  iterations = 100
): Point2D[] {
  if (centers.length <= 1) return centers;

  const positions = centers.map((c) => ({ ...c }));
  const anchors = centers.map((c) => ({ ...c }));

  for (let iter = 0; iter < iterations; iter++) {
    // Gentle attraction to keep the arrangement compact.
    for (let i = 0; i < positions.length; i++) {
      positions[i].x += (anchors[i].x - positions[i].x) * 0.06;
      positions[i].y += (anchors[i].y - positions[i].y) * 0.06;
    }

    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const minDist = radii[i] + radii[j] + gap;
        let dx = positions[j].x - positions[i].x;
        let dy = positions[j].y - positions[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;

        if (dist < 1e-6) {
          const angle = ((i + 1) * 0.732 + (j + 1) * 0.417) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }

        const overlap = minDist - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const push = overlap * 0.5;
        positions[i].x -= ux * push;
        positions[i].y -= uy * push;
        positions[j].x += ux * push;
        positions[j].y += uy * push;
        moved = true;
      }
    }

    if (!moved) break;
  }

  // Final strict pass: remove any residual overlap.
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const minDist = radii[i] + radii[j] + gap;
        let dx = positions[j].x - positions[i].x;
        let dy = positions[j].y - positions[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;

        if (dist < 1e-6) {
          const angle = ((i + 1) * 0.913 + (j + 1) * 0.271) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }

        const overlap = minDist - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const push = overlap * 0.5;
        positions[i].x -= ux * push;
        positions[i].y -= uy * push;
        positions[j].x += ux * push;
        positions[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return positions;
}

function computeTopicWorldPositions(
  topics: AtlasTopic[],
  subfieldToField: Map<string, string>,
  fieldById: Map<string, AtlasField>,
  mode: AtlasLayoutMode
): Map<string, Point2D> {
  const basePositions = new Map<string, Point2D>();
  for (const topic of topics) {
    basePositions.set(topic.id, {
      x: topic.x * COORD_SCALE,
      y: topic.y * COORD_SCALE,
    });
  }

  if (mode === "mixed" || topics.length < 2) return basePositions;

  type DomainPoint = {
    id: string;
    x: number;
    y: number;
    fieldId: string;
    domainId: string;
  };
  type DomainBucket = {
    id: string;
    points: DomainPoint[];
    centroid: Point2D;
    radius: number;
  };

  function separateFieldIslandsInDomain(points: DomainPoint[]): DomainPoint[] {
    if (points.length < 3) return points;

    const fieldGroups = new Map<string, DomainPoint[]>();
    for (const point of points) {
      const key = point.fieldId || "unknown-field";
      const bucket = fieldGroups.get(key);
      if (bucket) bucket.push(point);
      else fieldGroups.set(key, [point]);
    }
    if (fieldGroups.size <= 1) return points;

    const fieldBuckets: Array<{
      fieldId: string;
      points: DomainPoint[];
      centroid: Point2D;
      radius: number;
    }> = [];

    for (const [fieldId, fieldPoints] of fieldGroups.entries()) {
      const expansionFactor = clamp(
        FIELD_CLUSTER_EXPANSION_BASE + Math.log10(fieldPoints.length + 1) * FIELD_CLUSTER_EXPANSION_LOG,
        1,
        FIELD_CLUSTER_EXPANSION_MAX
      );
      const expandedFieldPoints = expandPointsAroundCentroid(fieldPoints, expansionFactor);
      const spacedFieldPoints = enforceMinimumNodeDistance(
        expandedFieldPoints,
        FIELD_NODE_MIN_DISTANCE,
        10
      );
      const centroid = centroidOfPoints(spacedFieldPoints);
      let radius = 0;
      for (const p of spacedFieldPoints) {
        radius = Math.max(radius, Math.hypot(p.x - centroid.x, p.y - centroid.y));
      }
      fieldBuckets.push({
        fieldId,
        points: spacedFieldPoints,
        centroid,
        radius: radius + FIELD_ISLAND_PADDING,
      });
    }

    fieldBuckets.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
    const initialCenters: Point2D[] = fieldBuckets.map((bucket) => ({
      x: bucket.centroid.x,
      y: bucket.centroid.y,
    }));
    const adjusted = new Map<string, DomainPoint>();

    const packedCenters = packNonOverlappingCenters(
      initialCenters,
      fieldBuckets.map((bucket) => bucket.radius),
      FIELD_ISLAND_GAP
    );

    for (let i = 0; i < fieldBuckets.length; i++) {
      const bucket = fieldBuckets[i];
      const targetCenter = packedCenters[i];
      const dx = (targetCenter.x - bucket.centroid.x) * FIELD_ISLAND_SHIFT_STRENGTH;
      const dy = (targetCenter.y - bucket.centroid.y) * FIELD_ISLAND_SHIFT_STRENGTH;
      for (const point of bucket.points) {
        adjusted.set(point.id, {
          ...point,
          x: point.x + dx,
          y: point.y + dy,
        });
      }
    }

    return points.map((point) => adjusted.get(point.id) || point);
  }

  const groups = new Map<string, DomainPoint[]>();
  for (const topic of topics) {
    const pos = basePositions.get(topic.id);
    if (!pos) continue;
    const fieldId = subfieldToField.get(topic.subfield_id) || "";
    const domainId = fieldById.get(fieldId)?.domain_id || "unknown";
    const point: DomainPoint = { id: topic.id, x: pos.x, y: pos.y, fieldId, domainId };
    const bucket = groups.get(domainId);
    if (bucket) bucket.push(point);
    else groups.set(domainId, [point]);
  }

  const buckets: DomainBucket[] = [];
  for (const [id, points] of groups.entries()) {
    if (points.length === 0) continue;
    const domainPoints = mode === "islands-fields" ? separateFieldIslandsInDomain(points) : points;
    const centroid = centroidOfPoints(domainPoints);
    let radius = 0;
    for (const p of domainPoints) {
      radius = Math.max(radius, Math.hypot(p.x - centroid.x, p.y - centroid.y));
    }
    buckets.push({
      id,
      points: domainPoints,
      centroid,
      radius: radius + DOMAIN_ISLAND_PADDING,
    });
  }

  if (buckets.length <= 1) {
    if (mode !== "islands-fields") return basePositions;
    const onlyDomainResult = new Map<string, Point2D>();
    for (const bucket of buckets) {
      for (const point of bucket.points) {
        onlyDomainResult.set(point.id, { x: point.x, y: point.y });
      }
    }
    for (const topic of topics) {
      if (!onlyDomainResult.has(topic.id)) {
        onlyDomainResult.set(topic.id, basePositions.get(topic.id) || { x: 0, y: 0 });
      }
    }
    return onlyDomainResult;
  }

  buckets.sort((a, b) => a.id.localeCompare(b.id));
  const initialDomainCenters: Point2D[] = buckets.map((bucket) => ({
    x: bucket.centroid.x,
    y: bucket.centroid.y,
  }));

  const packedDomainCenters = packNonOverlappingCenters(
    initialDomainCenters,
    buckets.map((bucket) => bucket.radius),
    DOMAIN_ISLAND_GAP
  );

  const result = new Map<string, Point2D>();
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    const targetCenter = packedDomainCenters[i];
    const dx = (targetCenter.x - bucket.centroid.x) * DOMAIN_ISLAND_SHIFT_STRENGTH;
    const dy = (targetCenter.y - bucket.centroid.y) * DOMAIN_ISLAND_SHIFT_STRENGTH;
    for (const p of bucket.points) {
      result.set(p.id, { x: p.x + dx, y: p.y + dy });
    }
  }

  for (const topic of topics) {
    if (!result.has(topic.id)) {
      result.set(topic.id, basePositions.get(topic.id) || { x: 0, y: 0 });
    }
  }

  return result;
}

function enforceMinimumNodeDistance<T extends { x: number; y: number }>(
  items: T[],
  minDistance: number,
  iterations = 4
): T[] {
  if (items.length < 2 || minDistance <= 0) return items;

  const adjusted = items.map((item) => ({ ...item })) as T[];
  const minDistSq = minDistance * minDistance;
  const cellSize = minDistance;

  const sourceCenter = items.reduce(
    (acc, item) => {
      acc.x += item.x;
      acc.y += item.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  sourceCenter.x /= items.length;
  sourceCenter.y /= items.length;

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    const grid = new Map<string, number[]>();

    for (let i = 0; i < adjusted.length; i++) {
      const p = adjusted[i];
      const gx = Math.floor(p.x / cellSize);
      const gy = Math.floor(p.y / cellSize);
      const key = `${gx},${gy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    for (let i = 0; i < adjusted.length; i++) {
      const p = adjusted[i];
      const gx = Math.floor(p.x / cellSize);
      const gy = Math.floor(p.y / cellSize);

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const neighborBucket = grid.get(`${gx + ox},${gy + oy}`);
          if (!neighborBucket) continue;

          for (const j of neighborBucket) {
            if (j <= i) continue;
            const q = adjusted[j];
            let dx = q.x - p.x;
            let dy = q.y - p.y;
            let distSq = dx * dx + dy * dy;

            if (distSq >= minDistSq) continue;

            if (distSq < 1e-10) {
              const angle = ((i + 1) * 0.754877666 + (j + 1) * 0.569840291) * Math.PI * 2;
              dx = Math.cos(angle) * 1e-4;
              dy = Math.sin(angle) * 1e-4;
              distSq = dx * dx + dy * dy;
            }

            const dist = Math.sqrt(distSq);
            const push = (minDistance - dist) * 0.5;
            const ux = dx / dist;
            const uy = dy / dist;

            p.x -= ux * push;
            p.y -= uy * push;
            q.x += ux * push;
            q.y += uy * push;
            moved = true;
          }
        }
      }
    }

    if (!moved) break;
  }

  const adjustedCenter = adjusted.reduce(
    (acc, item) => {
      acc.x += item.x;
      acc.y += item.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  adjustedCenter.x /= adjusted.length;
  adjustedCenter.y /= adjusted.length;

  const shiftX = sourceCenter.x - adjustedCenter.x;
  const shiftY = sourceCenter.y - adjustedCenter.y;
  for (const item of adjusted) {
    item.x += shiftX;
    item.y += shiftY;
  }

  return adjusted;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AtlasPage() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<AtlasTopic | null>(null);
  const [hoveredTopic, setHoveredTopic] = useState<AtlasTopic | null>(null);
  const [activeDomainFilter, setActiveDomainFilter] = useState<string | null>(null);
  const [activeFieldFilter, setActiveFieldFilter] = useState<string | null>(null);
  const [atlasLayoutMode, setAtlasLayoutMode] = useState<AtlasLayoutMode>("islands-fields");
  const [continentMode, setContinentMode] = useState<ContinentMode>("field");
  const [searchQuery, setSearchQuery] = useState("");

  // Paper drill-down state
  const [paperViewTopic, setPaperViewTopic] = useState<AtlasTopic | null>(null);
  const [papers, setPapers] = useState<AtlasPaper[]>([]);
  const [paperEdges, setPaperEdges] = useState<AtlasPaperEdge[]>([]);
  const [papersLoading, setPapersLoading] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<AtlasPaper | null>(null);
  const [hoveredPaper, setHoveredPaper] = useState<AtlasPaper | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const viewRef = useRef({ offsetX: 0, offsetY: 0, zoom: 1 });
  const baseZoomRef = useRef(1); // initial fit-to-screen zoom, used to normalize node scaling
  const isDraggingRef = useRef(false);
  const dragDistRef = useRef(0);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const needsRenderRef = useRef(true);

  // Paper view refs (reuse same canvas/view system)
  const paperViewRef = useRef({ offsetX: 0, offsetY: 0, zoom: 1 });
  const paperBaseZoomRef = useRef(1);

  // Lookup maps
  const subfieldToField = useMemo(() => {
    if (!data) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const sf of data.subfields) map.set(sf.id, sf.field_id);
    return map;
  }, [data]);

  const fieldById = useMemo(() => {
    if (!data) return new Map<string, AtlasField>();
    return new Map(data.fields.map((f) => [f.id, f]));
  }, [data]);

  const domainById = useMemo(() => {
    if (!data) return new Map<string, AtlasDomain>();
    return new Map(data.domains.map((d) => [d.id, d]));
  }, [data]);

  const subfieldById = useMemo(() => {
    if (!data) return new Map<string, AtlasSubfield>();
    return new Map(data.subfields.map((s) => [s.id, s]));
  }, [data]);

  const topicById = useMemo(() => {
    if (!data) return new Map<string, AtlasTopic>();
    return new Map(data.topics.map((t) => [t.id, t]));
  }, [data]);

  // Filtered topics
  const visibleTopics = useMemo(() => {
    if (!data) return [];
    let topics = data.topics;
    if (activeDomainFilter) {
      topics = topics.filter((t) => {
        const fieldId = subfieldToField.get(t.subfield_id);
        if (!fieldId) return false;
        const domainId = fieldById.get(fieldId)?.domain_id;
        return domainId === activeDomainFilter;
      });
    }
    if (activeFieldFilter) {
      topics = topics.filter(
        (t) => subfieldToField.get(t.subfield_id) === activeFieldFilter
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      topics = topics.filter(
        (t) =>
          t.display_name.toLowerCase().includes(q) ||
          t.keywords.some((k) => k.toLowerCase().includes(q))
      );
    }
    return topics;
  }, [data, activeDomainFilter, activeFieldFilter, searchQuery, subfieldToField, fieldById]);

  const topicCountByField = useMemo(() => {
    if (!data) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const topic of data.topics) {
      const fieldId = subfieldToField.get(topic.subfield_id);
      if (!fieldId) continue;
      counts.set(fieldId, (counts.get(fieldId) || 0) + 1);
    }
    return counts;
  }, [data, subfieldToField]);

  const topicCountByDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [fieldId, count] of topicCountByField.entries()) {
      const domainId = fieldById.get(fieldId)?.domain_id;
      if (!domainId) continue;
      counts.set(domainId, (counts.get(domainId) || 0) + count);
    }
    return counts;
  }, [topicCountByField, fieldById]);

  const availableDomains = useMemo(() => {
    if (!data) return [];
    return data.domains
      .filter((domain) => (topicCountByDomain.get(domain.id) || 0) > 0)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [data, topicCountByDomain]);

  const availableFields = useMemo(() => {
    if (!data) return [];
    return data.fields
      .filter((field) => {
        if ((topicCountByField.get(field.id) || 0) === 0) return false;
        if (activeDomainFilter && field.domain_id !== activeDomainFilter) return false;
        return true;
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [data, topicCountByField, activeDomainFilter]);

  useEffect(() => {
    if (!activeFieldFilter || !activeDomainFilter) return;
    const currentField = fieldById.get(activeFieldFilter);
    if (!currentField || currentField.domain_id !== activeDomainFilter) {
      setActiveFieldFilter(null);
    }
  }, [activeDomainFilter, activeFieldFilter, fieldById]);

  const visibleTopicIds = useMemo(
    () => new Set(visibleTopics.map((t) => t.id)),
    [visibleTopics]
  );

  const visibleEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter(
      (e) => visibleTopicIds.has(e.topic_a_id) && visibleTopicIds.has(e.topic_b_id)
    );
  }, [data, visibleTopicIds]);

  const topicWorldPositions = useMemo(() => {
    if (!data) return new Map<string, Point2D>();
    return computeTopicWorldPositions(
      data.topics,
      subfieldToField,
      fieldById,
      atlasLayoutMode
    );
  }, [data, subfieldToField, fieldById, atlasLayoutMode]);

  const getTopicWorldPosition = useCallback((topicId: string) => {
    return topicWorldPositions.get(topicId) || { x: 0, y: 0 };
  }, [topicWorldPositions]);

  const continentRegions = useMemo<ContinentRegion[]>(() => {
    if (continentMode === "off" || visibleTopics.length < 3) return [];

    const groups = new Map<string, { label: string; color: string; points: Point2D[] }>();
    for (const topic of visibleTopics) {
      const fieldId = subfieldToField.get(topic.subfield_id) || "";
      const field = fieldById.get(fieldId);
      const domain = field ? domainById.get(field.domain_id) : null;
      if (continentMode === "field") {
        if (!fieldId || !field) continue;
        const key = `field:${fieldId}`;
        if (!groups.has(key)) {
          groups.set(key, {
            label: field.display_name,
            color: getFieldColor(fieldId),
            points: [],
          });
        }
        const world = getTopicWorldPosition(topic.id);
        groups.get(key)!.points.push({ x: world.x, y: world.y });
      } else {
        if (!domain || !field) continue;
        const key = `domain:${domain.id}`;
        if (!groups.has(key)) {
          groups.set(key, {
            label: domain.display_name,
            color: getDomainColor(domain.id),
            points: [],
          });
        }
        const world = getTopicWorldPosition(topic.id);
        groups.get(key)!.points.push({ x: world.x, y: world.y });
      }
    }

    const regions: ContinentRegion[] = [];
    for (const [key, group] of groups.entries()) {
      if (group.points.length < 4) continue;
      const hull = computeConvexHull(group.points);
      if (hull.length < 3) continue;
      const expanded = expandPolygon(hull, CONTINENT_PADDING);
      regions.push({
        key,
        label: group.label,
        color: group.color,
        points: expanded,
        centroid: centroidOfPoints(expanded),
        count: group.points.length,
      });
    }

    return regions.sort((a, b) => b.count - a.count);
  }, [continentMode, visibleTopics, subfieldToField, fieldById, domainById, getTopicWorldPosition]);

  // Load data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/atlas");
        if (!res.ok) throw new Error("Failed to load atlas data");
        const json: AtlasData = await res.json();
        setData({
          ...json,
          topics: enforceMinimumNodeDistance(json.topics || [], TOPIC_MIN_DISTANCE, 4),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Enter paper view for a topic
  const enterPaperView = useCallback(async (topic: AtlasTopic) => {
    setPapersLoading(true);
    setPaperViewTopic(topic);
    setSelectedTopic(null);
    setSelectedPaper(null);
    setHoveredPaper(null);
    try {
      const res = await fetch(`/api/atlas/papers?topic=${encodeURIComponent(topic.id)}`);
      if (!res.ok) throw new Error("Failed to load papers");
      const json: { papers?: AtlasPaper[]; edges?: AtlasPaperEdge[] } = await res.json();
      const nextPapers = enforceMinimumNodeDistance(json.papers || [], PAPER_MIN_DISTANCE, 4);
      setPapers(nextPapers);
      setPaperEdges(json.edges || []);
      setSelectedPaper(nextPapers[0] || null);
    } catch (err) {
      console.error("Paper load error:", err);
      setPapers([]);
      setPaperEdges([]);
    } finally {
      setPapersLoading(false);
    }
  }, []);

  const exitPaperView = useCallback(() => {
    if (paperViewTopic) {
      setSelectedTopic(paperViewTopic);
    }
    setPaperViewTopic(null);
    setPapers([]);
    setPaperEdges([]);
    setSelectedPaper(null);
    setHoveredPaper(null);
    needsRenderRef.current = true;
  }, [paperViewTopic]);

  // Center paper view when papers load
  useEffect(() => {
    if (!paperViewTopic || papers.length === 0 || dimensions.width < 10) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of papers) {
      const sx = p.x * PAPER_COORD_SCALE;
      const sy = p.y * PAPER_COORD_SCALE;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const padding = 80;
    const zoom = Math.min(
      (dimensions.width - padding * 2) / rangeX,
      (dimensions.height - padding * 2) / rangeY
    );
    paperBaseZoomRef.current = zoom;
    paperViewRef.current = {
      offsetX: dimensions.width / 2 - midX * zoom,
      offsetY: dimensions.height / 2 - midY * zoom,
      zoom,
    };
    needsRenderRef.current = true;
  }, [paperViewTopic, papers, dimensions]);

  // Paper lookup
  const paperById = useMemo(() => {
    return new Map(papers.map((p) => [p.id, p]));
  }, [papers]);

  // Resize — use ResizeObserver for accurate container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      const rect = container!.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
        needsRenderRef.current = true;
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Center view when data loads
  useEffect(() => {
    if (!data || data.topics.length === 0 || dimensions.width < 10) return;
    const topics = data.topics;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of topics) {
      const world = getTopicWorldPosition(t.id);
      const sx = world.x;
      const sy = world.y;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const padding = 60;
    const zoom = Math.min(
      (dimensions.width - padding * 2) / rangeX,
      (dimensions.height - padding * 2) / rangeY
    );

    baseZoomRef.current = zoom;
    viewRef.current = {
      offsetX: dimensions.width / 2 - midX * zoom,
      offsetY: dimensions.height / 2 - midY * zoom,
      zoom,
    };
    needsRenderRef.current = true;
  }, [data, dimensions, getTopicWorldPosition, atlasLayoutMode]);

  // Transforms
  const worldToScreen = useCallback((wx: number, wy: number) => {
    const v = viewRef.current;
    return { x: wx * v.zoom + v.offsetX, y: wy * v.zoom + v.offsetY };
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.offsetX) / v.zoom, y: (sy - v.offsetY) / v.zoom };
  }, []);

  // Hit-test
  const topicAtScreen = useCallback(
    (sx: number, sy: number): AtlasTopic | null => {
      const world = screenToWorld(sx, sy);
      const zoom = viewRef.current.zoom;
      let closest: AtlasTopic | null = null;
      let closestDist = Infinity;

      for (const topic of visibleTopics) {
        const worldPos = getTopicWorldPosition(topic.id);
        const tx = worldPos.x;
        const ty = worldPos.y;
        const r = nodeRadius(topic.works_count) / zoom;
        const hitR = r + 8 / zoom;
        const dx = tx - world.x;
        const dy = ty - world.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitR && dist < closestDist) {
          closest = topic;
          closestDist = dist;
        }
      }
      return closest;
    },
    [visibleTopics, screenToWorld, getTopicWorldPosition]
  );

  // Paper hit-test
  const paperAtScreen = useCallback(
    (sx: number, sy: number): AtlasPaper | null => {
      const v = paperViewRef.current;
      const wx = (sx - v.offsetX) / v.zoom;
      const wy = (sy - v.offsetY) / v.zoom;
      let closest: AtlasPaper | null = null;
      let closestDist = Infinity;

      for (const paper of papers) {
        const tx = paper.x * PAPER_COORD_SCALE;
        const ty = paper.y * PAPER_COORD_SCALE;
        const r = paperNodeRadius(paper.citation_count) / v.zoom;
        const hitR = r + 8 / v.zoom;
        const dx = tx - wx;
        const dy = ty - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitR && dist < closestDist) {
          closest = paper;
          closestDist = dist;
        }
      }
      return closest;
    },
    [papers]
  );

  // Mouse handlers — work for both topic and paper views
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const inPaperView = !!paperViewTopic;

    function getActiveView() {
      return inPaperView ? paperViewRef.current : viewRef.current;
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = getActiveView();

      const delta = normalizedWheelDelta(e);
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;

      const sensitivity = e.ctrlKey
        ? WHEEL_ZOOM_SENSITIVITY * 0.5
        : WHEEL_ZOOM_SENSITIVITY;
      const rawZoomFactor = Math.exp(-delta * sensitivity);
      const zoomFactor = clamp(rawZoomFactor, 0.4, 2.5);

      const currentZoom = v.zoom;
      const newZoom = clamp(currentZoom * zoomFactor, 0.02, 300);
      if (Math.abs(newZoom - currentZoom) < 1e-8) return;

      // Keep the world point under cursor fixed while zooming.
      const worldX = (mx - v.offsetX) / currentZoom;
      const worldY = (my - v.offsetY) / currentZoom;
      v.zoom = newZoom;
      v.offsetX = mx - worldX * newZoom;
      v.offsetY = my - worldY * newZoom;
      needsRenderRef.current = true;
    }

    function handleMouseDown(e: MouseEvent) {
      isDraggingRef.current = true;
      dragDistRef.current = 0;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const insideCanvas = sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height;

      if (isDraggingRef.current) {
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        dragDistRef.current += Math.abs(dx) + Math.abs(dy);
        const v = getActiveView();
        v.offsetX += dx;
        v.offsetY += dy;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        needsRenderRef.current = true;
      } else if (!insideCanvas) {
        if (inPaperView) {
          if (hoveredPaper) {
            setHoveredPaper(null);
            needsRenderRef.current = true;
          }
        } else if (hoveredTopic) {
          setHoveredTopic(null);
          needsRenderRef.current = true;
        }
        canvas!.style.cursor = "default";
      } else if (inPaperView) {
        const paper = paperAtScreen(sx, sy);
        if (paper !== hoveredPaper) {
          setHoveredPaper(paper);
          needsRenderRef.current = true;
        }
        canvas!.style.cursor = paper ? "pointer" : "grab";
      } else {
        const topic = topicAtScreen(sx, sy);
        if (topic !== hoveredTopic) {
          setHoveredTopic(topic);
          needsRenderRef.current = true;
        }
        canvas!.style.cursor = topic ? "pointer" : "grab";
      }
    }

    function handleMouseUp(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const insideCanvas = sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height;

      const wasDrag = dragDistRef.current > 4;
      isDraggingRef.current = false;
      dragDistRef.current = 0;

      if (!insideCanvas) return;

      if (!wasDrag) {
        if (inPaperView) {
          const paper = paperAtScreen(sx, sy);
          setSelectedPaper(paper);
        } else {
          const topic = topicAtScreen(sx, sy);
          setSelectedTopic(topic);
        }
        needsRenderRef.current = true;
      }
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [topicAtScreen, paperAtScreen, hoveredTopic, hoveredPaper, paperViewTopic]);

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function render() {
      rafRef.current = requestAnimationFrame(render);
      if (!needsRenderRef.current) return;
      needsRenderRef.current = false;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 1 || h < 1) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background — radial gradient matching dashboard
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bgGrad.addColorStop(0, "#0f172a");
      bgGrad.addColorStop(1, "#030712");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      if (paperViewTopic && papers.length > 0) {
        // =====================================================================
        // PAPER VIEW RENDERING
        // =====================================================================
        const pv = paperViewRef.current;
        const pZoom = pv.zoom;
        const relZoom = pZoom / (paperBaseZoomRef.current || 1);
        const nodeScale = Math.max(relZoom, 0.001);
        const labelScale = Math.sqrt(Math.max(relZoom, 0.001));

        function paperToScreen(px: number, py: number) {
          return { x: px * pZoom + pv.offsetX, y: py * pZoom + pv.offsetY };
        }

        // Get field color for this topic
        const topicFieldId = subfieldToField.get(paperViewTopic.subfield_id) || "";
        const topicColor = getFieldColor(topicFieldId);
        const [tcr, tcg, tcb] = hexToRgb(topicColor);

        // Draw paper edges
        const baseAlpha = clamp(0.05 + pZoom * 0.01, 0.02, 0.2);
        ctx.lineWidth = Math.max(0.4, 0.5 / Math.sqrt(pZoom));

        for (const edge of paperEdges) {
          const a = paperById.get(edge.paper_a_id);
          const b = paperById.get(edge.paper_b_id);
          if (!a || !b) continue;

          const sa = paperToScreen(a.x * PAPER_COORD_SCALE, a.y * PAPER_COORD_SCALE);
          const sb = paperToScreen(b.x * PAPER_COORD_SCALE, b.y * PAPER_COORD_SCALE);

          if (
            Math.max(sa.x, sb.x) < -50 || Math.min(sa.x, sb.x) > w + 50 ||
            Math.max(sa.y, sb.y) < -50 || Math.min(sa.y, sb.y) > h + 50
          ) continue;

          const alpha = baseAlpha * clamp(edge.similarity, 0.3, 1);
          ctx.strokeStyle = rgba(tcr, tcg, tcb, alpha);
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
        }

        // Draw paper nodes
        const showLabels = labelScale > 1.2;
        const labelAlpha = clamp((labelScale - 1.2) / 1.0, 0, 0.9);

        for (const paper of papers) {
          const screen = paperToScreen(paper.x * PAPER_COORD_SCALE, paper.y * PAPER_COORD_SCALE);
          const baseR = paperNodeRadius(paper.citation_count);
          const r = baseR * nodeScale;

          if (screen.x < -r * 3 || screen.x > w + r * 3 || screen.y < -r * 3 || screen.y > h + r * 3) continue;

          const isSelected = selectedPaper?.id === paper.id;
          const isHovered = hoveredPaper?.id === paper.id;

          // Glow on hover/selected
          if (isSelected || isHovered) {
            const glowR = r * 3;
            const gradient = ctx.createRadialGradient(
              screen.x, screen.y, r * 0.3,
              screen.x, screen.y, glowR
            );
            gradient.addColorStop(0, rgba(tcr, tcg, tcb, 0.3));
            gradient.addColorStop(1, rgba(tcr, tcg, tcb, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, glowR, 0, Math.PI * 2);
            ctx.fill();
          }

          // Core circle
          ctx.fillStyle = rgba(tcr, tcg, tcb, 0.9);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
          ctx.fill();

          // Selection ring
          if (isSelected) {
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = Math.max(1, 2 * nodeScale);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, r + 3 * nodeScale, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Labels — show paper titles when zoomed in
          if (showLabels) {
            const fontSize = Math.max(5, (isSelected || isHovered ? 9 : 7) * (labelScale / 1.5));
            const textAlpha = isSelected || isHovered ? 0.95 : labelAlpha * 0.65;
            ctx.fillStyle = rgba(255, 255, 255, textAlpha);
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            // Truncate long titles
            const maxChars = Math.max(14, Math.floor(40 * labelScale));
            const label = paper.title.length > maxChars ? paper.title.slice(0, maxChars) + "..." : paper.title;
            ctx.fillText(label, screen.x, screen.y + r + 2 + fontSize);
          }
        }

        // Hover tooltip when labels hidden
        if (hoveredPaper && !showLabels) {
          const hs = paperToScreen(hoveredPaper.x * PAPER_COORD_SCALE, hoveredPaper.y * PAPER_COORD_SCALE);
          const text = hoveredPaper.title.length > 60 ? hoveredPaper.title.slice(0, 60) + "..." : hoveredPaper.title;
          ctx.font = "11px Inter, system-ui, sans-serif";
          const tw = ctx.measureText(text).width;
          const pad = 8;
          const bx = hs.x - tw / 2 - pad;
          const by = hs.y - 28;

          ctx.fillStyle = "rgba(15,23,42,0.92)";
          ctx.beginPath();
          ctx.roundRect(bx, by - 4, tw + pad * 2, 22, 5);
          ctx.fill();
          ctx.strokeStyle = "rgba(100,116,139,0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#e2e8f0";
          ctx.textAlign = "center";
          ctx.fillText(text, hs.x, by + 12);
        }
      } else {
        // =====================================================================
        // TOPIC VIEW RENDERING (original)
        // =====================================================================
        const v = viewRef.current;
        const zoom = v.zoom;

        if (continentRegions.length > 0) {
          const strokeWidth = Math.max(0.6, 1.1 / Math.sqrt(zoom));
          for (const region of continentRegions) {
            const screenPoints = region.points.map((p) => worldToScreen(p.x, p.y));
            if (screenPoints.length < 3) continue;

            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (const p of screenPoints) {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            }
            if (maxX < -40 || minX > w + 40 || maxY < -40 || minY > h + 40) continue;

            const [r, g, b] = hexToRgb(region.color);
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
              ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = rgba(r, g, b, 0.07);
            ctx.fill();
            ctx.strokeStyle = rgba(r, g, b, 0.2);
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            if (zoom > 0.18) {
              const centroid = worldToScreen(region.centroid.x, region.centroid.y);
              if (centroid.x >= -60 && centroid.x <= w + 60 && centroid.y >= -20 && centroid.y <= h + 20) {
                const labelSize = clamp(10 + Math.log10(region.count + 1), 10, 13);
                ctx.font = `${labelSize}px Inter, system-ui, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = rgba(r, g, b, 0.7);
                ctx.fillText(region.label, centroid.x, centroid.y);
              }
            }
          }
        }

        // Draw edges
        if (visibleEdges.length < 80000) {
          const baseAlpha = clamp(0.03 + zoom * 0.005, 0.01, 0.12);
          ctx.lineWidth = Math.max(0.3, 0.4 / Math.sqrt(zoom));

          for (const edge of visibleEdges) {
            const a = topicById.get(edge.topic_a_id);
            const b = topicById.get(edge.topic_b_id);
            if (!a || !b) continue;

            const aw = getTopicWorldPosition(a.id);
            const bw = getTopicWorldPosition(b.id);
            const sa = worldToScreen(aw.x, aw.y);
            const sb = worldToScreen(bw.x, bw.y);

            if (
              Math.max(sa.x, sb.x) < -50 || Math.min(sa.x, sb.x) > w + 50 ||
              Math.max(sa.y, sb.y) < -50 || Math.min(sa.y, sb.y) > h + 50
            ) continue;

            const fieldA = subfieldToField.get(a.subfield_id) || "";
            const fieldB = subfieldToField.get(b.subfield_id) || "";
            const sameField = fieldA === fieldB;
            const edgeColor = sameField ? getFieldColor(fieldA) : "#64748b";
            const [er, eg, eb] = hexToRgb(edgeColor);
            const alpha = baseAlpha * (sameField ? 1 : 0.5) * clamp(edge.similarity, 0.3, 1);

            ctx.strokeStyle = rgba(er, eg, eb, alpha);
            ctx.beginPath();
            ctx.moveTo(sa.x, sa.y);
            ctx.lineTo(sb.x, sb.y);
            ctx.stroke();
          }
        }

        // Draw nodes
        const relZoom = zoom / (baseZoomRef.current || 1);
        // Keep node size proportional to zoom without flattening at low zoom.
        const nodeScale = Math.max(relZoom, 0.001);
        const labelScale = Math.sqrt(Math.max(relZoom, 0.001));
        const showLabels = labelScale > 2.5;
        const labelAlpha = clamp((labelScale - 2.5) / 1.5, 0, 0.9);

        for (const topic of visibleTopics) {
          const worldPos = getTopicWorldPosition(topic.id);
          const sx = worldPos.x;
          const sy = worldPos.y;
          const screen = worldToScreen(sx, sy);

          const baseR = nodeRadius(topic.works_count);
          const r = baseR * nodeScale;

          if (screen.x < -r * 3 || screen.x > w + r * 3 || screen.y < -r * 3 || screen.y > h + r * 3) continue;

          const fieldId = subfieldToField.get(topic.subfield_id) || "";
          const color = getFieldColor(fieldId);
          const [cr, cg, cb] = hexToRgb(color);
          const isSelected = selectedTopic?.id === topic.id;
          const isHovered = hoveredTopic?.id === topic.id;

          if (isSelected || isHovered) {
            const glowR = r * 3;
            const gradient = ctx.createRadialGradient(
              screen.x, screen.y, r * 0.3,
              screen.x, screen.y, glowR
            );
            gradient.addColorStop(0, rgba(cr, cg, cb, 0.3));
            gradient.addColorStop(1, rgba(cr, cg, cb, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, glowR, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = rgba(cr, cg, cb, 0.9);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
          ctx.fill();

          if (isSelected) {
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = Math.max(1, 2 * nodeScale);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, r + 3 * nodeScale, 0, Math.PI * 2);
            ctx.stroke();
          }

          if (showLabels) {
            const fontSize = Math.max(5, (isSelected || isHovered ? 9 : 8) * (labelScale / 2.5));
            const textAlpha = isSelected || isHovered ? 0.95 : labelAlpha * 0.7;
            ctx.fillStyle = rgba(255, 255, 255, textAlpha);
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(topic.display_name, screen.x, screen.y + r + 2 + fontSize);
          }
        }

        // Hover tooltip when labels hidden
        if (hoveredTopic && !showLabels) {
          const hoverPos = getTopicWorldPosition(hoveredTopic.id);
          const hs = worldToScreen(hoverPos.x, hoverPos.y);
          const text = hoveredTopic.display_name;
          ctx.font = "11px Inter, system-ui, sans-serif";
          const tw = ctx.measureText(text).width;
          const pad = 8;
          const bx = hs.x - tw / 2 - pad;
          const by = hs.y - 28;

          ctx.fillStyle = "rgba(15,23,42,0.92)";
          ctx.beginPath();
          ctx.roundRect(bx, by - 4, tw + pad * 2, 22, 5);
          ctx.fill();
          ctx.strokeStyle = "rgba(100,116,139,0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#e2e8f0";
          ctx.textAlign = "center";
          ctx.fillText(text, hs.x, by + 12);
        }
      }
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    dimensions,
    visibleTopics,
    visibleEdges,
    continentRegions,
    selectedTopic,
    hoveredTopic,
    subfieldToField,
    topicById,
    getTopicWorldPosition,
    worldToScreen,
    paperViewTopic,
    papers,
    paperEdges,
    selectedPaper,
    hoveredPaper,
    paperById,
    atlasLayoutMode,
  ]);

  useEffect(() => {
    needsRenderRef.current = true;
  }, [selectedTopic, hoveredTopic, activeDomainFilter, activeFieldFilter, continentMode, atlasLayoutMode, visibleTopics, selectedPaper, hoveredPaper, papers]);

  // Sidebar data
  const selectedSubfield = selectedTopic ? subfieldById.get(selectedTopic.subfield_id) : null;
  const selectedField = selectedSubfield ? fieldById.get(selectedSubfield.field_id) : null;
  const selectedDomain = selectedField ? domainById.get(selectedField.domain_id) : null;

  const selectedTopicEdges = useMemo(() => {
    if (!selectedTopic || !data) return [];
    return data.edges
      .filter((e) => e.topic_a_id === selectedTopic.id || e.topic_b_id === selectedTopic.id)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 15)
      .map((e) => {
        const otherId = e.topic_a_id === selectedTopic.id ? e.topic_b_id : e.topic_a_id;
        return { edge: e, other: topicById.get(otherId) };
      })
      .filter((e) => e.other != null) as Array<{ edge: AtlasEdge; other: AtlasTopic }>;
  }, [selectedTopic, data, topicById]);
  const topCitedPapers = useMemo(() => {
    return [...papers]
      .sort((a, b) => b.citation_count - a.citation_count)
      .slice(0, 25);
  }, [papers]);

  // ---------------------------------------------------------------------------
  // Loading / Error states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading Knowledge Atlas...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-screen bg-gray-950 text-white p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Atlas unavailable</h1>
        <p className="text-red-300">{error || "Failed to load data"}</p>
        <Link href="/dashboard" className="inline-flex px-3 py-1.5 rounded-md border border-gray-700 text-sm text-gray-200 hover:border-gray-500">
          Back to dashboard
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-2.5 flex items-center justify-between shrink-0 bg-gray-950/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm">&larr; Dashboard</Link>
          <div>
            <h1 className="text-base font-semibold">Knowledge Atlas</h1>
            <p className="text-[11px] text-gray-500">
              {paperViewTopic
                ? `${paperViewTopic.display_name} papers`
                : `${visibleTopics.length.toLocaleString()} topics`}
              {" "}
              &middot;{" "}
              {paperViewTopic
                ? `${papers.length.toLocaleString()} papers`
                : `${visibleEdges.length.toLocaleString()} connections`}
              {" "}
              &middot; {availableDomains.length.toLocaleString()} domains
            </p>
          </div>
        </div>
        {paperViewTopic ? (
          <button
            onClick={exitPaperView}
            className="px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900 text-xs text-gray-200 hover:border-gray-500"
          >
            &larr; Back to topics
          </button>
        ) : (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              needsRenderRef.current = true;
            }}
            placeholder="Search topics..."
            className="px-3 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none w-52"
          />
        )}
      </header>

      {/* Filter / breadcrumb bar */}
      {paperViewTopic ? (
        <div className="border-b border-gray-800 px-4 py-1.5 flex items-center justify-between gap-2 shrink-0 bg-gray-950/60">
          <div className="text-[11px] text-gray-400">
            Atlas &rarr; {paperViewTopic.display_name} &rarr; Top papers
          </div>
          {papersLoading ? (
            <span className="text-[11px] text-cyan-300">Loading papers...</span>
          ) : (
            <span className="text-[11px] text-gray-500">
              {papers.length.toLocaleString()} papers &middot; {paperEdges.length.toLocaleString()} links
            </span>
          )}
        </div>
      ) : (
        <div className="border-b border-gray-800 px-4 py-1.5 space-y-1.5 overflow-x-hidden shrink-0 bg-gray-950/60">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => {
                setActiveDomainFilter(null);
                needsRenderRef.current = true;
              }}
              className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                !activeDomainFilter ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              All domains
            </button>
            {availableDomains.map((domain) => (
              <button
                key={domain.id}
                onClick={() => {
                  setActiveDomainFilter(activeDomainFilter === domain.id ? null : domain.id);
                  needsRenderRef.current = true;
                }}
                className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                  activeDomainFilter === domain.id ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {domain.display_name} ({topicCountByDomain.get(domain.id) || 0})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => {
                setActiveFieldFilter(null);
                needsRenderRef.current = true;
              }}
              className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                !activeFieldFilter ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              All fields
            </button>
            {availableFields.map((field) => (
              <button
                key={field.id}
                onClick={() => {
                  setActiveFieldFilter(activeFieldFilter === field.id ? null : field.id);
                  needsRenderRef.current = true;
                }}
                className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap flex items-center gap-1 transition-colors ${
                  activeFieldFilter === field.id ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: getFieldColor(field.id) }} />
                {field.display_name} ({topicCountByField.get(field.id) || 0})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[11px] text-gray-500 shrink-0">Layout</span>
            {(["mixed", "islands", "islands-fields"] as AtlasLayoutMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setAtlasLayoutMode(mode);
                  needsRenderRef.current = true;
                }}
                className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                  atlasLayoutMode === mode ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {mode === "mixed" ? "Mixed" : mode === "islands" ? "Islands" : "Islands+Fields"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[11px] text-gray-500 shrink-0">Continents</span>
            {(["off", "field", "domain"] as ContinentMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setContinentMode(mode);
                  needsRenderRef.current = true;
                }}
                className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors ${
                  continentMode === mode ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {mode === "off" ? "Off" : mode === "field" ? "Fields" : "Domains"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main area: canvas + optional sidebar */}
      <div className="flex flex-1 min-h-0">
        <div ref={containerRef} className="flex-1 relative min-w-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />
        </div>

        {/* Sidebar */}
        {selectedTopic && !paperViewTopic && (
          <aside className="w-80 border-l border-gray-800 bg-gray-900/95 overflow-y-auto shrink-0 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold leading-tight">{selectedTopic.display_name}</h2>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {selectedField && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${getFieldColor(selectedField.id)}20`,
                        color: getFieldColor(selectedField.id),
                      }}
                    >
                      {selectedField.display_name}
                    </span>
                  )}
                  {selectedDomain && (
                    <span className="text-[10px] text-gray-500">{selectedDomain.display_name}</span>
                  )}
                  {selectedSubfield && (
                    <span className="text-[10px] text-gray-500">{selectedSubfield.display_name}</span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedTopic(null)} className="text-gray-500 hover:text-white text-lg leading-none">&times;</button>
            </div>

            {selectedTopic.description && (
              <p className="text-xs text-gray-400 leading-relaxed">{selectedTopic.description}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-gray-700 bg-gray-800/50 px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500 uppercase">Works</p>
                <p className="text-sm font-mono text-gray-200">{formatNumber(selectedTopic.works_count)}</p>
              </div>
              <div className="rounded-md border border-gray-700 bg-gray-800/50 px-2.5 py-1.5">
                <p className="text-[10px] text-gray-500 uppercase">Citations</p>
                <p className="text-sm font-mono text-gray-200">{formatNumber(selectedTopic.cited_by_count)}</p>
              </div>
            </div>

            <button
              onClick={() => void enterPaperView(selectedTopic)}
              disabled={papersLoading}
              className="w-full px-2.5 py-1.5 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-xs text-cyan-100 hover:border-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {papersLoading ? "Loading papers..." : "Enter Paper View"}
            </button>

            {selectedTopic.keywords.length > 0 && (
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Keywords</p>
                <div className="flex flex-wrap gap-1">
                  {selectedTopic.keywords.map((kw) => (
                    <span key={kw} className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-400">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedTopic.wikipedia_url && (
              <a
                href={selectedTopic.wikipedia_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2.5 py-1.5 rounded-md border border-gray-700 hover:border-blue-500/50 text-xs text-gray-300 transition-colors"
              >
                Wikipedia &rarr;
              </a>
            )}

            {selectedTopicEdges.length > 0 && (
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Most similar topics</p>
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {selectedTopicEdges.map(({ edge, other }) => {
                    const otherFieldId = subfieldToField.get(other.subfield_id) || "";
                    return (
                      <button
                        key={other.id}
                        onClick={() => setSelectedTopic(other)}
                        className="w-full text-left rounded-md border border-gray-700 bg-gray-800/30 px-2.5 py-1.5 hover:border-gray-500 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-200 truncate">{other.display_name}</span>
                          <span className="text-[10px] font-mono text-gray-500 shrink-0">
                            {(edge.similarity * 100).toFixed(0)}%
                          </span>
                        </div>
                        <span className="text-[10px]" style={{ color: getFieldColor(otherFieldId) }}>
                          {fieldById.get(otherFieldId)?.display_name || ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}

        {paperViewTopic && (
          <aside className="w-96 border-l border-gray-800 bg-gray-900/95 overflow-y-auto shrink-0 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Paper view</p>
                <h2 className="text-base font-semibold leading-tight">{paperViewTopic.display_name}</h2>
                <p className="mt-1 text-[11px] text-gray-500">
                  {papers.length.toLocaleString()} papers &middot; {paperEdges.length.toLocaleString()} semantic links
                </p>
              </div>
              <button onClick={exitPaperView} className="text-gray-500 hover:text-white text-lg leading-none">&times;</button>
            </div>

            {papersLoading && (
              <div className="rounded-md border border-cyan-600/40 bg-cyan-500/10 px-2.5 py-2 text-xs text-cyan-200">
                Loading top papers and SPECTER2 layout...
              </div>
            )}

            {selectedPaper && (
              <div className="rounded-md border border-gray-700 bg-gray-800/40 p-3 space-y-2">
                <p className="text-sm font-semibold leading-snug text-gray-100">{selectedPaper.title}</p>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
                  {selectedPaper.year && <span>{selectedPaper.year}</span>}
                  {selectedPaper.journal && <span>&middot; {selectedPaper.journal}</span>}
                  <span>&middot; {formatNumber(selectedPaper.citation_count)} citations</span>
                </div>
                {selectedPaper.abstract && (
                  <p className="text-[11px] leading-relaxed text-gray-400">
                    {selectedPaper.abstract.length > 440
                      ? `${selectedPaper.abstract.slice(0, 440)}...`
                      : selectedPaper.abstract}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {selectedPaper.doi && (
                    <a
                      href={`https://doi.org/${selectedPaper.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 rounded border border-gray-700 text-[11px] text-gray-300 hover:border-cyan-500/60"
                    >
                      DOI
                    </a>
                  )}
                  <a
                    href={openAlexWorkUrl(selectedPaper.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded border border-gray-700 text-[11px] text-gray-300 hover:border-cyan-500/60"
                  >
                    OpenAlex
                  </a>
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] text-gray-500 mb-1">Top cited papers</p>
              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                {topCitedPapers.map((paper) => (
                  <button
                    key={paper.id}
                    onClick={() => {
                      setSelectedPaper(paper);
                      needsRenderRef.current = true;
                    }}
                    className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                      selectedPaper?.id === paper.id
                        ? "border-cyan-500/70 bg-cyan-500/10"
                        : "border-gray-700 bg-gray-800/30 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-200 truncate">{paper.title}</span>
                      <span className="text-[10px] font-mono text-gray-500 shrink-0">
                        {formatNumber(paper.citation_count)}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {paper.year || "n/a"}{paper.journal ? ` · ${paper.journal}` : ""}
                    </div>
                  </button>
                ))}
                {topCitedPapers.length === 0 && !papersLoading && (
                  <p className="text-[11px] text-gray-500">No papers loaded for this topic yet.</p>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
