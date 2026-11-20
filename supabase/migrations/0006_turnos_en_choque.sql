-- Turnos copiados que chocan con otro: quedan en rojo hasta resolverlos.
-- Se guardan como sobreturno para que la base los acepte; in_conflict dice que falta decidir.
alter table public.appointments add column if not exists in_conflict boolean not null default false;
