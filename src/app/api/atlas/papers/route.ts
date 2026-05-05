import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { UMAP } from "umap-js";

const PAPERS_PER_TOPIC = 100;
const SIMILARITY_THRESHOLD = 0.5;
const MIN_PAPER_NEIGHBORS = 2;
const S2_BATCH_SIZE = 16; // Semantic Scholar batch limit
const S2_DELAY_MS = 1100; // >1s for unauthenticated rate limit
const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

function normalizeEdgePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parseStoredVector(value: unknown): number[] | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    const arr = value.filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
    return arr.length > 0 ? arr : null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const arr = parsed.filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
        return arr.length > 0 ? arr : null;
      }
    } catch {
      const trimmed = value.trim().replace(/^\[|\]$/g, "");
      if (!trimmed) return null;
      const arr = trimmed
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((v) => Number.isFinite(v));
      return arr.length > 0 ? arr : null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// OpenAlex: fetch top papers for a topic
// ---------------------------------------------------------------------------

interface OpenAlexWork {
  id: string;
  title: string;
  doi: string | null;
  publication_year: number | null;
  cited_by_count: number;
  primary_location?: {
    source?: { display_name?: string };
  };
  abstract_inverted_index?: Record<string, number[]>;
}

type SemanticScholarEmbedding = {
  vector?: number[];
};

type SemanticScholarBatchItem = {
  paperId?: string;
  embedding?: SemanticScholarEmbedding;
  // Some responses use model-keyed embedding objects.
  embeddings?: Record<string, number[] | SemanticScholarEmbedding | undefined>;
};

function reconstructAbstract(inverted: Record<string, number[]> | undefined): string | null {
  if (!inverted) return null;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) words.push([pos, word]);
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ");
}

function extractOpenAlexId(fullId: string): string {
  // "https://openalex.org/W12345" -> "W12345"
  return fullId.split("/").pop() || fullId;
}

async function fetchTopPapers(topicId: string): Promise<Array<{
  id: string; title: string; abstract: string | null; year: number | null;
  doi: string | null; journal: string | null; citation_count: number;
}>> {
  // OpenAlex topic IDs in our DB are like "T14423", API expects the full URL format
  const numericId = topicId.replace("T", "");
  const url = `https://api.openalex.org/works?filter=topics.id:T${numericId}&sort=cited_by_count:desc&per_page=${PAPERS_PER_TOPIC}&select=id,title,doi,publication_year,cited_by_count,primary_location,abstract_inverted_index`;

  const res = await fetch(url, {
    headers: { "User-Agent": "KnowledgeMapper/1.0 (mailto:contact@knowledgemapper.app)" },
  });
  if (!res.ok) throw new Error(`OpenAlex error: ${res.status} ${await res.text()}`);
  const json = await res.json();

  return (json.results as OpenAlexWork[]).map((w) => ({
    id: extractOpenAlexId(w.id),
    title: w.title || "Untitled",
    abstract: reconstructAbstract(w.abstract_inverted_index),
    year: w.publication_year,
    doi: w.doi?.replace("https://doi.org/", "") || null,
    journal: w.primary_location?.source?.display_name || null,
    citation_count: w.cited_by_count || 0,
  }));
}

// ---------------------------------------------------------------------------
// Semantic Scholar: get SPECTER2 embeddings via batch endpoint
// ---------------------------------------------------------------------------

async function fetchSpecter2Embeddings(
  papers: Array<{ id: string; doi: string | null; title: string }>
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();

  // Group papers with DOIs into batches
  const papersWithDois = papers.filter((p) => p.doi);
  const batches: typeof papersWithDois[] = [];
  for (let i = 0; i < papersWithDois.length; i += S2_BATCH_SIZE) {
    batches.push(papersWithDois.slice(i, i + S2_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (i > 0) await sleep(S2_DELAY_MS);

    try {
      const ids = batch.map((p) => `DOI:${p.doi}`);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (S2_API_KEY) {
        headers["x-api-key"] = S2_API_KEY;
      }
      const res = await fetch("https://api.semanticscholar.org/graph/v1/paper/batch", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ids,
          fields: "paperId,embedding,embeddings",
        }),
      });

      if (!res.ok) {
        console.warn(`S2 batch error (${res.status}), skipping batch ${i + 1}/${batches.length}`);
        continue;
      }

      const results = (await res.json()) as SemanticScholarBatchItem[];
      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        const vector = extractSpecter2Vector(result);
        if (vector) {
          embeddings.set(batch[j].id, vector);
        }
      }
    } catch (err) {
      console.warn(`S2 batch ${i + 1} failed:`, err);
    }
  }

  return embeddings;
}

function extractSpecter2Vector(item: SemanticScholarBatchItem | null | undefined): number[] | null {
  if (!item) return null;

  const fromEmbedding = item.embedding?.vector;
  if (Array.isArray(fromEmbedding) && fromEmbedding.length > 0) {
    return fromEmbedding.filter((v) => typeof v === "number" && Number.isFinite(v));
  }

  const embeddingsObj = item.embeddings;
  if (embeddingsObj && typeof embeddingsObj === "object") {
    const direct = embeddingsObj["specter_v2"];
    if (Array.isArray(direct) && direct.length > 0) {
      return direct.filter((v) => typeof v === "number" && Number.isFinite(v));
    }
    if (direct && typeof direct === "object" && Array.isArray((direct as SemanticScholarEmbedding).vector)) {
      const nested = (direct as SemanticScholarEmbedding).vector!;
      return nested.filter((v) => typeof v === "number" && Number.isFinite(v));
    }

    for (const value of Object.values(embeddingsObj)) {
      if (Array.isArray(value) && value.length > 0) {
        return value.filter((v) => typeof v === "number" && Number.isFinite(v));
      }
      if (value && typeof value === "object" && Array.isArray((value as SemanticScholarEmbedding).vector)) {
        const nested = (value as SemanticScholarEmbedding).vector!;
        return nested.filter((v) => typeof v === "number" && Number.isFinite(v));
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// UMAP layout
// ---------------------------------------------------------------------------

function computeUmapLayout(
  papers: Array<{ id: string }>,
  embeddings: Map<string, number[]>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Only layout papers that have embeddings
  const papersWithEmbeddings = papers.filter((p) => embeddings.has(p.id));
  if (papersWithEmbeddings.length < 3) {
    // Not enough for UMAP, place in a line
    papersWithEmbeddings.forEach((p, i) => {
      positions.set(p.id, { x: i * 2, y: 0 });
    });
    // Papers without embeddings get random positions
    papers.filter((p) => !embeddings.has(p.id)).forEach((p) => {
      positions.set(p.id, { x: Math.random() * 10 - 5, y: Math.random() * 10 - 5 });
    });
    return positions;
  }

  const vectors = papersWithEmbeddings.map((p) => embeddings.get(p.id)!);

  const umap = new UMAP({
    nNeighbors: Math.min(15, Math.floor(vectors.length / 2)),
    minDist: 0.1,
    nComponents: 2,
    spread: 1.0,
  });

  const coords = umap.fit(vectors);

  papersWithEmbeddings.forEach((p, i) => {
    positions.set(p.id, { x: coords[i][0], y: coords[i][1] });
  });

  // Papers without embeddings get positions near the centroid with jitter
  const allX = coords.map((c) => c[0]);
  const allY = coords.map((c) => c[1]);
  const cx = allX.reduce((a, b) => a + b, 0) / allX.length;
  const cy = allY.reduce((a, b) => a + b, 0) / allY.length;

  papers.filter((p) => !embeddings.has(p.id)).forEach((p) => {
    positions.set(p.id, {
      x: cx + (Math.random() - 0.5) * 2,
      y: cy + (Math.random() - 0.5) * 2,
    });
  });

  return positions;
}

// ---------------------------------------------------------------------------
// Compute edges from embeddings
// ---------------------------------------------------------------------------

function computeEdges(
  papers: Array<{ id: string }>,
  embeddings: Map<string, number[]>,
  positions: Map<string, { x: number; y: number }>
): Array<{ paper_a_id: string; paper_b_id: string; similarity: number }> {
  const edgeMap = new Map<string, { paper_a_id: string; paper_b_id: string; similarity: number }>();
  const paperIds = papers.map((p) => p.id);

  function upsertEdge(aId: string, bId: string, similarity: number) {
    if (aId === bId || !Number.isFinite(similarity)) return;
    const [paper_a_id, paper_b_id] = normalizeEdgePair(aId, bId);
    const key = `${paper_a_id}::${paper_b_id}`;
    const sim = clampSimilarity(similarity);
    const existing = edgeMap.get(key);
    if (!existing || sim > existing.similarity) {
      edgeMap.set(key, { paper_a_id, paper_b_id, similarity: sim });
    }
  }

  function connectByLayout(idsToConnect: string[]) {
    for (const sourceId of idsToConnect) {
      const sourcePos = positions.get(sourceId);
      if (!sourcePos) continue;

      const nearest = paperIds
        .filter((targetId) => targetId !== sourceId)
        .map((targetId) => {
          const targetPos = positions.get(targetId);
          if (!targetPos) return null;
          const dx = sourcePos.x - targetPos.x;
          const dy = sourcePos.y - targetPos.y;
          return { targetId, dist: Math.hypot(dx, dy) };
        })
        .filter((item): item is { targetId: string; dist: number } => item !== null && Number.isFinite(item.dist))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, MIN_PAPER_NEIGHBORS);

      for (const n of nearest) {
        const sim = 1 / (1 + n.dist);
        upsertEdge(sourceId, n.targetId, sim);
      }
    }
  }

  const papersWithEmb = papers.filter((p) => embeddings.has(p.id));
  if (papersWithEmb.length >= 2) {
    const neighborMap = new Map<string, Array<{ otherId: string; similarity: number }>>();

    for (let i = 0; i < papersWithEmb.length; i++) {
      for (let j = i + 1; j < papersWithEmb.length; j++) {
        const sim = cosineSimilarity(
          embeddings.get(papersWithEmb[i].id)!,
          embeddings.get(papersWithEmb[j].id)!
        );
        if (!Number.isFinite(sim)) continue;

        if (!neighborMap.has(papersWithEmb[i].id)) neighborMap.set(papersWithEmb[i].id, []);
        if (!neighborMap.has(papersWithEmb[j].id)) neighborMap.set(papersWithEmb[j].id, []);
        neighborMap.get(papersWithEmb[i].id)!.push({ otherId: papersWithEmb[j].id, similarity: sim });
        neighborMap.get(papersWithEmb[j].id)!.push({ otherId: papersWithEmb[i].id, similarity: sim });

        if (sim >= SIMILARITY_THRESHOLD) {
          upsertEdge(papersWithEmb[i].id, papersWithEmb[j].id, sim);
        }
      }
    }

    // Ensure each embedded paper has at least a minimum number of links.
    for (const paper of papersWithEmb) {
      const nearest = (neighborMap.get(paper.id) || [])
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MIN_PAPER_NEIGHBORS);
      for (const n of nearest) {
        upsertEdge(paper.id, n.otherId, n.similarity);
      }
    }
  }

  // Ensure isolated papers still connect, using geometric neighbors.
  const connectedIds = new Set<string>();
  for (const edge of edgeMap.values()) {
    connectedIds.add(edge.paper_a_id);
    connectedIds.add(edge.paper_b_id);
  }
  const disconnected = paperIds.filter((id) => !connectedIds.has(id));
  if (disconnected.length > 0) {
    connectByLayout(disconnected);
  }

  // Absolute fallback when there were no semantic embeddings.
  if (edgeMap.size === 0 && paperIds.length > 1) {
    connectByLayout(paperIds);
  }

  return Array.from(edgeMap.values()).sort((a, b) => b.similarity - a.similarity);
}

function clampSimilarity(sim: number): number {
  if (!Number.isFinite(sim)) return 0.0001;
  return Math.max(0.0001, Math.min(sim, 1));
}

// ---------------------------------------------------------------------------
// GET /api/atlas/papers?topic=T14423
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const topicId = request.nextUrl.searchParams.get("topic");
  if (!topicId) {
    return NextResponse.json({ error: "Missing topic parameter" }, { status: 400 });
  }
  if (!/^T\d+$/i.test(topicId)) {
    return NextResponse.json({ error: "Invalid topic parameter" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  try {
    // 1. Check cache first
    type CachedPaperRow = {
      id: string;
      title: string;
      abstract: string | null;
      year: number | null;
      doi: string | null;
      journal: string | null;
      citation_count: number;
      topic_id: string;
      semantic_scholar_id: string | null;
      x: number;
      y: number;
      specter2_embedding?: unknown;
    };

    type CachedEdgeRow = {
      paper_a_id: string;
      paper_b_id: string;
      similarity: number;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cached, error: cacheErr } = await (admin as any)
      .from("atlas_papers")
      .select("id, title, abstract, year, doi, journal, citation_count, topic_id, semantic_scholar_id, specter2_embedding, x, y")
      .eq("topic_id", topicId);

    if (cacheErr) throw new Error(`Cache check: ${cacheErr.message}`);

    if (cached && cached.length > 0) {
      const cachedPapers = cached as CachedPaperRow[];
      // Also fetch cached edges
      const paperIds = cachedPapers.map((p) => p.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: edges, error: edgeErr } = await (admin as any)
        .from("atlas_paper_edges")
        .select("paper_a_id, paper_b_id, similarity")
        .in("paper_a_id", paperIds)
        .in("paper_b_id", paperIds);

      if (edgeErr) throw new Error(`Edge fetch: ${edgeErr.message}`);

      // Filter to only edges where both papers are in our set
      const idSet = new Set(paperIds);
      const filteredEdges = ((edges || []) as CachedEdgeRow[]).filter(
        (e) =>
          idSet.has(e.paper_a_id) && idSet.has(e.paper_b_id)
      );

      const responseCachedPapers = cachedPapers.map((paper) => ({
        id: paper.id,
        title: paper.title,
        abstract: paper.abstract,
        year: paper.year,
        doi: paper.doi,
        journal: paper.journal,
        citation_count: paper.citation_count,
        topic_id: paper.topic_id,
        semantic_scholar_id: paper.semantic_scholar_id,
        x: paper.x,
        y: paper.y,
      }));

      if (filteredEdges.length > 0) {
        return NextResponse.json({ papers: responseCachedPapers, edges: filteredEdges, cached: true });
      }

      // Edge cache is empty/stale: regenerate from cached embeddings and positions.
      const cachedEmbeddings = new Map<string, number[]>();
      const cachedPositions = new Map<string, { x: number; y: number }>();
      for (const paper of cachedPapers) {
        const vector = parseStoredVector(paper.specter2_embedding);
        if (vector) cachedEmbeddings.set(paper.id, vector);
        if (Number.isFinite(paper.x) && Number.isFinite(paper.y)) {
          cachedPositions.set(paper.id, { x: paper.x, y: paper.y });
        }
      }

      const regeneratedEdges = computeEdges(cachedPapers, cachedEmbeddings, cachedPositions);
      if (regeneratedEdges.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: edgeInsertErr } = await (admin as any)
          .from("atlas_paper_edges")
          .upsert(regeneratedEdges, { onConflict: "paper_a_id,paper_b_id" });

        if (edgeInsertErr) {
          console.warn("Edge regeneration warning:", edgeInsertErr.message);
        }
      }

      return NextResponse.json({
        papers: responseCachedPapers,
        edges: regeneratedEdges,
        cached: true,
        regeneratedEdges: true,
      });
    }

    // 2. Fetch from OpenAlex
    const papers = await fetchTopPapers(topicId);
    if (papers.length === 0) {
      return NextResponse.json({ papers: [], edges: [], cached: false });
    }

    // 3. Get SPECTER2 embeddings from Semantic Scholar
    const embeddings = await fetchSpecter2Embeddings(papers);

    // 4. Compute UMAP layout
    const positions = computeUmapLayout(papers, embeddings);

    // 5. Compute edges
    const edges = computeEdges(papers, embeddings, positions);

    // 6. Store papers in Supabase
    const paperRows = papers.map((p) => ({
      id: p.id,
      title: p.title,
      abstract: p.abstract,
      year: p.year,
      doi: p.doi,
      journal: p.journal,
      citation_count: p.citation_count,
      topic_id: topicId,
      semantic_scholar_id: null, // Could store S2 ID if needed
      specter2_embedding: embeddings.has(p.id)
        ? JSON.stringify(embeddings.get(p.id))
        : null,
      x: positions.get(p.id)?.x ?? 0,
      y: positions.get(p.id)?.y ?? 0,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = await (admin as any)
      .from("atlas_papers")
      .upsert(paperRows, { onConflict: "id" });

    if (insertErr) console.warn("Paper insert warning:", insertErr.message);

    // 7. Store edges
    if (edges.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: edgeInsertErr } = await (admin as any)
        .from("atlas_paper_edges")
        .upsert(edges, { onConflict: "paper_a_id,paper_b_id" });

      if (edgeInsertErr) console.warn("Edge insert warning:", edgeInsertErr.message);
    }

    // 8. Return papers (without embeddings) and edges
    const responsePapers = papers.map((p) => ({
      ...p,
      topic_id: topicId,
      semantic_scholar_id: null,
      x: positions.get(p.id)?.x ?? 0,
      y: positions.get(p.id)?.y ?? 0,
    }));

    return NextResponse.json({ papers: responsePapers, edges, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Atlas papers error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
