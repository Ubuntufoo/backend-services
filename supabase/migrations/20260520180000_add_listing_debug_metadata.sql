alter table public.listings
  add column if not exists generated_at timestamptz,
  add column if not exists last_error_message text,
  add column if not exists last_error_context jsonb not null default '{}'::jsonb;
