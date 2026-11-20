-- Foto de perfil
alter table public.profiles add column if not exists avatar_path text;

-- La fecha de un registro clínico es siempre la del día en que se escribe
create or replace function public.clinical_entries_date()
returns trigger language plpgsql as $$
begin
  new.entry_date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  return new;
end $$;
drop trigger if exists clinical_entries_date on public.clinical_entries;
create trigger clinical_entries_date before insert on public.clinical_entries
  for each row execute function public.clinical_entries_date();

-- Borrar un turno desvincula sus registros: no es una edición de la historia clínica
create or replace function public.clinical_entries_guard()
returns trigger language plpgsql as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content
     or new.entry_date is distinct from old.entry_date or new.kind is distinct from old.kind
     or new.patient_id is distinct from old.patient_id then
    raise exception 'La historia clínica no se puede modificar; anulá el registro y cargá uno nuevo';
  end if;
  if new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason then
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'El registro ya está anulado';
  end if;
  if new.voided_at is null or coalesce(trim(new.void_reason), '') = '' then
    raise exception 'Para anular hay que indicar el motivo';
  end if;
  return new;
end $$;
