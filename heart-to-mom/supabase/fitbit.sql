-- Run this in Supabase SQL editor before using the Fitbit OAuth flow.
-- The serverless callback writes through SUPABASE_SERVICE_ROLE_KEY.

create table if not exists public.wearable_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_user_id text,
  access_token text not null,
  refresh_token text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.wearable_connections enable row level security;

create policy "Users can read their wearable connections"
  on public.wearable_connections
  for select
  using (auth.uid() = user_id);

alter table public.vitals
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.vitals
  alter column systolic drop not null,
  alter column diastolic drop not null;
