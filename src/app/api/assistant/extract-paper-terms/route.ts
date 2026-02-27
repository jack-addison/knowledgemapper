import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateEmbedding, suggestRelatedTopics } from "@/lib/openai";
import type { GraphAssistantExtractPaperResponse } from "@/lib/types";

export const runtime = "nodejs";

interface ExtractedTopic {
  name: string;
  reason: string;
  excerpt: string;
}

interface MapPaperContextRow {
  id: string;
  file_name: string;
  paper_title: string;
  extracted_text: string;
  text_char_count?: number | null;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOPICS = 18;
const MIN_TOPICS = 6;
const MAX_TOPICS = 30;
const MAX_FOCUS_PROMPT_CHARS = 900;
const MAX_INPUT_TEXT_CHARS = 55000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".tex",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
]);

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

function cleanTopicName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim()
    .slice(0, 120);
}

function topicKey(name: string): string {
  return cleanTopicName(name).toLowerCase();
}

function getFileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index).toLowerCase();
}

function buildModelTextWindow(text: string): string {
  const normalized = text.replace(/\r/g, "");
  if (normalized.length <= MAX_INPUT_TEXT_CHARS) return normalized;

  const head = normalized.slice(0, 22000);
  const midStart = Math.max(0, Math.floor(normalized.length / 2) - 8000);
  const middle = normalized.slice(midStart, midStart + 16000);
  const tail = normalized.slice(-17000);

  return [
    head,
    "\n\n[... middle excerpt ...]\n\n",
    middle,
    "\n\n[... ending excerpt ...]\n\n",
    tail,
  ].join("");
}

async function extractTextFromFile(file: File): Promise<string> {
  const name = normalizeString(file.name) || "paper";
  const extension = getFileExtension(name);
  const mime = (file.type || "").toLowerCase();
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  if (buffer.byteLength === 0) {
    throw new Error("Uploaded file is empty.");
  }

  const isPdf = mime.includes("pdf") || extension === ".pdf";
  if (isPdf) {
    const parsed = await pdfParse(buffer);
    const text = normalizeString(parsed.text);
    if (!text) {
      throw new Error("Could not extract readable text from this PDF.");
    }
    return text;
  }

  const isPlainText = mime.startsWith("text/") || TEXT_EXTENSIONS.has(extension);
  if (isPlainText) {
    const decoder = new TextDecoder("utf-8");
    const text = normalizeString(decoder.decode(buffer));
    if (!text) {
      throw new Error("Could not extract readable text from this file.");
    }
    return text;
  }

  throw new Error("Unsupported file type. Use PDF or plain text formats.");
}

function normalizeExtractedTopics(raw: unknown, maxTopics: number): ExtractedTopic[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const topics: ExtractedTopic[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = cleanTopicName(normalizeString(obj.name));
    const reason = normalizeString(obj.reason).slice(0, 320);
    const excerpt = normalizeString(obj.excerpt).slice(0, 320);
    if (!name) continue;

    const key = topicKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    topics.push({
      name,
      reason: reason || "Important concept from this paper.",
      excerpt,
    });
    if (topics.length >= maxTopics) break;
  }

  return topics;
}

function normalizePaperTitle(value: unknown, fileName: string): string {
  const title = normalizeString(value);
  if (title.length > 0) return title.slice(0, 180);
  return fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 180) || "Uploaded paper";
}

function buildTopicNotes(topic: ExtractedTopic, paperTitle: string, fileName: string): string {
  const lines = [
    `Paper-derived topic from "${paperTitle}"`,
    `Source file: ${fileName}`,
    `Why it matters: ${topic.reason}`,
  ];
  if (topic.excerpt) {
    lines.push(`Paper context: ${topic.excerpt}`);
  }
  return lines.join("\n");
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01";
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

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid multipart request." }, { status: 400 });
  }

  const mapId = normalizeString(formData.get("mapId"));
  const paperContextId = normalizeString(formData.get("paperContextId"));
  const focusPrompt = normalizeString(formData.get("focusPrompt")).slice(
    0,
    MAX_FOCUS_PROMPT_CHARS
  );
  const maxTopics = clampInt(
    normalizeNumber(formData.get("maxTopics")) ?? DEFAULT_MAX_TOPICS,
    MIN_TOPICS,
    MAX_TOPICS
  );
  const fileValue = formData.get("file");

  if (!mapId) {
    return NextResponse.json({ error: "mapId is required." }, { status: 400 });
  }
  const hasFile = fileValue instanceof File;
  if (!hasFile && !paperContextId) {
    return NextResponse.json(
      { error: "Provide either file or paperContextId." },
      { status: 400 }
    );
  }
  if (hasFile && fileValue.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File too large. Use a file up to 10MB." },
      { status: 413 }
    );
  }

  const { data: map, error: mapError } = await supabase
    .from("maps")
    .select("id, name")
    .eq("id", mapId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }
  if (!map) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("interests")
    .select("name")
    .eq("user_id", user.id)
    .eq("map_id", mapId);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingNameSet = new Set(
    (existingRows || [])
      .map((row) => normalizeString(row.name))
      .filter((name) => name.length > 0)
      .map((name) => topicKey(name))
  );

  let sourceContextId: string | null = null;
  let fileName = hasFile ? normalizeString(fileValue.name) || "uploaded-paper" : "paper";
  let extractedText = "";
  let paperTitle = fileName;

  if (paperContextId) {
    const { data: storedContext, error: storedContextError } = await supabase
      .from("map_paper_contexts")
      .select("id, file_name, paper_title, extracted_text, text_char_count")
      .eq("id", paperContextId)
      .eq("map_id", mapId)
      .eq("user_id", user.id)
      .maybeSingle<MapPaperContextRow>();

    if (storedContextError) {
      if (isMissingTableError(storedContextError)) {
        return NextResponse.json(
          { error: "Paper context storage is not set up. Run supabase-paper-contexts.sql." },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: storedContextError.message }, { status: 500 });
    }
    if (!storedContext) {
      return NextResponse.json(
        { error: "Invalid paperContextId for this map." },
        { status: 400 }
      );
    }

    sourceContextId = storedContext.id;
    fileName = normalizeString(storedContext.file_name) || fileName;
    paperTitle = normalizeString(storedContext.paper_title) || paperTitle;
    extractedText = normalizeString(storedContext.extracted_text);
  }

  if (hasFile) {
    try {
      extractedText = await extractTextFromFile(fileValue);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to extract text from file.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    paperTitle = fileName;
  }

  if (!extractedText) {
    return NextResponse.json(
      { error: "No reusable text context found for extraction." },
      { status: 400 }
    );
  }

  const modelInputText = buildModelTextWindow(extractedText);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let extractedTopics: ExtractedTopic[] = [];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract map-worthy terms from research papers. Return strict JSON with keys: paperTitle (string) and topics (array). Each topic item must have name (string), reason (string), and excerpt (string, short quote/paraphrase). Topic names should be concise (1-5 words), specific, and high-signal. Prioritize unusual terms, methods, datasets, frameworks, assumptions, failure modes, and surprising findings. Avoid generic words and duplicates.",
        },
        {
          role: "user",
          content: [
            `Source file: ${fileName}`,
            focusPrompt
              ? `Extraction focus from user: ${focusPrompt}`
              : "Extraction focus: broad coverage of key and unusual terms.",
            `Return up to ${maxTopics} topics.`,
            "",
            "Paper text:",
            modelInputText,
          ].join("\n"),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "The assistant could not extract topics from this file." },
        { status: 502 }
      );
    }
    const payload = JSON.parse(content) as Record<string, unknown>;
    paperTitle = normalizePaperTitle(payload.paperTitle, paperTitle || fileName);
    extractedTopics = normalizeExtractedTopics(payload.topics, maxTopics);
  } catch (err) {
    console.error("Paper topic extraction failed:", err);
    return NextResponse.json(
      { error: "Failed to extract topics from this paper." },
      { status: 502 }
    );
  }

  const uniqueTopics: ExtractedTopic[] = [];
  const inBatch = new Set<string>();
  for (const topic of extractedTopics) {
    const key = topicKey(topic.name);
    if (existingNameSet.has(key) || inBatch.has(key)) continue;
    inBatch.add(key);
    uniqueTopics.push(topic);
    if (uniqueTopics.length >= maxTopics) break;
  }

  if (uniqueTopics.length === 0) {
    const emptyResponse: GraphAssistantExtractPaperResponse = {
      mapId: map.id,
      mapName: map.name,
      fileName,
      paperTitle,
      paperContextId: sourceContextId,
      topicCount: 0,
      createdCount: 0,
      skippedCount: extractedTopics.length,
      topics: [],
    };
    return NextResponse.json(emptyResponse);
  }

  if (hasFile && !sourceContextId) {
    const { data: insertedContext, error: insertContextError } = await supabase
      .from("map_paper_contexts")
      .insert({
        user_id: user.id,
        map_id: mapId,
        file_name: fileName,
        paper_title: paperTitle,
        extracted_text: modelInputText,
        text_char_count: modelInputText.length,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (insertContextError) {
      if (isMissingTableError(insertContextError)) {
        return NextResponse.json(
          { error: "Paper context storage is not set up. Run supabase-paper-contexts.sql." },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: insertContextError.message }, { status: 500 });
    }
    sourceContextId = insertedContext?.id || null;
  }

  let createdCount = 0;
  let skippedCount = 0;
  for (const topic of uniqueTopics) {
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
      notes: buildTopicNotes(topic, paperTitle, fileName),
    });

    if (error) {
      skippedCount += 1;
      continue;
    }

    createdCount += 1;
  }

  const response: GraphAssistantExtractPaperResponse = {
    mapId: map.id,
    mapName: map.name,
    fileName,
    paperTitle,
    paperContextId: sourceContextId,
    topicCount: uniqueTopics.length,
    createdCount,
    skippedCount,
    topics: uniqueTopics.map((topic) => topic.name),
  };
  return NextResponse.json(response);
}
