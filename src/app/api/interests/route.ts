import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";

async function validateUserMap(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
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

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mapId = request.nextUrl.searchParams.get("mapId");
  let query = supabase
    .from("interests")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (mapId) {
    query = query.eq("map_id", mapId);
  }

  const { data: interests, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Supabase returns vector columns as strings — parse them into arrays
  const parsed = interests?.map((interest) => ({
    ...interest,
    embedding:
      typeof interest.embedding === "string"
        ? JSON.parse(interest.embedding)
        : interest.embedding,
  }));

  return NextResponse.json(parsed);
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

  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "Interest name is required" },
      { status: 400 }
    );
  }

  if (!mapId || typeof mapId !== "string") {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const validMap = await validateUserMap(supabase, user.id, mapId);
  if (!validMap) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  // Generate embedding and related topics in parallel
  const [embeddingResult, relatedResult] = await Promise.allSettled([
    generateEmbedding(name),
    suggestRelatedTopics(name),
  ]);

  const embedding =
    embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
  const related_topics =
    relatedResult.status === "fulfilled" ? relatedResult.value : [];

  if (embeddingResult.status === "rejected") {
    console.error("Failed to generate embedding for:", name);
  }

  const { data: interest, error } = await supabase
    .from("interests")
    .insert({
      user_id: user.id,
      map_id: mapId,
      name: name.trim(),
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

  let query = supabase
    .from("interests")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (typeof mapId === "string" && mapId.length > 0) {
    query = query.eq("map_id", mapId);
  }

  const { error } = await query;

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

  const { data: updated, error } = await supabase
    .from("interests")
    .update({ notes })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
