-- Run once in the SQL Editor, after schema.sql.
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches on delete cascade,
  claimant_id uuid not null references auth.users on delete cascade,
  question text not null,
  answer text,
  verdict text check (verdict in ('verified', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  unique (match_id, claimant_id)
);
alter table public.claims enable row level security;

-- Writes happen only in the verify-claim Edge Function (service role).
create policy "claimant reads own" on public.claims for select to authenticated
  using (claimant_id = auth.uid());
create policy "finder reads claims on their item" on public.claims for select to authenticated
  using (exists (select 1 from public.matches m join public.items i on i.id = m.found_id
                 where m.id = match_id and i.user_id = auth.uid()));

alter publication supabase_realtime add table public.claims;
