-- Run this once in Supabase SQL Editor to enable public read-only map sharing

alter table maps
  add column if not exists is_public boolean default false not null;

alter table maps
  add column if not exists share_slug text;

alter table maps
  add column if not exists shared_at timestamp with time zone;

create unique index if not exists maps_share_slug_unique_idx
  on maps (share_slug)
  where share_slug is not null;
