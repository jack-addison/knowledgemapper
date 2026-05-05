/**
 * Atlas Pipeline — Fetches STEM topics from OpenAlex, embeds them with OpenAI,
 * computes similarity edges, and uploads everything to Supabase.
 *
 * Usage:
 *   npx tsx scripts/atlas-pipeline.ts [--step fetch|embed|edges|umap|upload|all]
 *   npx tsx scripts/atlas-pipeline.ts --step=all --domains=1,3,4
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_DOMAIN_IDS = [
  "https://openalex.org/domains/3", // Physical Sciences
  "https://openalex.org/domains/1", // Life Sciences
];

const OPENALEX_PER_PAGE = 200;
const OPENALEX_EMAIL = "jack@knowledgemapper.com"; // polite pool
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 100;
const EDGE_SIMILARITY_THRESHOLD = 0.45;
const DATA_DIR = path.join(__dirname, "../.atlas-data");

// CLI args
const STEP_ARG = process.argv.find((a) => a.startsWith("--step="))?.split("=")[1] || "all";
const DOMAINS_ARG = process.argv.find((a) => a.startsWith("--domains="))?.split("=")[1] || "";

function normalizeDomainId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("https://openalex.org/domains/")) return trimmed;
  if (trimmed.startsWith("domains/")) return `https://openalex.org/${trimmed}`;
  if (/^\d+$/.test(trimmed)) return `https://openalex.org/domains/${trimmed}`;
  return trimmed;
}

const ACTIVE_DOMAIN_IDS = (() => {
  const parsed = DOMAINS_ARG
    .split(",")
    .map((d) => normalizeDomainId(d))
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_DOMAIN_IDS;
})();

// ---------------------------------------------------------------------------
// Env + clients
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) throw new Error("Missing .env.local");
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const openaiKey = process.env.OPENAI_API_KEY!;

if (!supabaseUrl || !supabaseKey || !openaiKey) {
  throw new Error("Missing required env vars");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiKey });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function shortId(fullId: string): string {
  // "https://openalex.org/T14423" -> "T14423"
  // "https://openalex.org/domains/3" -> "domains/3"
  // "https://openalex.org/fields/31" -> "fields/31"
  // "https://openalex.org/subfields/3106" -> "subfields/3106"
  const parts = fullId.replace("https://openalex.org/", "");
  return parts;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOpenAlexPages<T>(
  endpoint: string,
  filter?: string
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      per_page: String(OPENALEX_PER_PAGE),
      page: String(page),
      mailto: OPENALEX_EMAIL,
    });
    if (filter) params.set("filter", filter);

    const url = `https://api.openalex.org/${endpoint}?${params}`;
    console.log(`  Fetching ${url}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenAlex error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    results.push(...data.results);

    hasMore = results.length < data.meta.count;
    page++;
    await sleep(120); // respect rate limits
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch from OpenAlex
// ---------------------------------------------------------------------------

interface OpenAlexTopic {
  id: string;
  display_name: string;
  description: string;
  keywords: string[];
  subfield: { id: string; display_name: string };
  field: { id: string; display_name: string };
  domain: { id: string; display_name: string };
  works_count: number;
  cited_by_count: number;
  ids: { wikipedia?: string };
}

interface OpenAlexSubfield {
  id: string;
  display_name: string;
  description?: string;
  works_count: number;
  field: { id: string; display_name: string };
  domain: { id: string; display_name: string };
}

interface OpenAlexField {
  id: string;
  display_name: string;
  description?: string;
  domain: { id: string; display_name: string };
}

interface OpenAlexDomain {
  id: string;
  display_name: string;
  description?: string;
}

async function stepFetch() {
  ensureDataDir();
  console.log("=== Step 1: Fetching from OpenAlex ===\n");
  console.log(`Domain filter: ${ACTIVE_DOMAIN_IDS.join(", ")}\n`);

  // Fetch all domains
  console.log("Fetching domains...");
  const allDomains = await fetchOpenAlexPages<OpenAlexDomain>("domains");
  const selectedDomains = allDomains.filter((d) => ACTIVE_DOMAIN_IDS.includes(d.id));
  console.log(`  ${selectedDomains.length} selected domains\n`);

  // Fetch all fields
  console.log("Fetching fields...");
  const allFields = await fetchOpenAlexPages<OpenAlexField>("fields");
  const selectedDomainIdSet = new Set(ACTIVE_DOMAIN_IDS);
  const selectedFields = allFields.filter((f) => selectedDomainIdSet.has(f.domain.id));
  console.log(`  ${selectedFields.length} selected fields\n`);

  // Fetch all subfields
  console.log("Fetching subfields...");
  const allSubfields = await fetchOpenAlexPages<OpenAlexSubfield>("subfields");
  const selectedFieldIds = new Set(selectedFields.map((f) => f.id));
  const selectedSubfields = allSubfields.filter((s) => selectedFieldIds.has(s.field.id));
  console.log(`  ${selectedSubfields.length} selected subfields\n`);

  // Fetch all topics
  console.log("Fetching topics...");
  const allTopics = await fetchOpenAlexPages<OpenAlexTopic>("topics");
  const selectedSubfieldIds = new Set(selectedSubfields.map((s) => s.id));
  const selectedTopics = allTopics.filter((t) => selectedSubfieldIds.has(t.subfield.id));
  console.log(`  ${selectedTopics.length} selected topics (out of ${allTopics.length} total)\n`);

  // Save to disk
  const payload = {
    domains: selectedDomains,
    fields: selectedFields,
    subfields: selectedSubfields,
    topics: selectedTopics,
    domainFilter: ACTIVE_DOMAIN_IDS,
    fetchedAt: new Date().toISOString(),
  };
  const outPath = path.join(DATA_DIR, "openalex-stem.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Saved to ${outPath}`);
  console.log(
    `  ${selectedDomains.length} domains, ${selectedFields.length} fields, ` +
      `${selectedSubfields.length} subfields, ${selectedTopics.length} topics`
  );

  return payload;
}

// ---------------------------------------------------------------------------
// Step 2: Embed topics with OpenAI
// ---------------------------------------------------------------------------

interface EmbeddedTopic {
  id: string;
  embedding: number[];
}

async function stepEmbed() {
  console.log("=== Step 2: Embedding topics with OpenAI ===\n");

  const dataPath = path.join(DATA_DIR, "openalex-stem.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error("Run --step fetch first");
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const topics: OpenAlexTopic[] = data.topics;
  console.log(`  ${topics.length} topics to embed\n`);

  // Build embedding input: name + description + keywords
  const inputs = topics.map((t) => {
    const parts = [t.display_name];
    if (t.description) parts.push(t.description);
    if (t.keywords?.length) parts.push("Keywords: " + t.keywords.slice(0, 5).join(", "));
    return parts.join(". ");
  });

  const embeddings: EmbeddedTopic[] = [];
  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchTopics = topics.slice(i, i + EMBEDDING_BATCH_SIZE);
    console.log(
      `  Embedding batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(inputs.length / EMBEDDING_BATCH_SIZE)} (${batch.length} topics)...`
    );

    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    for (let j = 0; j < res.data.length; j++) {
      embeddings.push({
        id: shortId(batchTopics[j].id),
        embedding: res.data[j].embedding,
      });
    }

    await sleep(200);
  }

  const outPath = path.join(DATA_DIR, "embeddings.json");
  fs.writeFileSync(outPath, JSON.stringify(embeddings));
  console.log(`\nSaved ${embeddings.length} embeddings to ${outPath}`);

  return embeddings;
}

// ---------------------------------------------------------------------------
// Step 3: Compute edges (cosine similarity)
// ---------------------------------------------------------------------------

interface TopicEdge {
  topic_a_id: string;
  topic_b_id: string;
  similarity: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function stepEdges() {
  console.log("=== Step 3: Computing similarity edges ===\n");

  const embPath = path.join(DATA_DIR, "embeddings.json");
  if (!fs.existsSync(embPath)) {
    throw new Error("Run --step embed first");
  }

  const embeddings: EmbeddedTopic[] = JSON.parse(fs.readFileSync(embPath, "utf-8"));
  console.log(`  ${embeddings.length} topics loaded\n`);

  const edges: TopicEdge[] = [];
  const total = (embeddings.length * (embeddings.length - 1)) / 2;
  let compared = 0;
  let lastLog = Date.now();

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSimilarity(embeddings[i].embedding, embeddings[j].embedding);
      compared++;

      if (sim >= EDGE_SIMILARITY_THRESHOLD) {
        const [a, b] =
          embeddings[i].id < embeddings[j].id
            ? [embeddings[i].id, embeddings[j].id]
            : [embeddings[j].id, embeddings[i].id];
        edges.push({ topic_a_id: a, topic_b_id: b, similarity: sim });
      }

      if (Date.now() - lastLog > 5000) {
        console.log(
          `  Progress: ${((compared / total) * 100).toFixed(1)}% — ${edges.length} edges found`
        );
        lastLog = Date.now();
      }
    }
  }

  console.log(`\n  ${edges.length} edges above threshold ${EDGE_SIMILARITY_THRESHOLD}`);

  // Sort by similarity descending
  edges.sort((a, b) => b.similarity - a.similarity);

  const outPath = path.join(DATA_DIR, "edges.json");
  fs.writeFileSync(outPath, JSON.stringify(edges));
  console.log(`  Saved to ${outPath}`);

  return edges;
}

// ---------------------------------------------------------------------------
// Step 4: UMAP layout
// ---------------------------------------------------------------------------

async function stepUmap() {
  console.log("=== Step 4: Computing UMAP layout ===\n");

  const embPath = path.join(DATA_DIR, "embeddings.json");
  if (!fs.existsSync(embPath)) {
    throw new Error("Run --step embed first");
  }

  const embeddings: EmbeddedTopic[] = JSON.parse(fs.readFileSync(embPath, "utf-8"));
  console.log(`  ${embeddings.length} topics loaded\n`);

  // Dynamic import for umap-js (ESM)
  const { UMAP } = await import("umap-js");

  const vectors = embeddings.map((e) => e.embedding);

  console.log("  Running UMAP (this may take a minute)...");
  const umap = new UMAP({
    nNeighbors: 15,
    minDist: 0.1,
    nComponents: 2,
    spread: 1.0,
  });

  const layout = umap.fit(vectors);
  console.log(`  UMAP complete: ${layout.length} points\n`);

  const positions = embeddings.map((e, i) => ({
    id: e.id,
    x: layout[i][0],
    y: layout[i][1],
  }));

  const outPath = path.join(DATA_DIR, "umap-layout.json");
  fs.writeFileSync(outPath, JSON.stringify(positions));
  console.log(`  Saved to ${outPath}`);

  return positions;
}

// ---------------------------------------------------------------------------
// Step 5: Upload to Supabase
// ---------------------------------------------------------------------------

async function stepUpload() {
  console.log("=== Step 5: Uploading to Supabase ===\n");

  const dataPath = path.join(DATA_DIR, "openalex-stem.json");
  const embPath = path.join(DATA_DIR, "embeddings.json");
  const edgePath = path.join(DATA_DIR, "edges.json");
  const umapPath = path.join(DATA_DIR, "umap-layout.json");

  for (const p of [dataPath, embPath, edgePath, umapPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing ${p} — run previous steps first`);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const embeddings: EmbeddedTopic[] = JSON.parse(fs.readFileSync(embPath, "utf-8"));
  const edges: TopicEdge[] = JSON.parse(fs.readFileSync(edgePath, "utf-8"));
  const umapLayout: Array<{ id: string; x: number; y: number }> = JSON.parse(
    fs.readFileSync(umapPath, "utf-8")
  );

  const embeddingMap = new Map(embeddings.map((e) => [e.id, e.embedding]));
  const umapMap = new Map(umapLayout.map((p) => [p.id, { x: p.x, y: p.y }]));

  // Upload domains
  console.log("  Uploading domains...");
  const domainRows = data.domains.map((d: OpenAlexDomain) => ({
    id: shortId(d.id),
    display_name: d.display_name,
    description: d.description || null,
  }));
  const { error: domErr } = await supabase.from("atlas_domains").upsert(domainRows);
  if (domErr) throw new Error(`Domain upload failed: ${domErr.message}`);

  // Upload fields
  console.log("  Uploading fields...");
  const fieldRows = data.fields.map((f: OpenAlexField) => ({
    id: shortId(f.id),
    display_name: f.display_name,
    domain_id: shortId(f.domain.id),
    description: f.description || null,
  }));
  const { error: fieldErr } = await supabase.from("atlas_fields").upsert(fieldRows);
  if (fieldErr) throw new Error(`Field upload failed: ${fieldErr.message}`);

  // Upload subfields
  console.log("  Uploading subfields...");
  const subfieldRows = data.subfields.map((s: OpenAlexSubfield) => ({
    id: shortId(s.id),
    display_name: s.display_name,
    field_id: shortId(s.field.id),
    description: s.description || null,
    works_count: s.works_count,
  }));
  const { error: subErr } = await supabase.from("atlas_subfields").upsert(subfieldRows);
  if (subErr) throw new Error(`Subfield upload failed: ${subErr.message}`);

  // Upload topics (in batches due to size with embeddings)
  console.log("  Uploading topics...");
  const topicRows = data.topics.map((t: OpenAlexTopic) => {
    const tid = shortId(t.id);
    const pos = umapMap.get(tid);
    return {
      id: tid,
      display_name: t.display_name,
      description: t.description || null,
      keywords: t.keywords || [],
      subfield_id: shortId(t.subfield.id),
      works_count: t.works_count,
      cited_by_count: t.cited_by_count,
      wikipedia_url: t.ids?.wikipedia || null,
      embedding: JSON.stringify(embeddingMap.get(tid) || []),
      x: pos?.x ?? null,
      y: pos?.y ?? null,
    };
  });

  const TOPIC_BATCH = 50;
  for (let i = 0; i < topicRows.length; i += TOPIC_BATCH) {
    const batch = topicRows.slice(i, i + TOPIC_BATCH);
    const { error } = await supabase.from("atlas_topics").upsert(batch);
    if (error) throw new Error(`Topic upload batch ${i} failed: ${error.message}`);
    console.log(
      `    ${Math.min(i + TOPIC_BATCH, topicRows.length)}/${topicRows.length} topics`
    );
  }

  // Upload edges
  console.log("  Uploading edges...");
  const EDGE_BATCH = 500;
  for (let i = 0; i < edges.length; i += EDGE_BATCH) {
    const batch = edges.slice(i, i + EDGE_BATCH);
    const { error } = await supabase.from("atlas_topic_edges").upsert(batch);
    if (error) throw new Error(`Edge upload batch ${i} failed: ${error.message}`);
    if (i % 5000 === 0 || i + EDGE_BATCH >= edges.length) {
      console.log(`    ${Math.min(i + EDGE_BATCH, edges.length)}/${edges.length} edges`);
    }
  }

  console.log("\nUpload complete!");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const stepArg = STEP_ARG;

  console.log(`\nAtlas Pipeline — step: ${stepArg}\n`);

  if (stepArg === "fetch" || stepArg === "all") {
    await stepFetch();
    console.log();
  }
  if (stepArg === "embed" || stepArg === "all") {
    await stepEmbed();
    console.log();
  }
  if (stepArg === "edges" || stepArg === "all") {
    await stepEdges();
    console.log();
  }
  if (stepArg === "umap" || stepArg === "all") {
    await stepUmap();
    console.log();
  }
  if (stepArg === "upload" || stepArg === "all") {
    await stepUpload();
    console.log();
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
