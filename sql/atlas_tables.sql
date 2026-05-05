-- Atlas: Knowledge map of scientific topics from OpenAlex
-- Hierarchy: domain -> field -> subfield -> topic

-- Enable pgvector if not already enabled
create extension if not exists vector;

-- Domains (4 total: Physical Sciences, Life Sciences, Social Sciences, Health Sciences)
create table atlas_domains (
  id text primary key,                -- e.g. "domains/3"
  display_name text not null,
  description text
);

-- Fields (26 total, e.g. Physics and Astronomy, Computer Science)
create table atlas_fields (
  id text primary key,                -- e.g. "fields/31"
  display_name text not null,
  domain_id text not null references atlas_domains(id),
  description text
);

-- Subfields (252 total, e.g. Nuclear and High Energy Physics)
create table atlas_subfields (
  id text primary key,                -- e.g. "subfields/3106"
  display_name text not null,
  field_id text not null references atlas_fields(id),
  description text,
  works_count bigint default 0
);

-- Topics (4516 total, finest granularity)
create table atlas_topics (
  id text primary key,                -- e.g. "T14423"
  display_name text not null,
  description text,
  keywords text[] default '{}',
  subfield_id text not null references atlas_subfields(id),
  works_count bigint default 0,
  cited_by_count bigint default 0,
  wikipedia_url text,
  embedding vector(1536),             -- OpenAI text-embedding-3-small
  x float,                            -- precomputed UMAP x
  y float,                            -- precomputed UMAP y
  created_at timestamptz default now()
);

-- Precomputed edges between topics (cosine similarity)
create table atlas_topic_edges (
  topic_a_id text not null references atlas_topics(id),
  topic_b_id text not null references atlas_topics(id),
  similarity float not null,
  primary key (topic_a_id, topic_b_id),
  check (topic_a_id < topic_b_id)     -- canonical ordering
);

-- Indexes
create index idx_atlas_topics_subfield on atlas_topics(subfield_id);
create index idx_atlas_topics_embedding on atlas_topics using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create index idx_atlas_topic_edges_a on atlas_topic_edges(topic_a_id);
create index idx_atlas_topic_edges_b on atlas_topic_edges(topic_b_id);
create index idx_atlas_topic_edges_sim on atlas_topic_edges(similarity desc);
