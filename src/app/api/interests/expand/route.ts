import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { topics } = await request.json();

  if (!Array.isArray(topics) || topics.length === 0) {
    return NextResponse.json(
      { error: "Topics array is required" },
      { status: 400 }
    );
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
