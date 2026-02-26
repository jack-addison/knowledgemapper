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
}

export interface GraphNode {
  id: string;
  name: string;
  cluster: number;
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
}

export interface SavedInterestEvidence extends EvidenceSource {
  id: string;
  source_provider: string;
  created_at: string;
}

export interface EdgeNotesRecord {
  notes: string;
  updated_at: string | null;
}

export interface Recommendation {
  name: string;
  reason: string;
}
