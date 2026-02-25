-- Run this in your Supabase SQL Editor to set up the database

-- Enable the pgvector extension
create extension if not exists vector;

-- Create the interests table
create table interests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  embedding vector(1536), -- OpenAI text-embedding-3-small outputs 1536 dimensions
  related_topics text[] default '{}'::text[] not null,
  notes text default '' not null,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Create an index for faster user lookups
create index interests_user_id_idx on interests(user_id);

-- Create a unique constraint so users can't add the same interest twice
create unique index interests_user_id_name_idx on interests(user_id, name);

-- Enable Row Level Security
alter table interests enable row level security;

-- Users can only see their own interests
create policy "Users can view own interests"
  on interests for select
  using (auth.uid() = user_id);

-- Users can only insert their own interests
create policy "Users can insert own interests"
  on interests for insert
  with check (auth.uid() = user_id);

-- Users can only delete their own interests
create policy "Users can delete own interests"
  on interests for delete
  using (auth.uid() = user_id);

-- Users can only update their own interests
create policy "Users can update own interests"
  on interests for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
