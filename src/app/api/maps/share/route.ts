import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

interface SharePayload {
  mapId: string;
  regenerate?: boolean;
}

function normalizeMapId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function generateShareSlug(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { user };
}

function buildShareUrl(request: NextRequest, slug: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/shared/${slug}`;
}

async function fetchOwnedMap(
  userId: string,
  mapId: string
): Promise<
  | {
      id: string;
      name: string;
      share_slug: string | null;
      is_public: boolean;
      shared_at: string | null;
    }
  | null
> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("maps")
    .select("id, name, share_slug, is_public, shared_at")
    .eq("id", mapId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const mapId = normalizeMapId(request.nextUrl.searchParams.get("mapId"));
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  try {
    const map = await fetchOwnedMap(auth.user.id, mapId);
    if (!map) {
      return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
    }

    return NextResponse.json({
      mapId: map.id,
      mapName: map.name,
      isPublic: Boolean(map.is_public),
      shareSlug: map.share_slug,
      sharedAt: map.shared_at,
      shareUrl: map.share_slug ? buildShareUrl(request, map.share_slug) : null,
    });
  } catch (err) {
    console.error("Failed to read map share settings:", err);
    return NextResponse.json(
      { error: "Failed to read map share settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as SharePayload;
  const mapId = normalizeMapId(body.mapId);
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const regenerate = toBoolean(body.regenerate);

  try {
    const map = await fetchOwnedMap(auth.user.id, mapId);
    if (!map) {
      return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const shareSlug =
        regenerate || !map.share_slug ? generateShareSlug() : map.share_slug;
      const { data, error } = await admin
        .from("maps")
        .update({
          is_public: true,
          share_slug: shareSlug,
          shared_at: new Date().toISOString(),
        })
        .eq("id", mapId)
        .eq("user_id", auth.user.id)
        .select("id, name, share_slug, is_public, shared_at")
        .single();

      if (!error) {
        return NextResponse.json({
          mapId: data.id,
          mapName: data.name,
          isPublic: Boolean(data.is_public),
          shareSlug: data.share_slug,
          sharedAt: data.shared_at,
          shareUrl: data.share_slug ? buildShareUrl(request, data.share_slug) : null,
        });
      }

      if (error.code !== "23505") {
        lastError = error.message;
        break;
      }

      lastError = "Share slug collision";
    }

    return NextResponse.json(
      { error: lastError || "Failed to enable sharing" },
      { status: 500 }
    );
  } catch (err) {
    console.error("Failed to enable map sharing:", err);
    return NextResponse.json(
      { error: "Failed to enable map sharing" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const mapId = normalizeMapId(body.mapId);
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  try {
    const map = await fetchOwnedMap(auth.user.id, mapId);
    if (!map) {
      return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("maps")
      .update({
        is_public: false,
        share_slug: null,
        shared_at: null,
      })
      .eq("id", mapId)
      .eq("user_id", auth.user.id)
      .select("id, name, share_slug, is_public, shared_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      mapId: data.id,
      mapName: data.name,
      isPublic: Boolean(data.is_public),
      shareSlug: data.share_slug,
      sharedAt: data.shared_at,
      shareUrl: null,
    });
  } catch (err) {
    console.error("Failed to disable map sharing:", err);
    return NextResponse.json(
      { error: "Failed to disable map sharing" },
      { status: 500 }
    );
  }
}
