import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import { getMapAccess, listAccessibleMapIds } from "@/lib/map-access";

function normalizeInterestName(input: string): string {
  const collapsed = input.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((word) =>
      word.length > 0
        ? `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`
        : word
    )
    .join(" ");
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const mapId = request.nextUrl.searchParams.get("mapId");

  let targetMapIds: string[] = [];
  if (typeof mapId === "string" && mapId.trim().length > 0) {
    const access = await getMapAccess(user.id, mapId.trim());
    if (!access) {
      return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
    }
    targetMapIds = [access.mapId];
  } else {
    targetMapIds = await listAccessibleMapIds(user.id);
  }

  if (targetMapIds.length === 0) {
    return NextResponse.json([]);
  }

  const { data: interests, error } = await admin
    .from("interests")
    .select("*")
    .in("map_id", targetMapIds)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const parsed = interests?.map((interest) => ({
    ...interest,
    embedding:
      typeof interest.embedding === "string"
        ? JSON.parse(interest.embedding)
        : interest.embedding,
  }));

  return NextResponse.json(parsed || []);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, mapId } = await request.json();
  if (typeof name !== "string") {
    return NextResponse.json(
      { error: "Interest name is required" },
      { status: 400 }
    );
  }
  const normalizedName = normalizeInterestName(name);
  if (!normalizedName) {
    return NextResponse.json(
      { error: "Interest name is required" },
      { status: 400 }
    );
  }
  if (!mapId || typeof mapId !== "string") {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const access = await getMapAccess(user.id, mapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You only have view access to this map." },
      { status: 403 }
    );
  }

  const [embeddingResult, relatedResult] = await Promise.allSettled([
    generateEmbedding(normalizedName),
    suggestRelatedTopics(normalizedName),
  ]);

  const embedding =
    embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
  const related_topics =
    relatedResult.status === "fulfilled" ? relatedResult.value : [];

  if (embeddingResult.status === "rejected") {
    console.error("Failed to generate embedding for:", normalizedName);
  }

  const admin = createAdminSupabaseClient();
  const { data: interest, error } = await admin
    .from("interests")
    .insert({
      user_id: user.id,
      map_id: access.mapId,
      name: normalizedName,
      embedding,
      related_topics,
      notes: "",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(interest);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, mapId } = await request.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  let targetMapId = typeof mapId === "string" ? mapId.trim() : "";
  if (!targetMapId) {
    const { data: interest, error } = await admin
      .from("interests")
      .select("map_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !interest) {
      return NextResponse.json({ error: "Interest not found" }, { status: 404 });
    }
    targetMapId = interest.map_id;
  }

  const access = await getMapAccess(user.id, targetMapId);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You only have view access to this map." },
      { status: 403 }
    );
  }

  const { error } = await admin
    .from("interests")
    .delete()
    .eq("id", id)
    .eq("map_id", access.mapId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, notes } = await request.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { error: "Interest id is required" },
      { status: 400 }
    );
  }
  if (typeof notes !== "string") {
    return NextResponse.json(
      { error: "Notes must be a string" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: existing, error: findError } = await admin
    .from("interests")
    .select("id, map_id")
    .eq("id", id)
    .maybeSingle();

  if (findError || !existing) {
    return NextResponse.json({ error: "Interest not found" }, { status: 404 });
  }

  const access = await getMapAccess(user.id, existing.map_id);
  if (!access) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You only have view access to this map." },
      { status: 403 }
    );
  }

  const { data: updated, error } = await admin
    .from("interests")
    .update({ notes })
    .eq("id", id)
    .eq("map_id", access.mapId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
