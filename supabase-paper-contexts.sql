-- Run this in Supabase SQL Editor to persist uploaded paper context per map.
-- Safe to run multiple times (idempotent).

create table if not exists public.map_paper_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  map_id uuid not null references public.maps(id) on delete cascade,
  file_name text not null,
  paper_title text not null,
  extracted_text text not null,
  text_char_count integer not null default 0 check (text_char_count >= 0),
  created_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists map_paper_contexts_user_map_created_idx
  on public.map_paper_contexts (user_id, map_id, created_at desc);

create index if not exists map_paper_contexts_map_created_idx
  on public.map_paper_contexts (map_id, created_at desc);

alter table public.map_paper_contexts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_paper_contexts'
      and policyname = 'Users can view own paper contexts'
  ) then
    create policy "Users can view own paper contexts"
      on public.map_paper_contexts
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_paper_contexts'
      and policyname = 'Users can insert own paper contexts'
  ) then
    create policy "Users can insert own paper contexts"
      on public.map_paper_contexts
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_paper_contexts'
      and policyname = 'Users can delete own paper contexts'
  ) then
    create policy "Users can delete own paper contexts"
      on public.map_paper_contexts
      for delete
      using (auth.uid() = user_id);
  end if;
end
$$;
