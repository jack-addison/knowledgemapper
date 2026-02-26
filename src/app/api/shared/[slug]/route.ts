import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { Interest, SharedMapSnapshot } from "@/lib/types";

function parseSlug(value: string): string {
  return value.trim().toLowerCase();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const resolved = await params;
  const slug = parseSlug(resolved.slug || "");

  if (!slug) {
    return NextResponse.json({ error: "Invalid share link" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminSupabaseClient();
  } catch (err) {
    console.error("Missing admin Supabase configuration:", err);
    return NextResponse.json(
      { error: "Sharing is not configured on this deployment." },
      { status: 500 }
    );
  }

  const { data: map, error: mapError } = await admin
    .from("maps")
    .select("id, name, share_slug, shared_at, created_at")
    .eq("share_slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }

  if (!map) {
    return NextResponse.json({ error: "Shared map not found" }, { status: 404 });
  }

  const mapId = map.id;

  const [interestsRes, interestEvidenceRes, edgeEvidenceRes, edgeNotesRes] =
    await Promise.all([
      admin
        .from("interests")
        .select("id, user_id, map_id, name, embedding, related_topics, notes, created_at")
        .eq("map_id", mapId)
        .order("created_at", { ascending: true }),
      admin
        .from("interest_evidence")
        .select(
          "id, map_id, interest_id, title, url, year, journal, authors, reason, source_provider, created_at"
        )
        .eq("map_id", mapId)
        .order("created_at", { ascending: false }),
      admin
        .from("edge_evidence")
        .select(
          "id, map_id, interest_a_id, interest_b_id, title, url, year, journal, authors, reason, source_provider, created_at"
        )
        .eq("map_id", mapId)
        .order("created_at", { ascending: false }),
      admin
        .from("edge_notes")
        .select("interest_a_id, interest_b_id, notes, updated_at")
        .eq("map_id", mapId),
    ]);

  if (interestsRes.error) {
    return NextResponse.json({ error: interestsRes.error.message }, { status: 500 });
  }
  if (interestEvidenceRes.error) {
    return NextResponse.json(
      { error: interestEvidenceRes.error.message },
      { status: 500 }
    );
  }
  if (edgeEvidenceRes.error) {
    return NextResponse.json(
      { error: edgeEvidenceRes.error.message },
      { status: 500 }
    );
  }
  if (edgeNotesRes.error) {
    return NextResponse.json({ error: edgeNotesRes.error.message }, { status: 500 });
  }

  const parsedInterests: Interest[] = (interestsRes.data || []).map((interest) => ({
    ...interest,
    embedding:
      typeof interest.embedding === "string"
        ? JSON.parse(interest.embedding)
        : interest.embedding,
  }));

  const payload: SharedMapSnapshot = {
    map: {
      id: map.id,
      name: map.name,
      share_slug: map.share_slug,
      shared_at: map.shared_at,
      created_at: map.created_at,
    },
    interests: parsedInterests,
    interestEvidence: interestEvidenceRes.data || [],
    edgeEvidence: edgeEvidenceRes.data || [],
    edgeNotes: edgeNotesRes.data || [],
  };

  return NextResponse.json(payload);
}
