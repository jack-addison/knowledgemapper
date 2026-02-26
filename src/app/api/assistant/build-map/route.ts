import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import type {
  GraphAssistantBuildMapRequest,
  GraphAssistantBuildMapResponse,
} from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

interface GeneratedTopic {
  name: string;
  reason: string;
}

interface GeneratedMapPlan {
  mapName: string;
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

function parseRequestBody(raw: unknown): { prompt: string; maxTopics: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as GraphAssistantBuildMapRequest;
  const prompt = normalizeString(body.prompt);
  const maxTopicsRaw = normalizeNumber(body.maxTopics);
  const maxTopics = clampInt(maxTopicsRaw ?? 18, 6, 28);

  if (!prompt || prompt.length > 3000) return null;
  return { prompt, maxTopics };
}

function cleanTopicName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim()
    .slice(0, 120);
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

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    topics.push({
      name,
      reason: reason || "Core topic for this map.",
    });
    if (topics.length >= maxTopics) break;
  }

  return topics;
}

function normalizeMapName(raw: unknown, prompt: string): string {
  const candidate = cleanTopicName(normalizeString(raw));
  if (candidate.length > 0) return candidate;
  return cleanTopicName(`Map: ${prompt}`);
}

function fallbackTopicsFromPrompt(prompt: string, maxTopics: number): GeneratedTopic[] {
  const cleanedPrompt = cleanTopicName(prompt);
  if (!cleanedPrompt) return [];
  return [
    { name: cleanedPrompt, reason: "Primary requested domain." },
    { name: `${cleanedPrompt} methods`, reason: "Methodological foundation." },
    { name: `${cleanedPrompt} applications`, reason: "Applied perspective." },
  ].slice(0, Math.max(3, Math.min(maxTopics, 5)));
}

async function createMapWithUniqueName(
  supabase: SupabaseClient,
  userId: string,
  preferredName: string
): Promise<{ id: string; name: string }> {
  const baseName = preferredName.slice(0, 120).trim() || "New research map";

  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = attempt === 0 ? "" : ` (${attempt + 1})`;
    const candidate = `${baseName}${suffix}`.slice(0, 120);

    const { data, error } = await supabase
      .from("maps")
      .insert({
        user_id: userId,
        name: candidate,
      })
      .select("id, name")
      .single();

    if (!error && data) {
      return data;
    }

    if (error?.code !== "23505") {
      throw new Error(error?.message || "Failed to create map");
    }
  }

  throw new Error("Unable to create map with a unique name.");
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
      { error: "prompt is required (max 3000 chars)." },
      { status: 400 }
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  let plan: GeneratedMapPlan = {
    mapName: cleanTopicName(parsed.prompt),
    topics: fallbackTopicsFromPrompt(parsed.prompt, parsed.maxTopics),
  };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You design high-quality knowledge maps. Return strict JSON with keys: mapName (string) and topics (array). Each topics item must have name (string) and reason (string). Generate 12-24 concise topic names that form a coherent coverage map from foundations to methods to applications. Avoid duplicates.",
        },
        {
          role: "user",
          content: `Build a knowledge map plan from this request: "${parsed.prompt}".`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (content) {
      const payload = JSON.parse(content) as Record<string, unknown>;
      const mapName = normalizeMapName(payload.mapName, parsed.prompt);
      const topics = normalizeGeneratedTopics(payload.topics, parsed.maxTopics);
      if (topics.length > 0) {
        plan = { mapName, topics };
      }
    }
  } catch (err) {
    console.warn("Assistant map plan generation failed, using fallback:", err);
  }

  if (plan.topics.length === 0) {
    return NextResponse.json(
      { error: "Unable to generate map topics from this prompt." },
      { status: 502 }
    );
  }

  try {
    const createdMap = await createMapWithUniqueName(supabase, user.id, plan.mapName);

    let createdCount = 0;
    let skippedCount = 0;
    const existingNames = new Set<string>();
    const topics = plan.topics.slice(0, parsed.maxTopics);

    for (const topic of topics) {
      const normalizedName = topic.name.toLowerCase();
      if (existingNames.has(normalizedName)) {
        skippedCount += 1;
        continue;
      }
      existingNames.add(normalizedName);

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
        map_id: createdMap.id,
        name: topic.name,
        embedding,
        related_topics: relatedTopics,
        notes: `Seed topic: ${topic.reason}`,
      });

      if (error) {
        skippedCount += 1;
        continue;
      }

      createdCount += 1;
    }

    const response: GraphAssistantBuildMapResponse = {
      mapId: createdMap.id,
      mapName: createdMap.name,
      requestedPrompt: parsed.prompt,
      topicCount: topics.length,
      createdCount,
      skippedCount,
      topics: topics.map((topic) => topic.name),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Failed to build assistant map:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build map." },
      { status: 500 }
    );
  }
}
