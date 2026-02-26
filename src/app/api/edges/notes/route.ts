import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess } from "@/lib/map-access";

interface ParsedEdgeParams {
  mapId: string;
  interestAId: string;
  interestBId: string;
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
    .from("edge_notes")
    .select("notes, updated_at")
    .eq("map_id", access.mapId)
    .eq("interest_a_id", parsed.interestAId)
    .eq("interest_b_id", parsed.interestBId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    data || {
      notes: "",
      updated_at: null,
    }
  );
}

export async function PUT(request: NextRequest) {
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
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!parsed || notes === null) {
    return NextResponse.json(
      { error: "mapId, interestAId, interestBId, and notes are required" },
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
  const { data: existing, error: findError } = await admin
    .from("edge_notes")
    .select("id")
    .eq("map_id", access.mapId)
    .eq("interest_a_id", parsed.interestAId)
    .eq("interest_b_id", parsed.interestBId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  if (existing?.id) {
    const { data, error } = await admin
      .from("edge_notes")
      .update({
        notes,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("notes, updated_at")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await admin
    .from("edge_notes")
    .insert({
      user_id: user.id,
      map_id: access.mapId,
      interest_a_id: parsed.interestAId,
      interest_b_id: parsed.interestBId,
      notes,
      updated_at: new Date().toISOString(),
    })
    .select("notes, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
