do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'listings'
      and policyname = 'Allow anon read access to listings'
  ) then
    create policy "Allow anon read access to listings"
    on public.listings
    for select
    to anon
    using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'listings'
      and policyname = 'Allow authenticated read access to listings'
  ) then
    create policy "Allow authenticated read access to listings"
    on public.listings
    for select
    to authenticated
    using (true);
  end if;
end
$$;
