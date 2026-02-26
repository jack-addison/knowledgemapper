import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

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

async function validateUserMap(
  supabase: SupabaseClient,
  userId: string,
  mapId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("maps")
    .select("id")
    .eq("id", mapId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && Boolean(data);
}

async function validateEdgeInterests(
  supabase: SupabaseClient,
  userId: string,
  mapId: string,
  interestAId: string,
  interestBId: string
): Promise<boolean> {
  if (interestAId === interestBId) return false;

  const { data, error } = await supabase
    .from("interests")
    .select("id")
    .eq("user_id", userId)
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

  const validMap = await validateUserMap(supabase, user.id, parsed.mapId);
  if (!validMap) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const validInterests = await validateEdgeInterests(
    supabase,
    user.id,
    parsed.mapId,
    parsed.interestAId,
    parsed.interestBId
  );
  if (!validInterests) {
    return NextResponse.json(
      { error: "Invalid edge interest ids" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("edge_notes")
    .select("notes, updated_at")
    .eq("user_id", user.id)
    .eq("map_id", parsed.mapId)
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

  const validMap = await validateUserMap(supabase, user.id, parsed.mapId);
  if (!validMap) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const validInterests = await validateEdgeInterests(
    supabase,
    user.id,
    parsed.mapId,
    parsed.interestAId,
    parsed.interestBId
  );
  if (!validInterests) {
    return NextResponse.json(
      { error: "Invalid edge interest ids" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("edge_notes")
    .upsert(
      {
        user_id: user.id,
        map_id: parsed.mapId,
        interest_a_id: parsed.interestAId,
        interest_b_id: parsed.interestBId,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,map_id,interest_a_id,interest_b_id" }
    )
    .select("notes, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
