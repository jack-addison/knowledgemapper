import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
  const token = normalizeToken(body.token);
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const tokenHash = hashToken(token);

  const { data: invite, error: inviteError } = await admin
    .from("map_collab_invites")
    .select("id, map_id, role, is_active, expires_at, used_count")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    if (inviteError.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Collaboration tables are not set up yet. Run the collaboration SQL migration first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  if (!invite || !invite.is_active) {
    return NextResponse.json(
      { error: "This invite link is invalid or inactive." },
      { status: 400 }
    );
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite link has expired." }, { status: 400 });
  }

  const { data: map, error: mapError } = await admin
    .from("maps")
    .select("id, name, user_id")
    .eq("id", invite.map_id)
    .maybeSingle();

  if (mapError || !map) {
    return NextResponse.json({ error: "Target map not found." }, { status: 404 });
  }

  if (map.user_id === user.id) {
    return NextResponse.json({
      joined: true,
      mapId: map.id,
      mapName: map.name,
      role: "owner",
    });
  }

  const role = invite.role === "viewer" ? "viewer" : "editor";
  const { error: upsertError } = await admin.from("map_collaborators").upsert(
    {
      map_id: map.id,
      user_id: user.id,
      role,
      created_by: map.user_id,
    },
    { onConflict: "map_id,user_id" }
  );

  if (upsertError) {
    if (upsertError.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Collaboration tables are not set up yet. Run the collaboration SQL migration first.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await admin
    .from("map_collab_invites")
    .update({ used_count: (invite.used_count || 0) + 1 })
    .eq("id", invite.id);

  return NextResponse.json({
    joined: true,
    mapId: map.id,
    mapName: map.name,
    role,
  });
}
