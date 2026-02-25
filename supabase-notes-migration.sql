-- Run this once in Supabase SQL editor for existing projects

alter table interests
  add column if not exists related_topics text[] default '{}'::text[] not null;

alter table interests
  add column if not exists notes text default '' not null;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'interests'
      and policyname = 'Users can update own interests'
  ) then
    create policy "Users can update own interests"
      on interests for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
