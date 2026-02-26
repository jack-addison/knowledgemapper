import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { getMapAccess } from "@/lib/map-access";

interface CollaborationPayload {
  mapId: string;
  role?: "editor" | "viewer";
}

function normalizeMapId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): "editor" | "viewer" {
  return value === "viewer" ? "viewer" : "editor";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function buildJoinUrl(request: NextRequest, token: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/join/${token}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mapId = normalizeMapId(request.nextUrl.searchParams.get("mapId"));
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can view collaboration members." },
      { status: 403 }
    );
  }

  const admin = createAdminSupabaseClient();

  const { data: map, error: mapError } = await admin
    .from("maps")
    .select("id, user_id, created_at")
    .eq("id", access.mapId)
    .maybeSingle();

  if (mapError || !map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }

  const [membersResult, inviteResult] = await Promise.all([
    admin
      .from("map_collaborators")
      .select("user_id, role, created_at")
      .eq("map_id", access.mapId)
      .order("created_at", { ascending: true }),
    admin
      .from("map_collab_invites")
      .select("role, expires_at, created_at, used_count")
      .eq("map_id", access.mapId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (membersResult.error && membersResult.error.code !== "42P01") {
    return NextResponse.json({ error: membersResult.error.message }, { status: 500 });
  }
  if (inviteResult.error && inviteResult.error.code !== "42P01") {
    return NextResponse.json({ error: inviteResult.error.message }, { status: 500 });
  }

  const collaboratorRows =
    membersResult.error?.code === "42P01" ? [] : membersResult.data || [];

  const members = [
    {
      userId: map.user_id,
      role: "owner" as const,
      isOwner: true,
      joinedAt: map.created_at,
    },
    ...collaboratorRows
      .filter((row) => row.user_id !== map.user_id)
      .map((row) => ({
        userId: row.user_id,
        role: row.role === "viewer" ? ("viewer" as const) : ("editor" as const),
        isOwner: false,
        joinedAt: row.created_at || null,
      })),
  ];

  const uniqueUserIds = Array.from(new Set(members.map((member) => member.userId)));
  const emailByUserId = new Map<string, string | null>();

  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error || !data.user) {
          emailByUserId.set(userId, null);
          return;
        }
        emailByUserId.set(userId, data.user.email ?? null);
      } catch {
        emailByUserId.set(userId, null);
      }
    })
  );

  const invite = inviteResult.error?.code === "42P01" ? null : inviteResult.data;

  return NextResponse.json({
    mapId: access.mapId,
    members: members.map((member) => ({
      ...member,
      email: emailByUserId.get(member.userId) ?? null,
    })),
    activeInvite: invite
      ? {
          role: invite.role === "viewer" ? "viewer" : "editor",
          expiresAt: invite.expires_at || null,
          createdAt: invite.created_at || null,
          usedCount: typeof invite.used_count === "number" ? invite.used_count : 0,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CollaborationPayload;
  const mapId = normalizeMapId(body.mapId);
  const role = normalizeRole(body.role);
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can manage collaboration invites." },
      { status: 403 }
    );
  }

  const admin = createAdminSupabaseClient();
  const token = `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
  const tokenHash = hashToken(token);

  const { error: deactivateError } = await admin
    .from("map_collab_invites")
    .update({ is_active: false })
    .eq("map_id", access.mapId)
    .eq("is_active", true);
  if (deactivateError && deactivateError.code !== "42P01") {
    return NextResponse.json({ error: deactivateError.message }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  const { error } = await admin.from("map_collab_invites").insert({
    map_id: access.mapId,
    created_by: user.id,
    role,
    token_hash: tokenHash,
    is_active: true,
    expires_at: expiresAt,
  });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Collaboration tables are not set up yet. Run the collaboration SQL migration first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    mapId: access.mapId,
    role,
    inviteUrl: buildJoinUrl(request, token),
    expiresAt,
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

  const body = (await request.json().catch(() => ({}))) as { mapId?: string };
  const mapId = normalizeMapId(body.mapId);
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canManage) {
    return NextResponse.json(
      { error: "Only the map owner can manage collaboration invites." },
      { status: 403 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("map_collab_invites")
    .update({ is_active: false })
    .eq("map_id", access.mapId)
    .eq("is_active", true);

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Collaboration tables are not set up yet. Run the collaboration SQL migration first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
