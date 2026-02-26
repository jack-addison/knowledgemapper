-- Run this in Supabase SQL Editor to enable live collaborative maps.
-- Safe to run multiple times (idempotent).

create table if not exists public.map_collaborators (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default timezone('utc', now())
);

create unique index if not exists map_collaborators_map_user_unique_idx
  on public.map_collaborators (map_id, user_id);

create index if not exists map_collaborators_user_idx
  on public.map_collaborators (user_id);

create index if not exists map_collaborators_map_idx
  on public.map_collaborators (map_id);

create table if not exists public.map_collab_invites (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  token_hash text not null,
  is_active boolean not null default true,
  expires_at timestamp with time zone,
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamp with time zone not null default timezone('utc', now())
);

create unique index if not exists map_collab_invites_token_hash_unique_idx
  on public.map_collab_invites (token_hash);

create index if not exists map_collab_invites_map_active_idx
  on public.map_collab_invites (map_id, is_active);

alter table public.map_collaborators enable row level security;
alter table public.map_collab_invites enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_collaborators'
      and policyname = 'Map collaborators can view own membership'
  ) then
    create policy "Map collaborators can view own membership"
      on public.map_collaborators
      for select
      using (
        auth.uid() = user_id
        or exists (
          select 1
          from public.maps m
          where m.id = map_collaborators.map_id
            and m.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_collaborators'
      and policyname = 'Map owners can manage collaborators'
  ) then
    create policy "Map owners can manage collaborators"
      on public.map_collaborators
      for all
      using (
        exists (
          select 1
          from public.maps m
          where m.id = map_collaborators.map_id
            and m.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.maps m
          where m.id = map_collaborators.map_id
            and m.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'map_collab_invites'
      and policyname = 'Map owners can manage collaboration invites'
  ) then
    create policy "Map owners can manage collaboration invites"
      on public.map_collab_invites
      for all
      using (
        exists (
          select 1
          from public.maps m
          where m.id = map_collab_invites.map_id
            and m.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.maps m
          where m.id = map_collab_invites.map_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- Optional but recommended: allow collaborators to receive realtime/select access
-- for shared map data rows (does not grant write permissions).
do $$
begin
  if to_regclass('public.interests') is not null and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'interests'
      and policyname = 'Collaborators can view shared interests'
  ) then
    create policy "Collaborators can view shared interests"
      on public.interests
      for select
      using (
        exists (
          select 1
          from public.map_collaborators mc
          where mc.map_id = interests.map_id
            and mc.user_id = auth.uid()
        )
      );
  end if;

  if to_regclass('public.interest_evidence') is not null and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'interest_evidence'
      and policyname = 'Collaborators can view shared interest evidence'
  ) then
    create policy "Collaborators can view shared interest evidence"
      on public.interest_evidence
      for select
      using (
        exists (
          select 1
          from public.map_collaborators mc
          where mc.map_id = interest_evidence.map_id
            and mc.user_id = auth.uid()
        )
      );
  end if;

  if to_regclass('public.edge_evidence') is not null and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'edge_evidence'
      and policyname = 'Collaborators can view shared edge evidence'
  ) then
    create policy "Collaborators can view shared edge evidence"
      on public.edge_evidence
      for select
      using (
        exists (
          select 1
          from public.map_collaborators mc
          where mc.map_id = edge_evidence.map_id
            and mc.user_id = auth.uid()
        )
      );
  end if;

  if to_regclass('public.edge_notes') is not null and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'edge_notes'
      and policyname = 'Collaborators can view shared edge notes'
  ) then
    create policy "Collaborators can view shared edge notes"
      on public.edge_notes
      for select
      using (
        exists (
          select 1
          from public.map_collaborators mc
          where mc.map_id = edge_notes.map_id
            and mc.user_id = auth.uid()
        )
      );
  end if;
end
$$;
