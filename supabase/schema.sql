-- Run once in the Supabase SQL Editor.
create extension if not exists vector with schema extensions;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('lost', 'found')),
  status text not null default 'open' check (status in ('open', 'claimed', 'returned')),
  note text not null,                  -- the person's own words
  location text,
  photo_path text,                     -- path inside the "photos" bucket
  attrs jsonb,                         -- AI-extracted: category, colour, brand, marks, visible_text, summary
  embedding extensions.vector(384),
  created_at timestamptz not null default now()
);

-- A detail only the finder can read; used later to check real owners.
create table public.item_secrets (
  item_id uuid primary key references public.items on delete cascade,
  detail text not null
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  lost_id uuid not null references public.items on delete cascade,
  found_id uuid not null references public.items on delete cascade,
  score int not null,                  -- 0-100 from the AI re-rank
  reason text not null,
  created_at timestamptz not null default now(),
  unique (lost_id, found_id)
);

alter table public.items enable row level security;
alter table public.item_secrets enable row level security;
alter table public.matches enable row level security;

create policy "read found or own" on public.items for select to authenticated
  using (kind = 'found' or user_id = auth.uid());
create policy "insert own" on public.items for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own" on public.items for update to authenticated
  using (user_id = auth.uid());
create policy "delete own items" on public.items for delete to authenticated
  using (user_id = auth.uid());

create policy "own secret" on public.item_secrets for all to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()));

create policy "see own matches" on public.matches for select to authenticated
  using (exists (select 1 from public.items i where i.id in (lost_id, found_id) and i.user_id = auth.uid()));

-- Nearest open items of the opposite kind (called by the Edge Function with the service role).
create or replace function public.candidates(q extensions.vector(384), want text, k int default 6)
returns table (id uuid, note text, location text, photo_path text, attrs jsonb, similarity float)
language sql stable set search_path = public, extensions as $$
  select id, note, location, photo_path, attrs, 1 - (embedding <=> q) as similarity
  from items
  where kind = want and status = 'open' and embedding is not null
  order by embedding <=> q
  limit k;
$$;

-- Photos: public bucket, each user uploads into their own folder.
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Live alerts when a match appears.
alter publication supabase_realtime add table public.matches;
