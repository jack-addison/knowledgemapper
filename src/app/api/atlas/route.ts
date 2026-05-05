import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const PAGE_SIZE = 1000;
const EDGE_SIMILARITY_FLOOR = 0.5;
const EDGE_FILTER_CHUNK_SIZE = 300;
const RESPONSE_S_MAXAGE_SECONDS = 120;
const RESPONSE_STALE_WHILE_REVALIDATE_SECONDS = 600;
const MEMORY_CACHE_TTL_MS = 45_000;
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
type QueryFilter =
  | {
      column: string;
      op: "gte";
      value: number | string;
    }
  | {
      column: string;
      op: "in";
      value: string[];
    };

type AtlasDomainRow = {
  id: string;
  display_name: string;
  description: string | null;
};
type AtlasFieldRow = {
  id: string;
  display_name: string;
  domain_id: string;
  description: string | null;
};
type AtlasSubfieldRow = {
  id: string;
  display_name: string;
  field_id: string;
  description: string | null;
  works_count: number;
};
type AtlasTopicRow = {
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
};
type AtlasTopicEdgeRow = {
  topic_a_id: string;
  topic_b_id: string;
  similarity: number;
};

type AtlasResponsePayload = {
  domains: AtlasDomainRow[];
  fields: AtlasFieldRow[];
  subfields: AtlasSubfieldRow[];
  topics: AtlasTopicRow[];
  edges: AtlasTopicEdgeRow[];
};

const atlasMemoryCache = new Map<
  string,
  { expiresAt: number; payload: AtlasResponsePayload }
>();

function makeCacheKey(domainFilter: string | null, fieldFilter: string | null): string {
  return `domain:${domainFilter || "all"}|field:${fieldFilter || "all"}`;
}

function cacheHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Cache-Control": `public, s-maxage=${RESPONSE_S_MAXAGE_SECONDS}, stale-while-revalidate=${RESPONSE_STALE_WHILE_REVALIDATE_SECONDS}`,
    ...(extra || {}),
  };
}

/**
 * Fetch all rows from a Supabase query, paginating past the 1000 row default.
 */
async function fetchAllRows<T>(
  table: string,
  select: string,
  admin: AdminClient,
  filters?: QueryFilter[]
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;

  while (true) {
    let q = admin.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (filters) {
      for (const f of filters) {
        if (f.op === "gte") q = q.gte(f.column, f.value);
        else if (f.op === "in") q = q.in(f.column, f.value);
      }
    }
    const { data, error } = await q.returns<T[]>();
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return results;
}

async function fetchEdgesForTopicIds(
  admin: AdminClient,
  topicIds: string[]
): Promise<AtlasTopicEdgeRow[]> {
  if (topicIds.length < 2) return [];

  const sortedIds = [...topicIds].sort((a, b) => a.localeCompare(b));
  const chunks: string[][] = [];
  for (let i = 0; i < sortedIds.length; i += EDGE_FILTER_CHUNK_SIZE) {
    chunks.push(sortedIds.slice(i, i + EDGE_FILTER_CHUNK_SIZE));
  }

  const edges: AtlasTopicEdgeRow[] = [];
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i; j < chunks.length; j++) {
      const chunkEdges = await fetchAllRows<AtlasTopicEdgeRow>(
        "atlas_topic_edges",
        "topic_a_id, topic_b_id, similarity",
        admin,
        [
          { column: "similarity", op: "gte", value: EDGE_SIMILARITY_FLOOR },
          { column: "topic_a_id", op: "in", value: chunks[i] },
          { column: "topic_b_id", op: "in", value: chunks[j] },
        ]
      );
      if (chunkEdges.length > 0) {
        edges.push(...chunkEdges);
      }
    }
  }

  return edges;
}

/**
 * GET /api/atlas
 */
export async function GET(request: NextRequest) {
  const admin = createAdminSupabaseClient();
  const { searchParams } = request.nextUrl;
  const domainFilter = searchParams.get("domain");
  const fieldFilter = searchParams.get("field");
  const cacheKey = makeCacheKey(domainFilter, fieldFilter);

  const cacheHit = atlasMemoryCache.get(cacheKey);
  if (cacheHit && cacheHit.expiresAt > Date.now()) {
    return NextResponse.json(cacheHit.payload, {
      headers: cacheHeaders({ "X-Atlas-Cache": "memory-hit" }),
    });
  }

  try {
    const [domains, fields, subfields] = await Promise.all([
      fetchAllRows<AtlasDomainRow>("atlas_domains", "id, display_name, description", admin),
      fetchAllRows<AtlasFieldRow>("atlas_fields", "id, display_name, domain_id, description", admin),
      fetchAllRows<AtlasSubfieldRow>(
        "atlas_subfields",
        "id, display_name, field_id, description, works_count",
        admin
      ),
    ]);

    // Determine active subfield IDs based on filters
    let activeSubfieldIds: string[] | null = null;
    if (fieldFilter) {
      activeSubfieldIds = subfields
        .filter((s) => s.field_id === fieldFilter)
        .map((s) => s.id);
    } else if (domainFilter) {
      const activeFieldIds = new Set(
        fields.filter((f) => f.domain_id === domainFilter).map((f) => f.id)
      );
      activeSubfieldIds = subfields
        .filter((s) => activeFieldIds.has(s.field_id))
        .map((s) => s.id);
    }

    // Fetch topics
    const topicFilters: QueryFilter[] | undefined = activeSubfieldIds
      ? [{ column: "subfield_id", op: "in", value: activeSubfieldIds }]
      : undefined;
    const topics = await fetchAllRows<AtlasTopicRow>(
      "atlas_topics",
      "id, display_name, description, keywords, subfield_id, works_count, cited_by_count, wikipedia_url, x, y",
      admin,
      topicFilters
    );

    let edges: AtlasTopicEdgeRow[] = [];
    if (topics.length > 1) {
      if (activeSubfieldIds) {
        edges = await fetchEdgesForTopicIds(
          admin,
          topics.map((t) => t.id)
        );
      } else {
        edges = await fetchAllRows<AtlasTopicEdgeRow>(
          "atlas_topic_edges",
          "topic_a_id, topic_b_id, similarity",
          admin,
          [{ column: "similarity", op: "gte", value: EDGE_SIMILARITY_FLOOR }]
        );
      }
    }

    const payload: AtlasResponsePayload = { domains, fields, subfields, topics, edges };
    atlasMemoryCache.set(cacheKey, {
      expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
      payload,
    });

    return NextResponse.json(payload, {
      headers: cacheHeaders({ "X-Atlas-Cache": "miss" }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
