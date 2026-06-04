alter table public.listings
drop constraint if exists listings_sku_check;

alter table public.listings
add constraint listings_sku_check
check (
  sku is null
  or sku ~ '^((Single|Lot)|(BSKBL|BSBL|OTHER)-(Single|Lot))-([0-9]{5}[1-9]|[0-9]{4}[1-9][0-9]|[0-9]{3}[1-9][0-9]{2}|[0-9]{2}[1-9][0-9]{3}|[0-9][1-9][0-9]{4}|[1-9][0-9]{5})$'
);
