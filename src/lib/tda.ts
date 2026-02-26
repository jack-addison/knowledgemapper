import {
  BRIDGE_GUARD_MIN_NODES,
  BRIDGE_GUARD_TOP_K,
  buildTopNeighborSets,
  DEFAULT_SIMILARITY_THRESHOLD,
  shouldKeepEdge,
} from "./graph";
import { Interest, TdaMapHealth, TdaThresholdSample } from "./types";

const DEFAULT_THRESHOLDS = [0.15, 0.2, 0.25, 0.3, 0.34, 0.4, 0.45, 0.5, 0.55, 0.6];
const DEFAULT_CLUSTER_THRESHOLD = 0.42;
const DEFAULT_LINK_FORCE_SCALE = 3;

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxEdgeCount(nodeCount: number): number {
  return (nodeCount * (nodeCount - 1)) / 2;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toValidEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const vector = value.filter((v) => typeof v === "number" && Number.isFinite(v));
  return vector.length === value.length ? vector : null;
}

function dominantDimension(vectors: number[][]): number | null {
  if (vectors.length === 0) return null;
  const counts = new Map<number, number>();
  for (const vector of vectors) {
    counts.set(vector.length, (counts.get(vector.length) || 0) + 1);
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

function computeSample(
  similarities: number[][],
  threshold: number,
  topNeighborSets: Array<Set<number>> | null
): TdaThresholdSample {
  const n = similarities.length;
  const uf = new UnionFind(n);
  let edgeCount = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldKeepEdge(similarities[i][j], threshold, i, j, topNeighborSets)) {
        edgeCount++;
        uf.union(i, j);
      }
    }
  }

  const componentSizes = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    componentSizes.set(root, (componentSizes.get(root) || 0) + 1);
  }

  const componentCount = componentSizes.size;
  const largestComponent = Math.max(...Array.from(componentSizes.values()));
  const largestComponentRatio = n > 0 ? largestComponent / n : 0;
  const cycleRank = Math.max(0, edgeCount - n + componentCount);

  return {
    threshold: round(threshold, 2),
    edgeCount,
    componentCount,
    largestComponentRatio: round(largestComponentRatio, 3),
    cycleRank,
  };
}

function findNearestSample(
  samples: TdaThresholdSample[],
  target: number
): TdaThresholdSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, sample) => {
    if (!best) return sample;
    const bestDiff = Math.abs(best.threshold - target);
    const sampleDiff = Math.abs(sample.threshold - target);
    return sampleDiff < bestDiff ? sample : best;
  }, null as TdaThresholdSample | null);
}

function computeStability(samples: TdaThresholdSample[], n: number): number {
  if (samples.length <= 1 || n <= 1) return 0;

  let componentJump = 0;
  const ratios: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    ratios.push(samples[i].largestComponentRatio);
    if (i > 0) {
      componentJump += Math.abs(
        samples[i].componentCount - samples[i - 1].componentCount
      );
    }
  }

  const maxPossibleJump = Math.max(1, (n - 1) * (samples.length - 1));
  const componentStability = clamp(1 - componentJump / maxPossibleJump, 0, 1);

  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const variance =
    ratios.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ratios.length;
  const stdDev = Math.sqrt(variance);
  const ratioStability = clamp(1 - stdDev / 0.5, 0, 1);

  return Math.round((componentStability * 0.65 + ratioStability * 0.35) * 100);
}

function recommendThreshold(
  samples: TdaThresholdSample[],
  nodeCount: number
): { threshold: number | null; reason: string; sample: TdaThresholdSample | null } {
  if (samples.length === 0 || nodeCount < 3) {
    return {
      threshold: null,
      reason: "Add more embedded topics to compute a stable threshold recommendation.",
      sample: null,
    };
  }

  const targetLargestRatio =
    nodeCount >= 24 ? 0.8 : nodeCount >= 12 ? 0.75 : 0.7;
  const targetFragmentation =
    nodeCount >= 24 ? 0.12 : nodeCount >= 12 ? 0.18 : 0.22;
  const targetEdgeDensity = 0.08;
  const maxEdges = Math.max(1, maxEdgeCount(nodeCount));

  const scored = samples.map((sample) => {
    const fragmentation = sample.componentCount / nodeCount;
    const edgeDensity = sample.edgeCount / maxEdges;
    const cyclePenalty = sample.cycleRank / Math.max(1, nodeCount);
    const singleComponentPenalty =
      nodeCount >= BRIDGE_GUARD_MIN_NODES && sample.componentCount === 1 ? 0.2 : 0;
    const score =
      1 -
      Math.abs(sample.largestComponentRatio - targetLargestRatio) * 0.9 -
      Math.abs(fragmentation - targetFragmentation) * 0.9 -
      Math.abs(edgeDensity - targetEdgeDensity) * 0.7 -
      cyclePenalty * 0.08 -
      singleComponentPenalty;

    return { sample, score, fragmentation, edgeDensity };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  let reason = "Balances local structure without forcing unrelated regions into one graph.";
  if (best.sample.componentCount === 1 && nodeCount >= BRIDGE_GUARD_MIN_NODES) {
    reason =
      "This threshold avoids collapsing the map into a single over-merged component.";
  } else if (best.fragmentation > 0.3) {
    reason = "A slightly lower threshold should reduce over-fragmentation.";
  } else if (best.edgeDensity > 0.18) {
    reason = "A slightly higher threshold should remove weaker bridge links.";
  } else if (best.sample.threshold > DEFAULT_SIMILARITY_THRESHOLD + 0.03) {
    reason = "A slightly higher threshold should reduce noisy cross-domain links.";
  } else if (best.sample.threshold < DEFAULT_SIMILARITY_THRESHOLD - 0.03) {
    reason = "A slightly lower threshold should preserve meaningful neighborhood continuity.";
  }

  return {
    threshold: best.sample.threshold,
    reason,
    sample: best.sample,
  };
}

function recommendClusterThreshold(
  similarityThreshold: number | null,
  sample: TdaThresholdSample | null,
  nodeCount: number
): { threshold: number | null; reason: string } {
  if (similarityThreshold === null || !sample || nodeCount < 3) {
    return {
      threshold: null,
      reason:
        "Cluster recommendation becomes available after enough aligned embeddings are present.",
    };
  }

  const edgeDensity = sample.edgeCount / Math.max(1, maxEdgeCount(nodeCount));
  const fragmentation = sample.componentCount / Math.max(1, nodeCount);
  const cyclePressure = sample.cycleRank / Math.max(1, nodeCount);
  const clusterOffset = DEFAULT_CLUSTER_THRESHOLD - DEFAULT_SIMILARITY_THRESHOLD;

  let threshold = similarityThreshold + clusterOffset;
  threshold += (edgeDensity - 0.16) * 0.12;
  threshold += cyclePressure * 0.06;
  threshold -= (fragmentation - 0.24) * 0.09;
  threshold = clamp(threshold, 0.2, 0.7);

  let reason =
    "Cluster threshold is kept slightly above similarity to color-group stronger local neighborhoods.";
  if (fragmentation > 0.35) {
    reason =
      "A slightly lower cluster threshold should keep related islands in the same color group.";
  } else if (edgeDensity > 0.22 || cyclePressure > 0.55) {
    reason =
      "A slightly higher cluster threshold should separate dense neighborhoods into cleaner color groups.";
  }

  return { threshold: round(threshold, 2), reason };
}

function recommendLinkForceScale(
  sample: TdaThresholdSample | null,
  nodeCount: number,
  stabilityScore: number
): { scale: number | null; reason: string } {
  if (!sample || nodeCount < 3) {
    return {
      scale: null,
      reason:
        "Link pull recommendation becomes available after enough aligned embeddings are present.",
    };
  }

  const edgeDensity = sample.edgeCount / Math.max(1, maxEdgeCount(nodeCount));
  const fragmentation = sample.componentCount / Math.max(1, nodeCount);
  const cyclePressure = sample.cycleRank / Math.max(1, nodeCount);
  const instability = 1 - clamp(stabilityScore / 100, 0, 1);

  let scale = DEFAULT_LINK_FORCE_SCALE;
  scale += fragmentation * 0.8;
  scale += instability * 0.2;
  scale -= edgeDensity * 0.9;
  scale -= cyclePressure * 0.4;
  scale = clamp(scale, 0.5, 3);

  let reason =
    "Balanced link pull keeps connected topics close while preserving room for structure.";
  if (fragmentation > 0.35) {
    reason = "Stronger link pull should help fragmented areas stay spatially coherent.";
  } else if (edgeDensity > 0.25 || cyclePressure > 0.6) {
    reason =
      "Slightly lighter link pull should reduce overlap in dense, highly cyclic regions.";
  }

  return { scale: round(scale, 2), reason };
}

export function computeTdaMapHealth(interests: Interest[]): TdaMapHealth {
  const nodeCount = interests.length;
  const embeddings = interests
    .map((interest) => toValidEmbedding(interest.embedding))
    .filter((embedding): embedding is number[] => Boolean(embedding));
  const embeddedNodeCount = embeddings.length;

  const dimension = dominantDimension(embeddings);
  const alignedEmbeddings =
    dimension === null ? [] : embeddings.filter((embedding) => embedding.length === dimension);
  const analyzedNodeCount = alignedEmbeddings.length;

  if (analyzedNodeCount < 2) {
    return {
      nodeCount,
      embeddedNodeCount,
      analyzedNodeCount,
      embeddingDimension: dimension,
      edgeCountAtDefault: 0,
      componentCountAtDefault: analyzedNodeCount,
      largestComponentRatioAtDefault: analyzedNodeCount === 0 ? 0 : 1,
      cycleRankAtDefault: 0,
      fragmentationIndex: analyzedNodeCount === 0 ? 1 : round(1 / analyzedNodeCount, 3),
      stabilityScore: 0,
      recommendedSimilarityThreshold: null,
      recommendedClusterThreshold: null,
      recommendedLinkForceScale: null,
      recommendationReason:
        "Not enough aligned embeddings to run topology analysis yet.",
      clusterRecommendationReason:
        "Not enough aligned embeddings to run topology analysis yet.",
      linkForceRecommendationReason:
        "Not enough aligned embeddings to run topology analysis yet.",
      samples: [],
      computedAt: new Date().toISOString(),
    };
  }

  const similarities = Array.from({ length: analyzedNodeCount }, () =>
    new Array(analyzedNodeCount).fill(0)
  );
  for (let i = 0; i < analyzedNodeCount; i++) {
    similarities[i][i] = 1;
    for (let j = i + 1; j < analyzedNodeCount; j++) {
      const similarity = clamp(cosineSimilarity(alignedEmbeddings[i], alignedEmbeddings[j]), -1, 1);
      similarities[i][j] = similarity;
      similarities[j][i] = similarity;
    }
  }

  const topNeighborSets =
    analyzedNodeCount >= BRIDGE_GUARD_MIN_NODES
      ? buildTopNeighborSets(similarities, BRIDGE_GUARD_TOP_K)
      : null;

  const samples = DEFAULT_THRESHOLDS.map((threshold) =>
    computeSample(similarities, threshold, topNeighborSets)
  );
  const atDefault =
    findNearestSample(samples, DEFAULT_SIMILARITY_THRESHOLD) || samples[0];
  const stabilityScore = computeStability(samples, analyzedNodeCount);
  const recommendation = recommendThreshold(samples, analyzedNodeCount);
  const clusterRecommendation = recommendClusterThreshold(
    recommendation.threshold,
    recommendation.sample,
    analyzedNodeCount
  );
  const linkForceRecommendation = recommendLinkForceScale(
    recommendation.sample,
    analyzedNodeCount,
    stabilityScore
  );

  return {
    nodeCount,
    embeddedNodeCount,
    analyzedNodeCount,
    embeddingDimension: dimension,
    edgeCountAtDefault: atDefault.edgeCount,
    componentCountAtDefault: atDefault.componentCount,
    largestComponentRatioAtDefault: atDefault.largestComponentRatio,
    cycleRankAtDefault: atDefault.cycleRank,
    fragmentationIndex: round(atDefault.componentCount / analyzedNodeCount, 3),
    stabilityScore,
    recommendedSimilarityThreshold: recommendation.threshold,
    recommendedClusterThreshold: clusterRecommendation.threshold,
    recommendedLinkForceScale: linkForceRecommendation.scale,
    recommendationReason: recommendation.reason,
    clusterRecommendationReason: clusterRecommendation.reason,
    linkForceRecommendationReason: linkForceRecommendation.reason,
    samples,
    computedAt: new Date().toISOString(),
  };
}
