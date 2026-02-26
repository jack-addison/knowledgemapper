import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess } from "@/lib/map-access";

interface UpdateMemberPayload {
  mapId?: string;
  userId?: string;
  role?: "editor" | "viewer";
}

interface RemoveMemberPayload {
  mapId?: string;
  userId?: string;
}

function normalizeMapId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): "editor" | "viewer" | null {
  if (value === "editor" || value === "viewer") return value;
  return null;
}

function collaborationSetupError() {
  return NextResponse.json(
    {
      error:
        "Collaboration tables are not set up yet. Run the collaboration SQL migration first.",
    },
    { status: 500 }
  );
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateMemberPayload;
  const mapId = normalizeMapId(body.mapId);
  const userId = normalizeUserId(body.userId);
  const role = normalizeRole(body.role);

  if (!mapId || !userId || !role) {
    return NextResponse.json(
      { error: "mapId, userId, and role are required." },
      { status: 400 }
    );
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can manage collaborators." },
      { status: 403 }
    );
  }
  if (userId === access.ownerUserId) {
    return NextResponse.json(
      { error: "Owner role cannot be changed." },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("map_collaborators")
    .update({ role })
    .eq("map_id", access.mapId)
    .eq("user_id", userId)
    .select("user_id, role, created_at")
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") return collaborationSetupError();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
  }

  return NextResponse.json({
    userId: data.user_id,
    role: data.role === "viewer" ? "viewer" : "editor",
    joinedAt: data.created_at || null,
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

  const body = (await request.json().catch(() => ({}))) as RemoveMemberPayload;
  const mapId = normalizeMapId(body.mapId);
  const userId = normalizeUserId(body.userId);

  if (!mapId || !userId) {
    return NextResponse.json(
      { error: "mapId and userId are required." },
      { status: 400 }
    );
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can manage collaborators." },
      { status: 403 }
    );
  }
  if (userId === access.ownerUserId) {
    return NextResponse.json(
      { error: "Owner cannot be removed." },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: existing, error: existingError } = await admin
    .from("map_collaborators")
    .select("user_id")
    .eq("map_id", access.mapId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    if (existingError.code === "42P01") return collaborationSetupError();
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
  }

  const { error } = await admin
    .from("map_collaborators")
    .delete()
    .eq("map_id", access.mapId)
    .eq("user_id", userId);

  if (error) {
    if (error.code === "42P01") return collaborationSetupError();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, userId });
}
