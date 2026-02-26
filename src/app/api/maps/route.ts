import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess, listAccessibleMaps } from "@/lib/map-access";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await listAccessibleMaps(user.id);
    return NextResponse.json(data || []);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load maps" },
      { status: 500 }
    );
  }
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

  return NextResponse.json({
    ...data,
    role: "owner",
    can_edit: true,
    can_manage: true,
  });
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

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can delete this map." },
      { status: 403 }
    );
  }

  const admin = createAdminSupabaseClient();
  const dependentTables = [
    "interest_evidence",
    "edge_evidence",
    "edge_notes",
    "interests",
  ] as const;

  for (const tableName of dependentTables) {
    const { error } = await admin.from(tableName).delete().eq("map_id", mapId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { error: deleteMapError } = await admin
    .from("maps")
    .delete()
    .eq("id", mapId)
    .eq("user_id", user.id);

  if (deleteMapError) {
    return NextResponse.json({ error: deleteMapError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, mapId });
}
