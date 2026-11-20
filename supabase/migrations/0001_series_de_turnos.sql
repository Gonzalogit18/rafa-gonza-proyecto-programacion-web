-- Turnos agendados en serie: se pueden cambiar o borrar de un turno en adelante
alter table public.appointments add column if not exists series_id uuid;
create index if not exists appointments_series_idx on public.appointments (series_id) where series_id is not null;

-- Un ausente se factura igual que un atendido: tampoco se puede borrar
drop policy if exists appt_delete on public.appointments;
create policy appt_delete on public.appointments for delete
  using (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()) and status not in ('atendido', 'ausente'));
