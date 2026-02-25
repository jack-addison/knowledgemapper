import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  generateEmbedding,
  suggestRelatedTopics,
} from "@/lib/openai";
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

  const { topicA, topicB } = await request.json();

  if (!topicA || !topicB) {
    return NextResponse.json(
      { error: "Two topic names are required" },
      { status: 400 }
    );
  }

  // Ask AI for the best intersection topic
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

  // Check if user already has this topic
  const { data: existing } = await supabase
    .from("interests")
    .select("name")
    .eq("user_id", user.id)
    .ilike("name", topic);

  if (existing && existing.length > 0) {
    return NextResponse.json({
      topic,
      reason,
      alreadyExists: true,
    });
  }

  // Generate embedding and related topics in parallel
  const [embeddingResult, relatedResult] = await Promise.allSettled([
    generateEmbedding(topic),
    suggestRelatedTopics(topic),
  ]);

  const embedding =
    embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
  const related_topics =
    relatedResult.status === "fulfilled" ? relatedResult.value : [];

  const { error } = await supabase.from("interests").insert({
    user_id: user.id,
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
