import { Interest, GraphData } from "./types";

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.2;
const CLUSTER_THRESHOLD = 0.35; // Higher threshold for same-cluster grouping

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

export function buildGraph(interests: Interest[], threshold?: number): GraphData {
  const simThreshold = threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const links: GraphData["links"] = [];
  const uf = createUnionFind(interests.length);

  for (let i = 0; i < interests.length; i++) {
    for (let j = i + 1; j < interests.length; j++) {
      const a = interests[i];
      const b = interests[j];

      if (!a.embedding || !b.embedding) continue;

      const similarity = cosineSimilarity(a.embedding, b.embedding);

      if (similarity >= simThreshold) {
        links.push({
          source: a.id,
          target: b.id,
          similarity,
        });
      }

      // Group into same cluster if strongly related
      if (similarity >= CLUSTER_THRESHOLD) {
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
