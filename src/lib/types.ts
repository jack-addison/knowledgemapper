export type GraphLayoutMode = "classic" | "umap" | "pca3d";
export type GraphRenderMode = "2d" | "3d";

export interface Interest {
  id: string;
  user_id: string;
  map_id: string;
  name: string;
  embedding: number[] | null;
  related_topics: string[];
  notes: string;
  created_at: string;
}

export interface KnowledgeMap {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  is_public?: boolean;
  share_slug?: string | null;
  shared_at?: string | null;
  role?: "owner" | "editor" | "viewer";
  can_edit?: boolean;
  can_manage?: boolean;
}

export interface GraphNode {
  id: string;
  name: string;
  cluster: number;
  embedding?: number[] | null;
}

export interface GraphLink {
  source: string;
  target: string;
  similarity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphLinkSelection {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  similarity: number;
}

export interface EvidenceSource {
  title: string;
  year: number | null;
  url: string;
  journal: string;
  authors: string[];
  reason: string;
  sourceProvider?: string;
}

export interface EdgeEvidence {
  query: string;
  summary: string;
  sources: EvidenceSource[];
  generatedAt: string;
}

export interface TopicEvidence {
  topic: string;
  summary: string;
  sources: EvidenceSource[];
  generatedAt: string;
}

export interface SavedEdgeEvidence extends EvidenceSource {
  id: string;
  source_provider: string;
  created_at: string;
  map_id?: string;
  interest_a_id?: string;
  interest_b_id?: string;
}

export interface SavedInterestEvidence extends EvidenceSource {
  id: string;
  source_provider: string;
  created_at: string;
  map_id?: string;
  interest_id?: string;
}

export interface EdgeNotesRecord {
  notes: string;
  updated_at: string | null;
}

export interface TdaThresholdSample {
  threshold: number;
  edgeCount: number;
  componentCount: number;
  largestComponentRatio: number;
  cycleRank: number;
}

export interface TdaMapHealth {
  nodeCount: number;
  embeddedNodeCount: number;
  analyzedNodeCount: number;
  embeddingDimension: number | null;
  edgeCountAtDefault: number;
  componentCountAtDefault: number;
  largestComponentRatioAtDefault: number;
  cycleRankAtDefault: number;
  fragmentationIndex: number;
  stabilityScore: number;
  recommendedSimilarityThreshold: number | null;
  recommendedClusterThreshold: number | null;
  recommendedLinkForceScale: number | null;
  recommendationReason: string;
  clusterRecommendationReason: string;
  linkForceRecommendationReason: string;
  samples: TdaThresholdSample[];
  computedAt: string;
}

export interface Recommendation {
  name: string;
  reason: string;
}

export interface SharedEdgeNote {
  interest_a_id: string;
  interest_b_id: string;
  notes: string;
  updated_at: string | null;
}

export interface SharedMapSnapshot {
  map: {
    id: string;
    name: string;
    share_slug: string;
    shared_at: string | null;
    created_at: string;
  };
  interests: Interest[];
  interestEvidence: SavedInterestEvidence[];
  edgeEvidence: SavedEdgeEvidence[];
  edgeNotes: SharedEdgeNote[];
}

export type GraphAssistantScope = "map" | "node" | "edge";
export type GraphAssistantMode = "grounded" | "general";

export type GraphAssistantCitationType = "node" | "edge" | "paper";

export interface GraphAssistantCitation {
  id: string;
  type: GraphAssistantCitationType;
  label: string;
  snippet: string;
  url?: string | null;
  paperTitle?: string;
  year?: number | null;
  journal?: string;
  authors?: string[];
  reason?: string;
  sourceProvider?: string;
  nodeId?: string;
  interestAId?: string;
  interestBId?: string;
}

export interface GraphAssistantQueryRequest {
  mapId: string;
  scope: GraphAssistantScope;
  assistantMode?: GraphAssistantMode;
  question: string;
  nodeId?: string;
  interestAId?: string;
  interestBId?: string;
  edgeSimilarity?: number | null;
  allowExternalPapers?: boolean;
}

export interface GraphAssistantQueryResponse {
  answer: string;
  scope: GraphAssistantScope;
  assistantMode: GraphAssistantMode;
  citations: GraphAssistantCitation[];
  insufficientEvidence: boolean;
  suggestedFollowups: string[];
  contextCount: number;
  externalPaperCount?: number;
  generatedAt: string;
}

export interface GraphAssistantBuildMapRequest {
  prompt: string;
  maxTopics?: number;
}

export interface GraphAssistantBuildMapResponse {
  mapId: string;
  mapName: string;
  requestedPrompt: string;
  topicCount: number;
  createdCount: number;
  skippedCount: number;
  topics: string[];
}

export interface GraphAssistantExtendMapRequest {
  mapId: string;
  prompt: string;
  maxTopics?: number;
}

export interface GraphAssistantExtendMapResponse {
  mapId: string;
  mapName: string;
  requestedPrompt: string;
  existingTopicCount: number;
  topicCount: number;
  createdCount: number;
  skippedCount: number;
  topics: string[];
}

export interface GraphAssistantExtractPaperResponse {
  mapId: string;
  mapName: string;
  fileName: string;
  paperTitle: string;
  paperContextId?: string | null;
  topicCount: number;
  createdCount: number;
  skippedCount: number;
  topics: string[];
}
