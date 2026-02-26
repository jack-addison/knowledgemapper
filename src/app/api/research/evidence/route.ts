import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { EdgeEvidence, EvidenceSource } from "@/lib/types";

const OPENALEX_WORKS_URL = "https://api.openalex.org/works";

interface OpenAlexAuthor {
  author?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexPrimaryLocation {
  landing_page_url?: string | null;
  source?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexWork {
  id?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  primary_location?: OpenAlexPrimaryLocation | null;
  authorships?: OpenAlexAuthor[] | null;
}

function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const cleaned = doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function resolveWorkUrl(work: OpenAlexWork): string | null {
  const landing = work.primary_location?.landing_page_url?.trim();
  if (landing) return landing;

  const doi = normalizeDoi(work.doi);
  if (doi) return `https://doi.org/${doi}`;

  const openAlexId = work.id?.trim();
  if (openAlexId) return openAlexId;

  return null;
}

function buildReason(title: string, topicA: string, topicB: string): string {
  const lowerTitle = title.toLowerCase();
  const a = topicA.toLowerCase();
  const b = topicB.toLowerCase();

  if (lowerTitle.includes(a) && lowerTitle.includes(b)) {
    return "Directly references both topics in the paper title.";
  }

  if (lowerTitle.includes(a) || lowerTitle.includes(b)) {
    return "Likely relevant bridge paper between these areas.";
  }

  return "Returned from a joint search across both selected topics.";
}

function toEvidenceSource(
  work: OpenAlexWork,
  topicA: string,
  topicB: string
): EvidenceSource | null {
  const title = work.display_name?.trim();
  if (!title) return null;

  const url = resolveWorkUrl(work);
  if (!url) return null;

  const authors =
    work.authorships
      ?.map((item) => item.author?.display_name?.trim())
      .filter((name): name is string => Boolean(name)) || [];

  return {
    title,
    year:
      typeof work.publication_year === "number" ? work.publication_year : null,
    url,
    journal: work.primary_location?.source?.display_name?.trim() || "Unknown venue",
    authors: authors.slice(0, 5),
    reason: buildReason(title, topicA, topicB),
  };
}

function buildSummary(topicA: string, topicB: string, sources: EvidenceSource[]): string {
  if (sources.length === 0) {
    return `No direct paper matches were found for "${topicA}" + "${topicB}". Try broadening topic names or checking Google Scholar.`;
  }

  const newest = sources
    .map((source) => source.year)
    .filter((year): year is number => typeof year === "number")
    .sort((a, b) => b - a)[0];

  const dateText = newest ? ` Newer results include work from ${newest}.` : "";
  return `Found ${sources.length} research sources that may explain the relationship between "${topicA}" and "${topicB}".${dateText}`;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const topicA = typeof body.topicA === "string" ? body.topicA.trim() : "";
  const topicB = typeof body.topicB === "string" ? body.topicB.trim() : "";

  if (!topicA || !topicB) {
    return NextResponse.json(
      { error: "topicA and topicB are required" },
      { status: 400 }
    );
  }

  const query = `${topicA} ${topicB}`;
  const url = new URL(OPENALEX_WORKS_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", "8");
  url.searchParams.set("sort", "relevance_score:desc");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch research evidence" },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as { results?: OpenAlexWork[] };
    const sources =
      payload.results
        ?.map((work) => toEvidenceSource(work, topicA, topicB))
        .filter((item): item is EvidenceSource => Boolean(item))
        .slice(0, 5) || [];

    const result: EdgeEvidence = {
      query,
      summary: buildSummary(topicA, topicB, sources),
      sources,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch research evidence" },
      { status: 500 }
    );
  }
}
