-- Atlas: Paper-level drill-down for topics.
-- Idempotent migration (safe to run multiple times).
-- Caches OpenAlex papers + SPECTER2 embeddings per topic.

create extension if not exists vector;

create table if not exists public.atlas_papers (
  id text primary key,                    -- OpenAlex work ID e.g. "W2345678"
  title text not null,
  abstract text,
  year int,
  doi text,
  journal text,
  citation_count bigint not null default 0,
  topic_id text not null references public.atlas_topics(id) on delete cascade,
  semantic_scholar_id text,               -- Semantic Scholar paper ID
  specter2_embedding vector(768),         -- SPECTER2 embedding from Semantic Scholar
  x double precision,                     -- precomputed UMAP x (relative to topic)
  y double precision,                     -- precomputed UMAP y (relative to topic)
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.atlas_papers add column if not exists abstract text;
alter table public.atlas_papers add column if not exists year int;
alter table public.atlas_papers add column if not exists doi text;
alter table public.atlas_papers add column if not exists journal text;
alter table public.atlas_papers add column if not exists citation_count bigint default 0;
alter table public.atlas_papers add column if not exists topic_id text;
alter table public.atlas_papers add column if not exists semantic_scholar_id text;
alter table public.atlas_papers add column if not exists specter2_embedding vector(768);
alter table public.atlas_papers add column if not exists x double precision;
alter table public.atlas_papers add column if not exists y double precision;
alter table public.atlas_papers add column if not exists created_at timestamptz default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'atlas_papers_topic_id_fkey'
  ) then
    alter table public.atlas_papers
      add constraint atlas_papers_topic_id_fkey
      foreign key (topic_id) references public.atlas_topics(id) on delete cascade;
  end if;
end
$$;

create table if not exists public.atlas_paper_edges (
  paper_a_id text not null references public.atlas_papers(id) on delete cascade,
  paper_b_id text not null references public.atlas_papers(id) on delete cascade,
  similarity double precision not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (paper_a_id, paper_b_id),
  check (paper_a_id < paper_b_id),
  check (similarity >= -1 and similarity <= 1)
);

alter table public.atlas_paper_edges add column if not exists similarity double precision;
alter table public.atlas_paper_edges add column if not exists created_at timestamptz default timezone('utc', now());

create index if not exists idx_atlas_papers_topic on public.atlas_papers(topic_id);
create index if not exists idx_atlas_papers_doi on public.atlas_papers(doi);
create index if not exists idx_atlas_papers_citation_count on public.atlas_papers(citation_count desc);
create index if not exists idx_atlas_paper_edges_a on public.atlas_paper_edges(paper_a_id);
create index if not exists idx_atlas_paper_edges_b on public.atlas_paper_edges(paper_b_id);
create index if not exists idx_atlas_paper_edges_similarity on public.atlas_paper_edges(similarity desc);

-- Optional ANN index for paper-paper nearest-neighbor search.
do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'idx_atlas_papers_specter2_ivfflat'
      and n.nspname = 'public'
  ) then
    create index idx_atlas_papers_specter2_ivfflat
      on public.atlas_papers using ivfflat (specter2_embedding vector_cosine_ops)
      with (lists = 100);
  end if;
end
$$;
