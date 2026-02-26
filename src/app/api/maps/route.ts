import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("maps")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

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
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Map name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("maps")
    .insert({
      user_id: user.id,
      name,
    })
    .select("*")
    .single();

  if (error) {
    const isConflict = error.code === "23505";
    return NextResponse.json(
      { error: isConflict ? "Map name already exists" : error.message },
      { status: isConflict ? 409 : 500 }
    );
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
  const mapId = typeof body.mapId === "string" ? body.mapId.trim() : "";

  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const { data: map, error: mapLookupError } = await supabase
    .from("maps")
    .select("id")
    .eq("id", mapId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mapLookupError) {
    return NextResponse.json({ error: mapLookupError.message }, { status: 500 });
  }

  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const dependentTables = [
    "interest_evidence",
    "edge_evidence",
    "edge_notes",
    "interests",
  ] as const;

  for (const tableName of dependentTables) {
    const { error } = await supabase.from(tableName).delete().eq("map_id", mapId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { error: deleteMapError } = await supabase
    .from("maps")
    .delete()
    .eq("id", mapId)
    .eq("user_id", user.id);

  if (deleteMapError) {
    return NextResponse.json({ error: deleteMapError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, mapId });
}
