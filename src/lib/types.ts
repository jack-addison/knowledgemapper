export interface Interest {
  id: string;
  user_id: string;
  name: string;
  embedding: number[] | null;
  related_topics: string[];
  notes: string;
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

export interface Recommendation {
  name: string;
  reason: string;
}
