-- Opción "Otra" en categorías de tratamiento, tipos de cobertura y tipos de registro clínico
alter table public.treatments add column if not exists reason_other text;
alter table public.treatments drop constraint if exists treatments_reason_check;
alter table public.treatments add constraint treatments_reason_check
  check (reason in ('comun','accidente_trabajo','accidente_transito','neurologico','respiratorio','pediatrico','otra'));
alter table public.obras_sociales drop constraint if exists obras_sociales_type_check;
alter table public.obras_sociales add constraint obras_sociales_type_check
  check (type in ('obra_social','prepaga','pami','ioma','incluir_salud','programa_provincial','art','seguro','otra'));
alter table public.clinical_entries drop constraint if exists clinical_entries_kind_check;
alter table public.clinical_entries add constraint clinical_entries_kind_check
  check (kind in ('consulta','evolucion','estudio','receta','nota','otro'));
