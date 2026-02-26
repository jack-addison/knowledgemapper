import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess } from "@/lib/map-access";

interface ParsedEdgeParams {
  mapId: string;
  interestAId: string;
  interestBId: string;
}

interface SourcePayload {
  title: string;
  url: string;
  year: number | null;
  journal: string;
  authors: string[];
  reason: string;
  sourceProvider: string;
}

function normalizeEdgePair(a: string, b: string): { a: string; b: string } {
  return a < b ? { a, b } : { a: b, b: a };
}

function parseEdgeParams(
  mapId: string | null,
  interestAId: string | null,
  interestBId: string | null
): ParsedEdgeParams | null {
  if (!mapId || !interestAId || !interestBId) return null;
  if (
    typeof mapId !== "string" ||
    typeof interestAId !== "string" ||
    typeof interestBId !== "string"
  ) {
    return null;
  }

  const trimmedMapId = mapId.trim();
  const trimmedAId = interestAId.trim();
  const trimmedBId = interestBId.trim();
  if (!trimmedMapId || !trimmedAId || !trimmedBId) return null;

  const pair = normalizeEdgePair(trimmedAId, trimmedBId);
  return {
    mapId: trimmedMapId,
    interestAId: pair.a,
    interestBId: pair.b,
  };
}

function parseSource(source: unknown): SourcePayload | null {
  if (!source || typeof source !== "object") return null;
  const obj = source as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  if (!title || !url) return null;

  let year: number | null = null;
  if (typeof obj.year === "number" && Number.isFinite(obj.year)) {
    year = Math.trunc(obj.year);
  } else if (typeof obj.year === "string") {
    const parsed = Number(obj.year);
    if (Number.isFinite(parsed)) year = Math.trunc(parsed);
  }

  const journal =
    typeof obj.journal === "string" && obj.journal.trim().length > 0
      ? obj.journal.trim()
      : "Unknown venue";

  const authors = Array.isArray(obj.authors)
    ? obj.authors
        .filter((author): author is string => typeof author === "string")
        .map((author) => author.trim())
        .filter((author) => author.length > 0)
        .slice(0, 8)
    : [];

  const reason =
    typeof obj.reason === "string" && obj.reason.trim().length > 0
      ? obj.reason.trim()
      : "Saved as evidence for this edge.";

  const sourceProvider =
    typeof obj.sourceProvider === "string" && obj.sourceProvider.trim().length > 0
      ? obj.sourceProvider.trim()
      : "openalex";

  return {
    title,
    url,
    year,
    journal,
    authors,
    reason,
    sourceProvider,
  };
}

async function validateEdgeInterests(
  mapId: string,
  interestAId: string,
  interestBId: string
): Promise<boolean> {
  if (interestAId === interestBId) return false;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("interests")
    .select("id")
    .eq("map_id", mapId)
    .in("id", [interestAId, interestBId]);

  if (error || !data) return false;
  return data.length === 2;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseEdgeParams(
    request.nextUrl.searchParams.get("mapId"),
    request.nextUrl.searchParams.get("interestAId"),
    request.nextUrl.searchParams.get("interestBId")
  );
  if (!parsed) {
    return NextResponse.json(
      { error: "mapId, interestAId, and interestBId are required" },
      { status: 400 }
    );
  }

  const access = await getMapAccess(user.id, parsed.mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const validInterests = await validateEdgeInterests(
    access.mapId,
    parsed.interestAId,
    parsed.interestBId
  );
  if (!validInterests) {
    return NextResponse.json(
      { error: "Invalid edge interest ids" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("edge_evidence")
    .select("*")
    .eq("map_id", access.mapId)
    .eq("interest_a_id", parsed.interestAId)
    .eq("interest_b_id", parsed.interestBId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
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
  const parsed = parseEdgeParams(
    typeof body.mapId === "string" ? body.mapId : null,
    typeof body.interestAId === "string" ? body.interestAId : null,
    typeof body.interestBId === "string" ? body.interestBId : null
  );
  if (!parsed) {
    return NextResponse.json(
      { error: "mapId, interestAId, and interestBId are required" },
      { status: 400 }
    );
  }

  const source = parseSource(body.source);
  if (!source) {
    return NextResponse.json({ error: "Invalid source payload" }, { status: 400 });
  }

  const access = await getMapAccess(user.id, parsed.mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You only have view access to this map." },
      { status: 403 }
    );
  }

  const validInterests = await validateEdgeInterests(
    access.mapId,
    parsed.interestAId,
    parsed.interestBId
  );
  if (!validInterests) {
    return NextResponse.json(
      { error: "Invalid edge interest ids" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("edge_evidence")
    .insert({
      user_id: user.id,
      map_id: access.mapId,
      interest_a_id: parsed.interestAId,
      interest_b_id: parsed.interestBId,
      title: source.title,
      url: source.url,
      year: source.year,
      journal: source.journal,
      authors: source.authors,
      reason: source.reason,
      source_provider: source.sourceProvider,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: existingError } = await admin
        .from("edge_evidence")
        .select("*")
        .eq("map_id", access.mapId)
        .eq("interest_a_id", parsed.interestAId)
        .eq("interest_b_id", parsed.interestBId)
        .eq("url", source.url)
        .maybeSingle();

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }

      if (existing) {
        return NextResponse.json(existing);
      }
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseEdgeParams(
    typeof body.mapId === "string" ? body.mapId : null,
    typeof body.interestAId === "string" ? body.interestAId : null,
    typeof body.interestBId === "string" ? body.interestBId : null
  );
  const evidenceId = typeof body.id === "string" ? body.id.trim() : "";

  if (!parsed || !evidenceId) {
    return NextResponse.json(
      { error: "id, mapId, interestAId, and interestBId are required" },
      { status: 400 }
    );
  }

  const access = await getMapAccess(user.id, parsed.mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You only have view access to this map." },
      { status: 403 }
    );
  }

  const validInterests = await validateEdgeInterests(
    access.mapId,
    parsed.interestAId,
    parsed.interestBId
  );
  if (!validInterests) {
    return NextResponse.json(
      { error: "Invalid edge interest ids" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("edge_evidence")
    .delete()
    .eq("id", evidenceId)
    .eq("map_id", access.mapId)
    .eq("interest_a_id", parsed.interestAId)
    .eq("interest_b_id", parsed.interestBId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
