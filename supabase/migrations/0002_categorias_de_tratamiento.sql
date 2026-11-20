-- Categoría del tratamiento: además de común y accidentes, por especialidad
alter table public.treatments drop constraint if exists treatments_reason_check;
alter table public.treatments add constraint treatments_reason_check
  check (reason in ('comun','accidente_trabajo','accidente_transito','neurologico','respiratorio','pediatrico'));
