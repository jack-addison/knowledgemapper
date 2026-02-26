import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess } from "@/lib/map-access";

interface ParsedTopicParams {
  mapId: string;
  interestId: string;
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

function parseTopicParams(
  mapId: string | null,
  interestId: string | null
): ParsedTopicParams | null {
  if (!mapId || !interestId) return null;
  if (typeof mapId !== "string" || typeof interestId !== "string") {
    return null;
  }

  const trimmedMapId = mapId.trim();
  const trimmedInterestId = interestId.trim();
  if (!trimmedMapId || !trimmedInterestId) return null;

  return { mapId: trimmedMapId, interestId: trimmedInterestId };
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
      : "Saved as evidence for this topic.";

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

async function validateMapInterest(
  mapId: string,
  interestId: string
): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("interests")
    .select("id")
    .eq("id", interestId)
    .eq("map_id", mapId)
    .maybeSingle();

  return !error && Boolean(data);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseTopicParams(
    request.nextUrl.searchParams.get("mapId"),
    request.nextUrl.searchParams.get("interestId")
  );
  if (!parsed) {
    return NextResponse.json(
      { error: "mapId and interestId are required" },
      { status: 400 }
    );
  }

  const access = await getMapAccess(user.id, parsed.mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const validInterest = await validateMapInterest(access.mapId, parsed.interestId);
  if (!validInterest) {
    return NextResponse.json({ error: "Invalid interestId" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("interest_evidence")
    .select("*")
    .eq("map_id", access.mapId)
    .eq("interest_id", parsed.interestId)
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
  const parsed = parseTopicParams(
    typeof body.mapId === "string" ? body.mapId : null,
    typeof body.interestId === "string" ? body.interestId : null
  );
  const source = parseSource(body.source);

  if (!parsed || !source) {
    return NextResponse.json(
      { error: "mapId, interestId, and valid source are required" },
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

  const validInterest = await validateMapInterest(access.mapId, parsed.interestId);
  if (!validInterest) {
    return NextResponse.json({ error: "Invalid interestId" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("interest_evidence")
    .insert({
      user_id: user.id,
      map_id: access.mapId,
      interest_id: parsed.interestId,
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
        .from("interest_evidence")
        .select("*")
        .eq("map_id", access.mapId)
        .eq("interest_id", parsed.interestId)
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
  const parsed = parseTopicParams(
    typeof body.mapId === "string" ? body.mapId : null,
    typeof body.interestId === "string" ? body.interestId : null
  );
  const id = typeof body.id === "string" ? body.id.trim() : "";

  if (!parsed || !id) {
    return NextResponse.json(
      { error: "id, mapId, and interestId are required" },
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

  const validInterest = await validateMapInterest(access.mapId, parsed.interestId);
  if (!validInterest) {
    return NextResponse.json({ error: "Invalid interestId" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("interest_evidence")
    .delete()
    .eq("id", id)
    .eq("map_id", access.mapId)
    .eq("interest_id", parsed.interestId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
