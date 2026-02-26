import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

interface RecommendationItem {
  name: string;
  reason: string;
}

function normalizeRecommendations(payload: unknown): RecommendationItem[] {
  let items: unknown[] = [];

  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.recommendations)) {
      items = obj.recommendations;
    } else if (Array.isArray(obj.items)) {
      items = obj.items;
    }
  }

  return items
    .map((item) => {
      const obj =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
      return { name, reason };
    })
    .filter((item) => item.name.length > 0)
    .map((item) => ({
      name: item.name,
      reason: item.reason || "A strong conceptual fit with your current map.",
    }));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    input: text,
  });

  const embedding = response.data[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response is missing embedding array");
  }

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}`
    );
  }

  return embedding;
}

export async function generateRecommendations(
  interests: string[]
): Promise<{ name: string; reason: string }[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'You are a knowledge recommendation engine. Given a list of interests, suggest exactly 5 new topics the user might enjoy. Return JSON object with key "recommendations", where the value is an array of objects containing "name" and "reason". Do not include topics already listed by the user.',
      },
      {
        role: "user",
        content: `My interests are: ${interests.join(", ")}. Suggest 5 new topics I might enjoy that I haven't listed. Focus on interesting connections between my existing interests.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    return normalizeRecommendations(parsed);
  } catch {
    return [];
  }
}

export async function suggestRelatedTopics(topicName: string): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'You are a knowledge graph expert. Given a topic, suggest exactly 3 closely related subtopics or fields. Return a JSON object with a "topics" array of strings. Only return topic names, no explanations. Keep names concise (1-4 words).',
      },
      {
        role: "user",
        content: `Suggest exactly 3 topics closely related to "${topicName}".`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    return parsed.topics || [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
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
