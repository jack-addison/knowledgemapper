import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type {
  GraphAssistantMode,
  GraphAssistantCitation,
  GraphAssistantQueryResponse,
  GraphAssistantScope,
} from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type ContextDocKind =
  | "node"
  | "node_evidence"
  | "edge"
  | "edge_evidence"
  | "paper_context"
  | "external_paper";

interface OpenAlexAuthorship {
  author?: {
    display_name?: string | null;
  } | null;
}

interface OpenAlexWork {
  id?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: {
      display_name?: string | null;
    } | null;
  } | null;
  authorships?: OpenAlexAuthorship[] | null;
}

interface InterestRow {
  id: string;
  map_id: string;
  name: string;
  notes: string | null;
}

interface InterestEvidenceRow {
  id: string;
  interest_id: string;
  title: string;
  url: string;
  year: number | null;
  journal: string | null;
  authors: string[] | null;
  reason: string | null;
}

interface EdgeEvidenceRow {
  id: string;
  interest_a_id: string;
  interest_b_id: string;
  title: string;
  url: string;
  year: number | null;
  journal: string | null;
  authors: string[] | null;
  reason: string | null;
}

interface EdgeNotesRow {
  interest_a_id: string;
  interest_b_id: string;
  notes: string | null;
}

interface MapPaperContextRow {
  id: string;
  file_name: string;
  paper_title: string;
  extracted_text: string;
  created_at: string;
}

interface AssistantContextDoc {
  id: string;
  kind: ContextDocKind;
  title: string;
  text: string;
  lowerText: string;
  tokens: Set<string>;
  nodeIds: string[];
  edgeKey: string | null;
  citation: GraphAssistantCitation;
}

interface ParsedPayload {
  mapId: string;
  scope: GraphAssistantScope;
  assistantMode: GraphAssistantMode;
  question: string;
  nodeId: string | null;
  interestAId: string | null;
  interestBId: string | null;
  edgeSimilarity: number | null;
  allowExternalPapers: boolean;
}

const MAX_CONTEXT_DOCS = 18;
const MAX_DOC_TEXT_CHARS = 900;
const MAX_EXTERNAL_PAPERS = 5;
const MAX_SAVED_PAPER_CONTEXTS = 24;
const OPENALEX_WORKS_URL = "https://api.openalex.org/works";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScope(value: unknown): GraphAssistantScope | null {
  if (value === "map" || value === "node" || value === "edge") return value;
  return null;
}

function normalizeMode(value: unknown): GraphAssistantMode {
  return value === "general" ? "general" : "grounded";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
      .slice(0, 8);
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01";
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function excerptAroundKeywords(
  text: string,
  keywords: string[],
  maxChars = 420
): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  let matchIndex = -1;
  for (const keyword of keywords) {
    const term = keyword.trim().toLowerCase();
    if (term.length < 4) continue;
    const index = lower.indexOf(term);
    if (index >= 0) {
      matchIndex = index;
      break;
    }
  }

  if (matchIndex < 0) {
    return clampText(normalized, maxChars);
  }

  const start = Math.max(0, matchIndex - Math.floor(maxChars / 3));
  return clampText(normalized.slice(start, start + maxChars), maxChars);
}

function findMentionedNodeIds(
  text: string,
  interests: InterestRow[],
  maxMatches = 10
): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];

  for (const interest of interests) {
    const name = interest.name.trim().toLowerCase();
    if (name.length < 3) continue;
    if (!lower.includes(name)) continue;
    matches.push(interest.id);
    if (matches.length >= maxMatches) break;
  }

  return matches;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function parsePayload(body: unknown): ParsedPayload | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;

  const mapId = normalizeString(raw.mapId);
  const scope = normalizeScope(raw.scope);
  const assistantMode = normalizeMode(raw.assistantMode);
  const question = normalizeString(raw.question);
  const nodeId = normalizeString(raw.nodeId) || null;
  const interestAId = normalizeString(raw.interestAId) || null;
  const interestBId = normalizeString(raw.interestBId) || null;
  const edgeSimilarity = normalizeNumber(raw.edgeSimilarity);
  const allowExternalPapers = normalizeBoolean(raw.allowExternalPapers);

  if (!mapId || !scope || !question) return null;
  if (question.length > 4000) return null;

  if (scope === "node" && !nodeId) return null;
  if (scope === "edge" && (!interestAId || !interestBId)) return null;

  return {
    mapId,
    scope,
    assistantMode,
    question,
    nodeId,
    interestAId,
    interestBId,
    edgeSimilarity,
    allowExternalPapers,
  };
}

async function validateUserMap(
  supabase: SupabaseClient,
  userId: string,
  mapId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("maps")
    .select("id")
    .eq("id", mapId)
    .eq("user_id", userId)
    .maybeSingle();

  return !error && Boolean(data);
}

function clampText(value: string, limit = MAX_DOC_TEXT_CHARS): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const cleaned = doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function resolveWorkUrl(work: OpenAlexWork): string | null {
  const landing = work.primary_location?.landing_page_url?.trim();
  if (landing) return landing;

  const doi = normalizeDoi(work.doi);
  if (doi) return `https://doi.org/${doi}`;

  const openAlexId = work.id?.trim();
  if (openAlexId) return openAlexId;

  return null;
}

function decodeAbstractInvertedIndex(
  abstractIndex: Record<string, number[]> | null | undefined
): string {
  if (!abstractIndex || typeof abstractIndex !== "object") return "";
  const positioned: Array<{ index: number; word: string }> = [];

  for (const [word, positions] of Object.entries(abstractIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (!Number.isInteger(position) || position < 0) continue;
      positioned.push({ index: position, word });
    }
  }

  if (positioned.length === 0) return "";

  positioned.sort((a, b) => a.index - b.index);
  return positioned.map((item) => item.word).join(" ");
}

function toExternalPaperDoc(work: OpenAlexWork): AssistantContextDoc | null {
  const title = work.display_name?.trim();
  if (!title) return null;

  const url = resolveWorkUrl(work);
  if (!url) return null;

  const workId = work.id?.trim() || `title:${title.toLowerCase().replace(/\s+/g, "-")}`;
  const authors =
    work.authorships
      ?.map((entry) => entry.author?.display_name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 6) || [];
  const year =
    typeof work.publication_year === "number" ? work.publication_year : null;
  const journal = work.primary_location?.source?.display_name?.trim() || "Unknown venue";
  const abstractText = decodeAbstractInvertedIndex(work.abstract_inverted_index);
  const summary = abstractText
    ? clampText(abstractText, 500)
    : "Abstract unavailable in OpenAlex metadata.";

  const text =
    `External paper: ${title}${year ? ` (${year})` : ""}\n` +
    `Venue: ${journal}\n` +
    `${authors.length > 0 ? `Authors: ${authors.join(", ")}\n` : ""}` +
    `Abstract summary: ${summary}`;

  return {
    id: `external-paper:${workId}`,
    kind: "external_paper",
    title: `External paper: ${title}`,
    text,
    lowerText: text.toLowerCase(),
    tokens: tokenize(text),
    nodeIds: [],
    edgeKey: null,
    citation: {
      id: `external-paper:${workId}`,
      type: "paper",
      label: title,
      snippet: summary,
      url,
      paperTitle: title,
      year,
      journal,
      authors,
      reason: "Live paper metadata from OpenAlex.",
      sourceProvider: "openalex",
    },
  };
}

async function fetchExternalPaperDocs(query: string): Promise<AssistantContextDoc[]> {
  const url = new URL(OPENALEX_WORKS_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(MAX_EXTERNAL_PAPERS));
  url.searchParams.set("sort", "relevance_score:desc");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenAlex lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as { results?: OpenAlexWork[] };
  const works = Array.isArray(payload.results) ? payload.results : [];
  return works
    .map((work) => toExternalPaperDoc(work))
    .filter((item): item is AssistantContextDoc => Boolean(item))
    .slice(0, MAX_EXTERNAL_PAPERS);
}

function scoreDoc(
  doc: AssistantContextDoc,
  queryTokens: Set<string>,
  questionLower: string,
  scope: GraphAssistantScope,
  nodeId: string | null,
  selectedEdgeKey: string | null,
  selectedEdgeNodeIds: string[]
): number {
  let score = 0;

  for (const token of queryTokens) {
    if (doc.tokens.has(token)) score += 3;
  }

  if (questionLower.length >= 8 && doc.lowerText.includes(questionLower)) {
    score += 8;
  }

  if (scope === "node" && nodeId && doc.nodeIds.includes(nodeId)) {
    score += 6;
  }

  if (scope === "edge") {
    if (selectedEdgeKey && doc.edgeKey === selectedEdgeKey) {
      score += 8;
    }
    if (doc.nodeIds.some((id) => selectedEdgeNodeIds.includes(id))) {
      score += 3;
    }
  }

  if (doc.kind === "node_evidence" || doc.kind === "edge_evidence") {
    score += 1;
  }
  if (doc.kind === "paper_context") {
    score += 2;
  }
  if (doc.kind === "external_paper") {
    score += 2;
  }

  return score;
}

function uniqueCitations(items: GraphAssistantCitation[]): GraphAssistantCitation[] {
  const seen = new Set<string>();
  const output: GraphAssistantCitation[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function normalizeStringList(value: unknown, maxItems = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parsePayload(await request.json().catch(() => ({})));
  if (!parsed) {
    return NextResponse.json(
      { error: "mapId, scope, and question are required." },
      { status: 400 }
    );
  }

  const mapIsValid = await validateUserMap(supabase, user.id, parsed.mapId);
  if (!mapIsValid) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on this deployment." },
      { status: 500 }
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  if (parsed.assistantMode === "general") {
    try {
      let focusContext = `Scope focus: ${parsed.scope}.`;

      if (parsed.scope === "map") {
        const [{ data: mapRow }, countResult, { data: previewRows }] =
          await Promise.all([
            supabase
              .from("maps")
              .select("name")
              .eq("id", parsed.mapId)
              .eq("user_id", user.id)
              .maybeSingle(),
            supabase
              .from("interests")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.id)
              .eq("map_id", parsed.mapId),
            supabase
              .from("interests")
              .select("name")
              .eq("user_id", user.id)
              .eq("map_id", parsed.mapId)
              .order("created_at", { ascending: true })
              .limit(8),
          ]);

        const topicCount =
          typeof countResult.count === "number" ? countResult.count : 0;
        const preview = (previewRows || [])
          .map((row) => row.name)
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
          .slice(0, 8);
        const mapName =
          typeof mapRow?.name === "string" && mapRow.name.trim().length > 0
            ? mapRow.name.trim()
            : "Current map";

        focusContext =
          `Scope focus: map.\n` +
          `Map name: ${mapName}\n` +
          `Approx topic count: ${topicCount}\n` +
          `Topic preview: ${preview.length > 0 ? preview.join(", ") : "none yet"}`;
      } else if (parsed.scope === "node" && parsed.nodeId) {
        const { data: nodeRow } = await supabase
          .from("interests")
          .select("id, name, notes")
          .eq("user_id", user.id)
          .eq("map_id", parsed.mapId)
          .eq("id", parsed.nodeId)
          .maybeSingle();

        if (!nodeRow) {
          return NextResponse.json(
            { error: "Invalid nodeId for this map" },
            { status: 400 }
          );
        }

        const nodeName =
          typeof nodeRow.name === "string" && nodeRow.name.trim().length > 0
            ? nodeRow.name.trim()
            : parsed.nodeId;
        const nodeNotes =
          typeof nodeRow.notes === "string" && nodeRow.notes.trim().length > 0
            ? clampText(nodeRow.notes.trim(), 260)
            : "No notes saved.";

        focusContext =
          `Scope focus: node.\n` +
          `Node: ${nodeName}\n` +
          `Saved notes: ${nodeNotes}`;
      } else if (
        parsed.scope === "edge" &&
        parsed.interestAId &&
        parsed.interestBId
      ) {
        if (parsed.interestAId === parsed.interestBId) {
          return NextResponse.json(
            { error: "Edge requires two distinct nodes." },
            { status: 400 }
          );
        }

        const pairA =
          parsed.interestAId < parsed.interestBId
            ? parsed.interestAId
            : parsed.interestBId;
        const pairB =
          parsed.interestAId < parsed.interestBId
            ? parsed.interestBId
            : parsed.interestAId;

        const [{ data: edgeNodes }, { data: edgeNoteRow }] = await Promise.all([
          supabase
            .from("interests")
            .select("id, name")
            .eq("user_id", user.id)
            .eq("map_id", parsed.mapId)
            .in("id", [pairA, pairB]),
          supabase
            .from("edge_notes")
            .select("notes")
            .eq("user_id", user.id)
            .eq("map_id", parsed.mapId)
            .eq("interest_a_id", pairA)
            .eq("interest_b_id", pairB)
            .maybeSingle(),
        ]);

        if (!edgeNodes || edgeNodes.length !== 2) {
          return NextResponse.json(
            { error: "Invalid edge node ids for this map" },
            { status: 400 }
          );
        }

        const source =
          edgeNodes.find((node) => node.id === pairA)?.name || "Node A";
        const target =
          edgeNodes.find((node) => node.id === pairB)?.name || "Node B";
        const edgeNotes =
          typeof edgeNoteRow?.notes === "string" && edgeNoteRow.notes.trim().length > 0
            ? clampText(edgeNoteRow.notes.trim(), 260)
            : "No edge notes saved.";

        focusContext =
          `Scope focus: edge.\n` +
          `Edge: ${source} ↔ ${target}\n` +
          `Saved edge notes: ${edgeNotes}`;
      }

      const {
        data: paperContextRows,
        error: paperContextError,
      } = await supabase
        .from("map_paper_contexts")
        .select("id, file_name, paper_title, extracted_text, created_at")
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId)
        .order("created_at", { ascending: false })
        .limit(6)
        .returns<MapPaperContextRow[]>();

      if (paperContextError && !isMissingTableError(paperContextError)) {
        return NextResponse.json({ error: paperContextError.message }, { status: 500 });
      }

      if (paperContextRows && paperContextRows.length > 0) {
        const keywords = Array.from(tokenize(parsed.question));
        const paperContextBlock = paperContextRows
          .slice(0, 3)
          .map((row, index) => {
            const title = row.paper_title?.trim() || row.file_name || `Paper ${index + 1}`;
            const snippet = excerptAroundKeywords(row.extracted_text || "", keywords, 260);
            return (
              `P${index + 1}: ${title}\n` +
              `Source file: ${row.file_name}\n` +
              `Excerpt: ${snippet || "No text excerpt available."}`
            );
          })
          .join("\n\n");

        focusContext += `\n\nSaved paper contexts:\n${paperContextBlock}`;
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are KnowledgeMapper's AI assistant. Answer general questions clearly and concisely, like a normal chat assistant. You may answer beyond map data. Use the provided focus context, including saved paper excerpts, to keep the response oriented to the selected map/node/edge. If uncertain, say so. Return strict JSON with keys: answer (string), suggestedFollowups (array of short strings).",
          },
          {
            role: "user",
            content: `Focus context:\n${focusContext}\n\nQuestion:\n${parsed.question}`,
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Assistant did not return content.");
      }

      const payload = JSON.parse(content) as Record<string, unknown>;
      const answer =
        typeof payload.answer === "string" && payload.answer.trim().length > 0
          ? payload.answer.trim()
          : "I could not generate a response for that question.";
      const suggestedFollowups = normalizeStringList(payload.suggestedFollowups, 4);

      const response: GraphAssistantQueryResponse = {
        answer,
        scope: parsed.scope,
        assistantMode: "general",
        citations: [],
        insufficientEvidence: false,
        suggestedFollowups,
        contextCount: 0,
        externalPaperCount: 0,
        generatedAt: new Date().toISOString(),
      };

      return NextResponse.json(response);
    } catch (err) {
      console.error("General assistant query failed:", err);
      return NextResponse.json(
        { error: "Failed to generate assistant answer." },
        { status: 502 }
      );
    }
  }

  const [interestsRes, interestEvidenceRes, edgeEvidenceRes, edgeNotesRes, paperContextRes] =
    await Promise.all([
      supabase
        .from("interests")
        .select("id, map_id, name, notes")
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId),
      supabase
        .from("interest_evidence")
        .select("id, interest_id, title, url, year, journal, authors, reason")
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId),
      supabase
        .from("edge_evidence")
        .select(
          "id, interest_a_id, interest_b_id, title, url, year, journal, authors, reason"
        )
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId),
      supabase
        .from("edge_notes")
        .select("interest_a_id, interest_b_id, notes")
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId),
      supabase
        .from("map_paper_contexts")
        .select("id, file_name, paper_title, extracted_text, created_at")
        .eq("user_id", user.id)
        .eq("map_id", parsed.mapId)
        .order("created_at", { ascending: false })
        .limit(MAX_SAVED_PAPER_CONTEXTS)
        .returns<MapPaperContextRow[]>(),
    ]);

  if (interestsRes.error) {
    return NextResponse.json({ error: interestsRes.error.message }, { status: 500 });
  }
  if (interestEvidenceRes.error) {
    return NextResponse.json(
      { error: interestEvidenceRes.error.message },
      { status: 500 }
    );
  }
  if (edgeEvidenceRes.error) {
    return NextResponse.json({ error: edgeEvidenceRes.error.message }, { status: 500 });
  }
  if (edgeNotesRes.error) {
    return NextResponse.json({ error: edgeNotesRes.error.message }, { status: 500 });
  }
  if (paperContextRes.error && !isMissingTableError(paperContextRes.error)) {
    return NextResponse.json({ error: paperContextRes.error.message }, { status: 500 });
  }

  const interests = (interestsRes.data || []) as InterestRow[];
  const interestEvidence = (interestEvidenceRes.data || []) as InterestEvidenceRow[];
  const edgeEvidence = (edgeEvidenceRes.data || []) as EdgeEvidenceRow[];
  const edgeNotes = (edgeNotesRes.data || []) as EdgeNotesRow[];
  const paperContexts =
    paperContextRes.error && isMissingTableError(paperContextRes.error)
      ? []
      : ((paperContextRes.data || []) as MapPaperContextRow[]);

  const interestById = new Map<string, InterestRow>();
  for (const interest of interests) {
    interestById.set(interest.id, interest);
  }

  if (parsed.scope === "node" && parsed.nodeId && !interestById.has(parsed.nodeId)) {
    return NextResponse.json({ error: "Invalid nodeId for this map" }, { status: 400 });
  }

  let selectedEdgeKey: string | null = null;
  let selectedEdgeNodeIds: string[] = [];
  if (parsed.scope === "edge" && parsed.interestAId && parsed.interestBId) {
    if (parsed.interestAId === parsed.interestBId) {
      return NextResponse.json(
        { error: "Edge requires two distinct nodes." },
        { status: 400 }
      );
    }
    if (
      !interestById.has(parsed.interestAId) ||
      !interestById.has(parsed.interestBId)
    ) {
      return NextResponse.json(
        { error: "Invalid edge node ids for this map" },
        { status: 400 }
      );
    }
    selectedEdgeKey = edgeKey(parsed.interestAId, parsed.interestBId);
    selectedEdgeNodeIds = [parsed.interestAId, parsed.interestBId];
  }

  const docs: AssistantContextDoc[] = [];

  for (const node of interests) {
    const notes = node.notes?.trim() || "No notes saved.";
    const text = `Node: ${node.name}\nNotes: ${notes}`;
    docs.push({
      id: `node:${node.id}`,
      kind: "node",
      title: `Node: ${node.name}`,
      text,
      lowerText: text.toLowerCase(),
      tokens: tokenize(text),
      nodeIds: [node.id],
      edgeKey: null,
      citation: {
        id: `node:${node.id}`,
        type: "node",
        label: node.name,
        snippet: clampText(notes, 220),
        nodeId: node.id,
      },
    });
  }

  for (const source of interestEvidence) {
    const node = interestById.get(source.interest_id);
    if (!node) continue;
    const authors = normalizeAuthors(source.authors).join(", ");
    const yearText = typeof source.year === "number" ? ` (${source.year})` : "";
    const reason = source.reason?.trim() || "Saved as node evidence.";
    const journal = source.journal?.trim() || "Unknown venue";
    const text =
      `Node evidence for ${node.name}\n` +
      `Title: ${source.title}${yearText}\n` +
      `Venue: ${journal}\n` +
      `${authors ? `Authors: ${authors}\n` : ""}` +
      `Reason: ${reason}`;

    docs.push({
      id: `node-evidence:${source.id}`,
      kind: "node_evidence",
      title: `Node evidence: ${node.name}`,
      text,
      lowerText: text.toLowerCase(),
      tokens: tokenize(text),
      nodeIds: [node.id],
      edgeKey: null,
      citation: {
        id: `node-evidence:${source.id}`,
        type: "paper",
        label: `${node.name}: ${source.title}`,
        snippet: clampText(reason, 220),
        url: source.url || null,
        paperTitle: source.title,
        year: source.year,
        journal,
        authors: normalizeAuthors(source.authors),
        reason,
        sourceProvider: "saved-node-evidence",
        nodeId: node.id,
      },
    });
  }

  for (const note of edgeNotes) {
    const sourceNode = interestById.get(note.interest_a_id);
    const targetNode = interestById.get(note.interest_b_id);
    if (!sourceNode || !targetNode) continue;
    const normalizedEdge = edgeKey(sourceNode.id, targetNode.id);
    const label = `${sourceNode.name} ↔ ${targetNode.name}`;
    const noteText = note.notes?.trim() || "No edge notes saved.";
    const text = `Edge: ${label}\nNotes: ${noteText}`;

    docs.push({
      id: `edge:${normalizedEdge}`,
      kind: "edge",
      title: `Edge notes: ${label}`,
      text,
      lowerText: text.toLowerCase(),
      tokens: tokenize(text),
      nodeIds: [sourceNode.id, targetNode.id],
      edgeKey: normalizedEdge,
      citation: {
        id: `edge:${normalizedEdge}`,
        type: "edge",
        label,
        snippet: clampText(noteText, 220),
        interestAId: sourceNode.id,
        interestBId: targetNode.id,
      },
    });
  }

  for (const source of edgeEvidence) {
    const sourceNode = interestById.get(source.interest_a_id);
    const targetNode = interestById.get(source.interest_b_id);
    if (!sourceNode || !targetNode) continue;

    const normalizedEdge = edgeKey(sourceNode.id, targetNode.id);
    const label = `${sourceNode.name} ↔ ${targetNode.name}`;
    const authors = normalizeAuthors(source.authors).join(", ");
    const yearText = typeof source.year === "number" ? ` (${source.year})` : "";
    const reason = source.reason?.trim() || "Saved as edge evidence.";
    const journal = source.journal?.trim() || "Unknown venue";
    const text =
      `Edge evidence for ${label}\n` +
      `Title: ${source.title}${yearText}\n` +
      `Venue: ${journal}\n` +
      `${authors ? `Authors: ${authors}\n` : ""}` +
      `Reason: ${reason}`;

    docs.push({
      id: `edge-evidence:${source.id}`,
      kind: "edge_evidence",
      title: `Edge evidence: ${label}`,
      text,
      lowerText: text.toLowerCase(),
      tokens: tokenize(text),
      nodeIds: [sourceNode.id, targetNode.id],
      edgeKey: normalizedEdge,
      citation: {
        id: `edge-evidence:${source.id}`,
        type: "paper",
        label: `${label}: ${source.title}`,
        snippet: clampText(reason, 220),
        url: source.url || null,
        paperTitle: source.title,
        year: source.year,
        journal,
        authors: normalizeAuthors(source.authors),
        reason,
        sourceProvider: "saved-edge-evidence",
        interestAId: sourceNode.id,
        interestBId: targetNode.id,
      },
    });
  }

  const paperContextKeywords = Array.from(tokenize(parsed.question));
  for (const paperContext of paperContexts) {
    const paperTitle = paperContext.paper_title?.trim() || paperContext.file_name || "Saved paper";
    const sourceFile = paperContext.file_name?.trim() || "unknown file";
    const extracted = paperContext.extracted_text || "";
    const snippet = excerptAroundKeywords(extracted, paperContextKeywords, 500);
    const text =
      `Saved paper context: ${paperTitle}\n` +
      `Source file: ${sourceFile}\n` +
      `Excerpt: ${snippet || "No extracted text available."}`;
    const nodeIds = findMentionedNodeIds(extracted, interests);

    docs.push({
      id: `paper-context:${paperContext.id}`,
      kind: "paper_context",
      title: `Saved paper: ${paperTitle}`,
      text,
      lowerText: text.toLowerCase(),
      tokens: tokenize(text),
      nodeIds,
      edgeKey: null,
      citation: {
        id: `paper-context:${paperContext.id}`,
        type: "paper",
        label: `Saved paper: ${paperTitle}`,
        snippet: clampText(snippet || "Saved uploaded paper context.", 220),
        paperTitle,
        reason: "Uploaded paper context saved in this map.",
        sourceProvider: "saved-paper-context",
      },
    });
  }

  if (parsed.scope === "edge" && selectedEdgeKey && selectedEdgeNodeIds.length === 2) {
    const sourceNode = interestById.get(selectedEdgeNodeIds[0]);
    const targetNode = interestById.get(selectedEdgeNodeIds[1]);
    if (sourceNode && targetNode) {
      const similarityText =
        typeof parsed.edgeSimilarity === "number"
          ? ` Similarity score in graph view: ${parsed.edgeSimilarity.toFixed(2)}.`
          : "";
      const label = `${sourceNode.name} ↔ ${targetNode.name}`;
      const text = `Selected edge focus: ${label}.${similarityText}`;
      docs.push({
        id: `edge-focus:${selectedEdgeKey}`,
        kind: "edge",
        title: `Selected edge: ${label}`,
        text,
        lowerText: text.toLowerCase(),
        tokens: tokenize(text),
        nodeIds: [sourceNode.id, targetNode.id],
        edgeKey: selectedEdgeKey,
        citation: {
          id: `edge-focus:${selectedEdgeKey}`,
          type: "edge",
          label,
          snippet: clampText(text, 220),
          interestAId: sourceNode.id,
          interestBId: targetNode.id,
        },
      });
    }
  }

  const scopedDocs = docs.filter((doc) => {
    if (parsed.scope === "map") return true;
    if (parsed.scope === "node" && parsed.nodeId) {
      return doc.nodeIds.includes(parsed.nodeId);
    }
    if (parsed.scope === "edge" && selectedEdgeKey) {
      if (doc.edgeKey === selectedEdgeKey) return true;
      return doc.nodeIds.some((id) => selectedEdgeNodeIds.includes(id));
    }
    return false;
  });

  const scopeContextTerms: string[] = [];
  if (parsed.scope === "node" && parsed.nodeId) {
    const nodeName = interestById.get(parsed.nodeId)?.name;
    if (nodeName) scopeContextTerms.push(nodeName);
  }
  if (parsed.scope === "edge" && selectedEdgeNodeIds.length === 2) {
    const source = interestById.get(selectedEdgeNodeIds[0])?.name;
    const target = interestById.get(selectedEdgeNodeIds[1])?.name;
    if (source) scopeContextTerms.push(source);
    if (target) scopeContextTerms.push(target);
  }

  let externalPaperDocs: AssistantContextDoc[] = [];
  if (parsed.allowExternalPapers) {
    const externalQuery = `${parsed.question} ${scopeContextTerms.join(" ")}`.trim();
    if (externalQuery.length > 0) {
      try {
        externalPaperDocs = await fetchExternalPaperDocs(externalQuery);
      } catch (err) {
        console.warn("External paper lookup failed:", err);
      }
    }
  }

  const combinedScopedDocs = [...scopedDocs, ...externalPaperDocs];

  if (combinedScopedDocs.length === 0) {
    const fallback: GraphAssistantQueryResponse = {
      answer:
        "There is not enough context in this scope yet. Add notes/evidence and try enabling paper exploration.",
      scope: parsed.scope,
      assistantMode: "grounded",
      citations: [],
      insufficientEvidence: true,
      suggestedFollowups: [
        "What notes should I add first?",
        "Which evidence is missing for this claim?",
      ],
      contextCount: 0,
      externalPaperCount: 0,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback);
  }

  const questionLower = parsed.question.toLowerCase();
  const queryTokens = tokenize(parsed.question);

  const ranked = combinedScopedDocs
    .map((doc) => ({
      doc,
      score: scoreDoc(
        doc,
        queryTokens,
        questionLower,
        parsed.scope,
        parsed.nodeId,
        selectedEdgeKey,
        selectedEdgeNodeIds
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const positive = ranked.filter((item) => item.score > 0);
  const chosen = (positive.length > 0 ? positive : ranked)
    .slice(0, MAX_CONTEXT_DOCS)
    .map((item) => item.doc);

  const contextRefs = chosen.map((doc, index) => {
    const ref = `C${index + 1}`;
    return {
      ref,
      doc,
      text: `[${ref}] ${doc.title}\n${clampText(doc.text)}`,
    };
  });

  const contextBlock = contextRefs.map((item) => item.text).join("\n\n");
  const edgeScopeLabel =
    parsed.scope === "edge" && selectedEdgeNodeIds.length === 2
      ? ` (${interestById.get(selectedEdgeNodeIds[0])?.name || "Node A"} ↔ ${
          interestById.get(selectedEdgeNodeIds[1])?.name || "Node B"
        })`
      : "";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the KnowledgeMapper assistant. Answer using only the provided context blocks. Blocks may include saved map notes/evidence, saved uploaded paper contexts, and external paper metadata. If the context is insufficient, clearly say so. Never claim to have used any source that is not in the provided blocks. Return strict JSON with keys: answer (string), citationIds (array of context ids like C1), insufficientEvidence (boolean), suggestedFollowups (array of short strings).",
        },
        {
          role: "user",
          content:
            `Scope: ${parsed.scope}${edgeScopeLabel}\n` +
            `Question: ${parsed.question}\n\n` +
            `Context blocks:\n${contextBlock}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Assistant did not return content.");
    }

    const payload = JSON.parse(content) as Record<string, unknown>;
    const answer =
      typeof payload.answer === "string" && payload.answer.trim().length > 0
        ? payload.answer.trim()
        : "I could not produce a grounded answer from the current map context.";
    const citationIds = normalizeStringList(payload.citationIds, 10);
    const insufficientEvidence =
      payload.insufficientEvidence === true ||
      /not enough|insufficient/i.test(answer);
    const suggestedFollowups = normalizeStringList(payload.suggestedFollowups, 4);

    const refToCitation = new Map<string, GraphAssistantCitation>();
    for (const item of contextRefs) {
      refToCitation.set(item.ref, item.doc.citation);
    }

    const cited = citationIds
      .map((id) => refToCitation.get(id))
      .filter((item): item is GraphAssistantCitation => Boolean(item));
    const fallbackCitations = contextRefs
      .slice(0, 4)
      .map((item) => item.doc.citation);

    const response: GraphAssistantQueryResponse = {
      answer,
      scope: parsed.scope,
      assistantMode: "grounded",
      citations: uniqueCitations(cited.length > 0 ? cited : fallbackCitations),
      insufficientEvidence,
      suggestedFollowups,
      contextCount: chosen.length,
      externalPaperCount: externalPaperDocs.length,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Assistant query failed:", err);
    return NextResponse.json(
      { error: "Failed to generate assistant answer." },
      { status: 502 }
    );
  }
}
