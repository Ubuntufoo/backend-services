-- Make Data API table access explicit for this local-only architecture.
-- Trusted backend runtimes use service_role. Browser access is read-only and
-- limited to listings/realtime unless a future table explicitly opts in.

grant usage on schema public to anon, authenticated, service_role;

revoke all privileges on table
  public.listings,
  public.jobs,
  public.orders,
  public.app_settings,
  public.daily_usage
from anon, authenticated;

grant all privileges on table
  public.listings,
  public.jobs,
  public.orders,
  public.app_settings,
  public.daily_usage
to service_role;

grant select on table public.listings to anon;
grant select on table public.listings to authenticated;

revoke all privileges on all sequences in schema public from anon, authenticated;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
revoke all on tables from anon, authenticated;

alter default privileges in schema public
grant all on tables to service_role;

alter default privileges in schema public
revoke all on sequences from anon, authenticated;

alter default privileges in schema public
grant all on sequences to service_role;
