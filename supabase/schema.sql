-- ---------------------------------------------------------------------------
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  student     text        not null,
  session_id  text        not null,
  deck_id     text        not null,
  card_id     text,
  card_front  text,
  action      text        not null,   -- start | got | missed | flag | unflag | finish
  ms          integer                  -- time spent on the card, when known
);

create index if not exists events_student_created on public.events (student, created_at desc);
create index if not exists events_deck            on public.events (deck_id);
create index if not exists events_action          on public.events (action);

alter table public.events enable row level security;

-- This site has no real user accounts: one shared student password, one shared
-- teacher password, both checked in the browser. The anon key is public by
-- design, so these policies intentionally allow anonymous insert and read.
-- Do not store anything sensitive in this table.
drop policy if exists "anon can log practice"  on public.events;
drop policy if exists "anon can read practice" on public.events;

create policy "anon can log practice"  on public.events for insert to anon with check (true);
create policy "anon can read practice" on public.events for select to anon using (true);
