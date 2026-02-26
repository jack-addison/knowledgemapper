import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import type {
  GraphAssistantExtendMapRequest,
  GraphAssistantExtendMapResponse,
} from "@/lib/types";

interface GeneratedTopic {
  name: string;
  reason: string;
}

interface GeneratedExtensionPlan {
  topics: GeneratedTopic[];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function topicKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTopicName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim()
    .slice(0, 120);
}

function parseRequestBody(
  raw: unknown
): { mapId: string; prompt: string; maxTopics: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as GraphAssistantExtendMapRequest;
  const mapId = normalizeString(body.mapId);
  const prompt = normalizeString(body.prompt);
  const maxTopicsRaw = normalizeNumber(body.maxTopics);
  const maxTopics = clampInt(maxTopicsRaw ?? 12, 4, 28);

  if (!mapId) return null;
  if (!prompt) return null;
  if (prompt.length > 3000) return null;

  return { mapId, prompt, maxTopics };
}

function normalizeGeneratedTopics(raw: unknown, maxTopics: number): GeneratedTopic[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const topics: GeneratedTopic[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = cleanTopicName(normalizeString(obj.name));
    const reason = normalizeString(obj.reason).slice(0, 240);
    if (!name) continue;

    const key = topicKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    topics.push({
      name,
      reason: reason || "Assistant-suggested extension topic.",
    });
    if (topics.length >= maxTopics) break;
  }

  return topics;
}

function fallbackTopics(seed: string, maxTopics: number): GeneratedTopic[] {
  const base = cleanTopicName(seed || "research topic");
  if (!base) return [];
  return [
    {
      name: `${base} foundational concepts`,
      reason: "Strengthen conceptual foundation.",
    },
    {
      name: `${base} core methods`,
      reason: "Expand methodological coverage.",
    },
    {
      name: `${base} benchmarks and datasets`,
      reason: "Add evaluation and evidence structure.",
    },
    {
      name: `${base} limitations and failure modes`,
      reason: "Capture constraints and edge cases.",
    },
    {
      name: `${base} future directions`,
      reason: "Add forward-looking research paths.",
    },
  ].slice(0, Math.min(maxTopics, 5));
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on this deployment." },
      { status: 500 }
    );
  }

  const parsed = parseRequestBody(await request.json().catch(() => ({})));
  if (!parsed) {
    return NextResponse.json(
      { error: "mapId and prompt are required. prompt max length is 3000 chars." },
      { status: 400 }
    );
  }

  const { data: map, error: mapError } = await supabase
    .from("maps")
    .select("id, name")
    .eq("id", parsed.mapId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }
  if (!map) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const { data: currentTopics, error: topicsError } = await supabase
    .from("interests")
    .select("name")
    .eq("user_id", user.id)
    .eq("map_id", parsed.mapId)
    .order("created_at", { ascending: true });

  if (topicsError) {
    return NextResponse.json({ error: topicsError.message }, { status: 500 });
  }

  const existingNames = (currentTopics ?? [])
    .map((row) => normalizeString(row.name))
    .filter((name) => name.length > 0);
  const existingNameSet = new Set(existingNames.map((name) => topicKey(name)));

  let extensionPlan: GeneratedExtensionPlan = {
    topics: fallbackTopics(parsed.prompt, parsed.maxTopics),
  };

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const existingList = existingNames.slice(0, 220).join("\n- ");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extend existing knowledge maps. Return strict JSON with a single key: topics (array). Each item must contain name (string) and reason (string). Propose concise, high-value new topic nodes only. Every topic must directly follow the user direction, avoid duplicates, avoid near-duplicates, and remain coherent with the existing map.",
        },
        {
          role: "user",
          content: [
            `Map name: ${map.name}`,
            `User direction for extension: ${parsed.prompt}`,
            `Current topics (${existingNames.length} total):`,
            existingList ? `- ${existingList}` : "- (no existing topics)",
            `Return up to ${parsed.maxTopics} new topic suggestions.`,
          ].join("\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (content) {
      const payload = JSON.parse(content) as Record<string, unknown>;
      const topics = normalizeGeneratedTopics(payload.topics, parsed.maxTopics);
      if (topics.length > 0) {
        extensionPlan = { topics };
      }
    }
  } catch (err) {
    console.warn("Assistant map extension generation failed, using fallback:", err);
  }

  const uniqueNewTopics: GeneratedTopic[] = [];
  const newTopicSet = new Set<string>();
  for (const topic of extensionPlan.topics) {
    const key = topicKey(topic.name);
    if (existingNameSet.has(key) || newTopicSet.has(key)) continue;
    newTopicSet.add(key);
    uniqueNewTopics.push(topic);
    if (uniqueNewTopics.length >= parsed.maxTopics) break;
  }

  if (uniqueNewTopics.length === 0) {
    const emptyResponse: GraphAssistantExtendMapResponse = {
      mapId: map.id,
      mapName: map.name,
      requestedPrompt: parsed.prompt,
      existingTopicCount: existingNames.length,
      topicCount: 0,
      createdCount: 0,
      skippedCount: 0,
      topics: [],
    };
    return NextResponse.json(emptyResponse);
  }

  let createdCount = 0;
  let skippedCount = 0;
  for (const topic of uniqueNewTopics) {
    const [embeddingResult, relatedResult] = await Promise.allSettled([
      generateEmbedding(topic.name),
      suggestRelatedTopics(topic.name),
    ]);

    const embedding =
      embeddingResult.status === "fulfilled" ? embeddingResult.value : null;
    const relatedTopics =
      relatedResult.status === "fulfilled" ? relatedResult.value : [];

    const { error } = await supabase.from("interests").insert({
      user_id: user.id,
      map_id: map.id,
      name: topic.name,
      embedding,
      related_topics: relatedTopics,
      notes: `Extension topic: ${topic.reason}`,
    });

    if (error) {
      skippedCount += 1;
      continue;
    }

    createdCount += 1;
  }

  const response: GraphAssistantExtendMapResponse = {
    mapId: map.id,
    mapName: map.name,
    requestedPrompt: parsed.prompt,
    existingTopicCount: existingNames.length,
    topicCount: uniqueNewTopics.length,
    createdCount,
    skippedCount,
    topics: uniqueNewTopics.map((topic) => topic.name),
  };

  return NextResponse.json(response);
}
