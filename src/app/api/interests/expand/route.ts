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

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { topics, mapId } = await request.json();

  if (!Array.isArray(topics) || topics.length === 0) {
    return NextResponse.json(
      { error: "Topics array is required" },
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

  const added: string[] = [];
  for (const name of topics) {
    try {
      const [embeddingResult, relatedResult] = await Promise.allSettled([
        generateEmbedding(name),
        suggestRelatedTopics(name),
      ]);

      const embedding =
        embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
      const related_topics =
        relatedResult.status === "fulfilled" ? relatedResult.value : [];

      const { error } = await supabase.from("interests").insert({
        user_id: user.id,
        map_id: mapId,
        name: name.trim(),
        embedding,
        related_topics,
        notes: "",
      });
      if (!error) {
        added.push(name);
      }
    } catch (err) {
      console.error(`Failed to add expanded topic "${name}":`, err);
    }
  }

  return NextResponse.json({ added });
}
