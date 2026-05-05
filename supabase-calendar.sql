-- Run this in Supabase SQL Editor to enable persisted calendar blocks.
-- Safe to run multiple times.

create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  title text not null default '',
  start_minute integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute integer not null check (end_minute > 0 and end_minute <= 1440),
  note text not null default '',
  color text not null default '#2563eb',
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_minute > start_minute)
);

alter table public.calendar_blocks add column if not exists title text not null default '';

create table if not exists public.calendar_segments (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.calendar_blocks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_minute integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute integer not null check (end_minute > 0 and end_minute <= 1440),
  note text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_minute > start_minute)
);

create index if not exists calendar_blocks_user_date_idx
  on public.calendar_blocks(user_id, date_key);

create index if not exists calendar_segments_block_idx
  on public.calendar_segments(block_id);

create index if not exists calendar_segments_user_idx
  on public.calendar_segments(user_id);

alter table public.calendar_blocks enable row level security;
alter table public.calendar_segments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_blocks'
      and policyname = 'Users can view own calendar blocks'
  ) then
    create policy "Users can view own calendar blocks"
      on public.calendar_blocks for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_blocks'
      and policyname = 'Users can insert own calendar blocks'
  ) then
    create policy "Users can insert own calendar blocks"
      on public.calendar_blocks for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_blocks'
      and policyname = 'Users can update own calendar blocks'
  ) then
    create policy "Users can update own calendar blocks"
      on public.calendar_blocks for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_blocks'
      and policyname = 'Users can delete own calendar blocks'
  ) then
    create policy "Users can delete own calendar blocks"
      on public.calendar_blocks for delete
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_segments'
      and policyname = 'Users can view own calendar segments'
  ) then
    create policy "Users can view own calendar segments"
      on public.calendar_segments for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_segments'
      and policyname = 'Users can insert own calendar segments'
  ) then
    create policy "Users can insert own calendar segments"
      on public.calendar_segments for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_segments'
      and policyname = 'Users can update own calendar segments'
  ) then
    create policy "Users can update own calendar segments"
      on public.calendar_segments for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_segments'
      and policyname = 'Users can delete own calendar segments'
  ) then
    create policy "Users can delete own calendar segments"
      on public.calendar_segments for delete
      using (auth.uid() = user_id);
  end if;
end
$$;
