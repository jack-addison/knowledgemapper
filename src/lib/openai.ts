import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
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
          "You are a knowledge recommendation engine. Given a list of interests, suggest 5 new topics the user might enjoy. Return JSON array with objects containing 'name' and 'reason' fields. Only return the JSON array, no other text.",
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
    return parsed.recommendations || parsed;
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
