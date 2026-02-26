import { Interest, GraphData } from "./types";

const INVALID_SIMILARITY = -2;
export const BRIDGE_GUARD_MIN_NODES = 10;
export const BRIDGE_GUARD_TOP_K = 4;
const BRIDGE_GUARD_STRONG_DELTA = 0.12;
const BRIDGE_GUARD_STRONG_FLOOR = 0.58;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return INVALID_SIMILARITY;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return INVALID_SIMILARITY;
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  if (!Number.isFinite(similarity)) {
    return INVALID_SIMILARITY;
  }

  return Math.max(-1, Math.min(1, similarity));
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.34;
export const DEFAULT_CLUSTER_THRESHOLD = 0.42; // Higher threshold for same-cluster grouping

interface BuildGraphOptions {
  similarityThreshold?: number;
  clusterThreshold?: number;
}

function buildSimilarityMatrix(interests: Interest[]): number[][] {
  const n = interests.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(INVALID_SIMILARITY));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = interests[i].embedding;
      const b = interests[j].embedding;
      const similarity = a && b ? cosineSimilarity(a, b) : INVALID_SIMILARITY;
      matrix[i][j] = similarity;
      matrix[j][i] = similarity;
    }
  }

  return matrix;
}

export function buildTopNeighborSets(
  similarities: number[][],
  topK: number
): Array<Set<number>> {
  const n = similarities.length;
  const sets: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
  const cappedK = Math.max(1, Math.min(topK, Math.max(1, n - 1)));

  for (let i = 0; i < n; i++) {
    const candidates: Array<{ index: number; similarity: number }> = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const similarity = similarities[i][j];
      if (similarity <= 0 || similarity === INVALID_SIMILARITY) continue;
      candidates.push({ index: j, similarity });
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    for (const neighbor of candidates.slice(0, cappedK)) {
      sets[i].add(neighbor.index);
    }
  }

  return sets;
}

export function shouldKeepEdge(
  similarity: number,
  threshold: number,
  i: number,
  j: number,
  topNeighborSets: Array<Set<number>> | null
): boolean {
  if (similarity === INVALID_SIMILARITY || similarity < threshold) {
    return false;
  }

  if (!topNeighborSets) {
    return true;
  }

  const strongBypassThreshold = Math.max(
    BRIDGE_GUARD_STRONG_FLOOR,
    Math.min(0.9, threshold + BRIDGE_GUARD_STRONG_DELTA)
  );
  if (similarity >= strongBypassThreshold) {
    return true;
  }

  return topNeighborSets[i].has(j) && topNeighborSets[j].has(i);
}

// Union-Find for clustering
function createUnionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) {
      parent[ra] = rb;
    } else if (rank[ra] > rank[rb]) {
      parent[rb] = ra;
    } else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }

  return { find, union };
}

export function buildGraph(
  interests: Interest[],
  options?: BuildGraphOptions
): GraphData {
  const simThreshold =
    options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const clusterThreshold =
    options?.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const links: GraphData["links"] = [];
  const uf = createUnionFind(interests.length);
  const similarities = buildSimilarityMatrix(interests);
  const useBridgeGuard = interests.length >= BRIDGE_GUARD_MIN_NODES;
  const topNeighborSets = useBridgeGuard
    ? buildTopNeighborSets(similarities, BRIDGE_GUARD_TOP_K)
    : null;

  for (let i = 0; i < interests.length; i++) {
    for (let j = i + 1; j < interests.length; j++) {
      const similarity = similarities[i][j];

      if (shouldKeepEdge(similarity, simThreshold, i, j, topNeighborSets)) {
        links.push({
          source: interests[i].id,
          target: interests[j].id,
          similarity,
        });
      }

      // Group into same cluster if strongly related
      if (shouldKeepEdge(similarity, clusterThreshold, i, j, topNeighborSets)) {
        uf.union(i, j);
      }
    }
  }

  // Map root indices to sequential cluster IDs
  const rootToCluster = new Map<number, number>();
  let nextCluster = 0;
  const nodes = interests.map((interest, i) => {
    const root = uf.find(i);
    if (!rootToCluster.has(root)) {
      rootToCluster.set(root, nextCluster++);
    }
    return {
      id: interest.id,
      name: interest.name,
      cluster: rootToCluster.get(root)!,
    };
  });

  return { nodes, links };
}
