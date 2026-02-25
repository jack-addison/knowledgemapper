import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: interests, error } = await supabase
    .from("interests")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Parse embeddings
  const parsed = interests?.map((i) => ({
    name: i.name,
    embedding:
      typeof i.embedding === "string"
        ? JSON.parse(i.embedding)
        : i.embedding,
  }));

  // Calculate similarity if we have 2+ interests with embeddings
  let similarity = null;
  if (parsed && parsed.length >= 2 && parsed[0].embedding && parsed[1].embedding) {
    similarity = {
      between: `${parsed[0].name} <-> ${parsed[1].name}`,
      score: cosineSimilarity(parsed[0].embedding, parsed[1].embedding),
      embedding_0_length: parsed[0].embedding.length,
      embedding_1_length: parsed[1].embedding.length,
      embedding_0_is_array: Array.isArray(parsed[0].embedding),
      embedding_1_is_array: Array.isArray(parsed[1].embedding),
    };
  }

  return NextResponse.json({ interests: parsed?.map((p) => ({ name: p.name, has_embedding: !!p.embedding })), similarity });
}
