# KnowledgeMapper

KnowledgeMapper is a visual research workspace for exploring topics, mapping connections, and building evidence-backed learning trails.

## What It Does

- Build multiple named knowledge maps per user.
- Visualize topic clusters and semantic links in an interactive graph.
- Expand topics with AI-generated related areas.
- Generate bridge topics between two selected nodes.
- Save notes at both levels:
  - Node notes: topic-specific notes.
  - Edge notes: notes about why two topics are connected.
- Collect research evidence:
  - Node evidence: papers relevant to a single topic.
  - Edge evidence: papers relevant to a relationship between two topics.

## Stack

- Next.js (App Router) + React + TypeScript
- Supabase Auth + Postgres
- OpenAI API (embeddings + topic generation)
- OpenAlex API (paper lookup for evidence)
- Tailwind CSS

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_key
```

3. Start dev server:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Required Database Tables

At minimum, the app expects these tables:

- `maps`
- `interests`
- `edge_notes`
- `edge_evidence`
- `interest_evidence`

`interests.embedding` should be a vector-compatible field if you want semantic graph links.

## Core Routes

- App pages:
  - `/dashboard` map workspace
  - `/discover` topic recommendations
  - `/profile` analytics and account summary
  - `/about` product and usage guide
- API routes:
  - `/api/maps`
  - `/api/interests`
  - `/api/interests/expand`
  - `/api/interests/connect`
  - `/api/interests/evidence`
  - `/api/edges/notes`
  - `/api/edges/evidence`
  - `/api/research/node-evidence`
  - `/api/research/evidence`

## Deployment (Vercel)

For this Next.js app, default Vercel settings are usually enough:

- Install Command: auto-detected (`npm install`)
- Build Command: auto-detected (`next build`)
- Output Directory: auto-detected

Set environment variables in Vercel Project Settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
