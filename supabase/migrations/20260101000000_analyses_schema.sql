-- Batch 4: schema per CLAUDE.md / PRD Section 9's data model sketch.
--
-- `profiles` is a public, app-facing companion to Supabase's built-in
-- `auth.users` (which holds credentials and isn't directly queryable from
-- the client) — one row per signed-up user, created automatically by the
-- trigger below. `analyses` is one row per completed running-form report.
--
-- Row Level Security is mandatory here, not optional: Supabase tables are
-- reachable directly from the browser via the anon key, so RLS is the only
-- thing stopping one user from reading or writing another user's data.

create type public.landing_form_confidence as enum ('full', 'reduced', 'unavailable');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  video_fps numeric,
  video_storage_path text,
  -- Composite efficiency score: not yet computed anywhere (its weighting
  -- formula is an open decision per PRD Section 12) — nullable until it is.
  score numeric,
  cadence numeric,
  vertical_oscillation numeric,
  overstride numeric,
  hip_drop numeric,
  arm_swing_symmetry numeric,
  landing_form text,
  landing_form_confidence public.landing_form_confidence,
  flags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index analyses_user_id_recorded_at_idx on public.analyses (user_id, recorded_at desc);

alter table public.profiles enable row level security;
alter table public.analyses enable row level security;

create policy "profiles are self-viewable" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles are self-updatable" on public.profiles
  for update using (auth.uid() = id);

create policy "analyses are owned by their user" on public.analyses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create a profile row whenever a new auth user signs up, so the app
-- never has to remember to do this itself.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
