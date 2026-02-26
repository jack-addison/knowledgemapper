import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import { getMapAccess } from "@/lib/map-access";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { topicA, topicB, mapId } = await request.json();
  if (!topicA || !topicB || !mapId) {
    return NextResponse.json(
      { error: "Two topic names and mapId are required" },
      { status: 400 }
    );
  }
  if (typeof mapId !== "string") {
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

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'You are a knowledge graph expert. Given two topics, find the single best topic that sits at the intersection of both — a field, concept, or subject that meaningfully bridges them. Return a JSON object with "topic" (concise name, 1-5 words) and "reason" (one sentence explaining the connection).',
      },
      {
        role: "user",
        content: `What is the best intersection topic between "${topicA}" and "${topicB}"?`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) {
    return NextResponse.json(
      { error: "Failed to generate connection" },
      { status: 500 }
    );
  }

  let topic: string;
  let reason: string;
  try {
    const parsed = JSON.parse(content);
    topic = parsed.topic;
    reason = parsed.reason || "";
  } catch {
    return NextResponse.json(
      { error: "Failed to parse connection" },
      { status: 500 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: existing } = await admin
    .from("interests")
    .select("name")
    .eq("map_id", access.mapId)
    .ilike("name", topic);

  if (existing && existing.length > 0) {
    return NextResponse.json({
      topic,
      reason,
      alreadyExists: true,
    });
  }

  const [embeddingResult, relatedResult] = await Promise.allSettled([
    generateEmbedding(topic),
    suggestRelatedTopics(topic),
  ]);

  const embedding =
    embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
  const related_topics =
    relatedResult.status === "fulfilled" ? relatedResult.value : [];

  const { error } = await admin.from("interests").insert({
    user_id: user.id,
    map_id: access.mapId,
    name: topic.trim(),
    embedding,
    related_topics,
    notes: "",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ topic, reason, alreadyExists: false });
}
