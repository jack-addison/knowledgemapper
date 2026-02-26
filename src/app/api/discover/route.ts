import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateRecommendations } from "@/lib/openai";

interface InterestRow {
  name: string;
  related_topics: string[] | null;
}

interface RecommendationItem {
  name: string;
  reason: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeAndDeduplicate(
  items: RecommendationItem[],
  existingNames: Set<string>
): RecommendationItem[] {
  const seen = new Set<string>();
  const cleaned: RecommendationItem[] = [];

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (existingNames.has(key) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      name,
      reason: item.reason?.trim() || "A relevant next step for your map.",
    });
  }

  return cleaned;
}

function buildFallbackRecommendations(
  interests: InterestRow[],
  existingNames: Set<string>
): RecommendationItem[] {
  const frequency = new Map<string, number>();
  const sourceTopics = new Map<string, Set<string>>();
  const displayName = new Map<string, string>();

  for (const interest of interests) {
    const topics = Array.isArray(interest.related_topics)
      ? interest.related_topics
      : [];
    for (const topic of topics) {
      const name = topic.trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (existingNames.has(key)) continue;

      frequency.set(key, (frequency.get(key) || 0) + 1);
      if (!displayName.has(key)) {
        displayName.set(key, name);
      }

      const sources = sourceTopics.get(key) || new Set<string>();
      sources.add(interest.name);
      sourceTopics.set(key, sources);
    }
  }

  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => {
      const sources = Array.from(sourceTopics.get(key) || []).slice(0, 2);
      const topicName = displayName.get(key) || key;
      return {
        name: topicName,
        reason:
          sources.length > 0
            ? `Often related to ${sources.join(" and ")} in your map.`
            : "A relevant next step for your current interests.",
      };
    });
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
    .select("name, related_topics")
    .eq("user_id", user.id);

  if (mapId) {
    query = query.eq("map_id", mapId);
  }

  const { data: interests, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!interests || interests.length === 0) {
    return NextResponse.json(
      { error: "Add some interests first" },
      { status: 400 }
    );
  }

  const interestRows = interests as InterestRow[];
  const interestNames = interestRows.map((i) => i.name);
  const existingNames = new Set(interestNames.map(normalizeName));

  try {
    const aiRecommendations = sanitizeAndDeduplicate(
      await generateRecommendations(interestNames),
      existingNames
    );

    const fallback = sanitizeAndDeduplicate(
      buildFallbackRecommendations(interestRows, existingNames),
      existingNames
    );

    const merged = sanitizeAndDeduplicate(
      [...aiRecommendations, ...fallback],
      existingNames
    ).slice(0, 5);

    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
