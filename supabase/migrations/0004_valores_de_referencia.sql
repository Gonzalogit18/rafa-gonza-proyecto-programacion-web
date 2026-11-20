-- Valores públicos de referencia, iguales para todas las clínicas. Los mantenemos nosotros;
-- cada clínica decide si los adopta y queda guardado en sus tarifas.
create table if not exists public.tariff_reference (
  id          uuid primary key default gen_random_uuid(),
  tariff      text not null,
  value       numeric(14,2) not null check (value >= 0),
  valid_from  date not null,
  source      text not null,
  source_url  text,
  checked_at  date not null default current_date,
  unique (tariff, valid_from)
);
alter table public.tariff_reference enable row level security;
drop policy if exists tariff_reference_read on public.tariff_reference;
create policy tariff_reference_read on public.tariff_reference for select to authenticated using (true);
