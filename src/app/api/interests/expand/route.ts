import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import { getMapAccess } from "@/lib/map-access";

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

  const admin = createAdminSupabaseClient();
  const added: string[] = [];
  for (const name of topics) {
    if (typeof name !== "string" || name.trim().length === 0) continue;
    try {
      const [embeddingResult, relatedResult] = await Promise.allSettled([
        generateEmbedding(name),
        suggestRelatedTopics(name),
      ]);

      const embedding =
        embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
      const related_topics =
        relatedResult.status === "fulfilled" ? relatedResult.value : [];

      const { error } = await admin.from("interests").insert({
        user_id: user.id,
        map_id: access.mapId,
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
