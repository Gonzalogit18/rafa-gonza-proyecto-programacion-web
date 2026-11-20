-- =====================================================================
-- MedApp Prestadores — esquema de base de datos (Supabase / Postgres)
-- Versión 4: permisos por profesional asignado (admin / secretaria /
-- profesional), tratamientos, tarifas con vigencia, facturación asistida,
-- historia clínica vinculada al turno, auditoría.
--
-- Instalación desde cero: ejecutar completo en Supabase > SQL Editor
-- (o: npx supabase db query --linked -f supabase/schema.sql)
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ---------------------------------------------------------------------
-- Organizaciones (clínica / consultorio). Todo dato cuelga de una.
-- ---------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  razon_social     text,
  cuit             text,
  condicion_iva    text check (condicion_iva in ('monotributo','responsable_inscripto','exento')) default 'monotributo',
  punto_venta      int default 1,
  ingresos_brutos  text,
  inicio_actividades date,
  address          text,
  phone            text,
  email            text,
  plan             text not null default 'base' check (plan in ('base','medium','platinum')),
  created_at       timestamptz not null default now()
);

-- Usuarios (1 a 1 con auth.users)
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  full_name        text not null,
  email            text,
  role             text not null default 'secretaria' check (role in ('admin','secretaria','profesional')),
  active           boolean not null default true,
  avatar_path      text,
  created_at       timestamptz not null default now()
);

-- Profesionales de la clínica. Cada uno tiene su agenda.
-- Puede tener usuario propio (profile_id) o no (lo maneja la secretaria).
create table public.professionals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  profile_id       uuid unique references public.profiles(id) on delete set null,
  full_name        text not null,
  specialty        text,
  matricula        text,
  color            text not null default '#0d9488',
  -- Datos fiscales propios (si factura a su nombre)
  cuit             text,
  condicion_iva    text check (condicion_iva in ('monotributo','responsable_inscripto','exento')),
  punto_venta      int,
  -- Horario de atención: días 0=dom..6=sáb
  work_days        int[] not null default '{1,2,3,4,5}',
  work_start       time not null default '08:00',
  work_end         time not null default '20:00',
  slot_minutes     int not null default 45,
  verified         boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Invitaciones: la única forma de crear una cuenta.
-- Las clínicas nuevas las da de alta el equipo de MedApp con create_clinic().
create table public.invitations (
  code             text primary key default upper(substr(md5(random()::text), 1, 8)),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  role             text not null check (role in ('admin','secretaria','profesional')),
  professional_id  uuid references public.professionals(id) on delete set null,  -- agenda existente a vincular
  with_agenda      boolean not null default false,  -- admin que también atiende: se le crea agenda
  email            text,
  created_by       uuid references public.profiles(id) on delete set null,
  used_by          uuid references public.profiles(id) on delete set null,
  used_at          timestamptz,
  expires_at       timestamptz not null default now() + interval '30 days',
  created_at       timestamptz not null default now()
);

-- Qué profesionales (agendas) administra cada secretaria. Lo define la administración.
create table public.secretary_assignments (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  secretary_id     uuid not null references public.profiles(id) on delete cascade,
  professional_id  uuid not null references public.professionals(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (secretary_id, professional_id)
);

-- Financiadores: obras sociales, prepagas, PAMI, IOMA, ART, seguros, programas
create table public.obras_sociales (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  type             text not null default 'obra_social'
                   check (type in ('obra_social','prepaga','pami','ioma','incluir_salud','programa_provincial','art','seguro','otra')),
  name             text not null,                 -- nombre comercial (ej. Jerárquicos)
  razon_social     text,                          -- a nombre de quién se factura (ej. O.S.T.S.A.M.P.J.B.O.N.)
  cuit             text,
  condicion_iva    text check (condicion_iva in ('responsable_inscripto','exento','monotributo','consumidor_final')),
  address          text,
  codigo           text,
  -- Cómo se cobra normalmente: convenio directo, por el Colegio de Kinesiología, o sin convenio (reintegro)
  default_via      text not null default 'colegio' check (default_via in ('convenio','colegio','reintegro','superintendencia','convenio_art','modulo_cud')),
  presentation_channel text not null default 'mail' check (presentation_channel in ('mail','papel','portal','otro')),
  presentation_email text,
  contact          text,
  plazo_presentacion_dias int,
  plazo_pago_dias  int default 60,
  requirements     text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- Pacientes (pool compartido de la clínica)
create table public.patients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  first_name       text not null,
  last_name        text not null,
  dni              text,
  cuil             text,
  birth_date       date,
  sex              text check (sex in ('F','M','X')),
  phone            text,
  email            text,
  address          text,
  -- Tutor / responsable (menores o personas a cargo)
  tutor_name       text,
  tutor_dni        text,
  tutor_phone      text,
  -- Cobertura
  obra_social_id   uuid references public.obras_sociales(id) on delete set null,
  os_plan          text,
  os_affiliate_number text,
  credential_file_path text,
  -- Certificado Único de Discapacidad
  has_cud          boolean not null default false,
  cud_number       text,
  cud_diagnosis    text,
  cud_issued       date,
  cud_expiry       date,
  cud_file_path    text,
  -- Clínico básico
  diagnosis        text,
  consult_reason   text,
  background       text,                          -- antecedentes
  main_professional_id uuid references public.professionals(id) on delete set null,
  notes            text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index patients_org_lastname_idx on public.patients (organization_id, last_name, first_name);

-- Historia clínica: no se borra ni se edita; solo se anula con motivo
create table public.clinical_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete restrict,
  author_id        uuid references public.profiles(id) on delete set null,
  professional_id  uuid references public.professionals(id) on delete set null,
  entry_date       date not null default current_date,
  kind             text not null default 'consulta' check (kind in ('consulta','evolucion','estudio','receta','nota','otro')),
  title            text not null,
  content          text not null,
  voided_at        timestamptz,
  voided_by        uuid references public.profiles(id) on delete set null,
  void_reason      text,
  created_at       timestamptz not null default now()
);
create index clinical_entries_patient_idx on public.clinical_entries (patient_id, entry_date desc);

-- Tratamientos: la unidad que se factura. Junta orden médica, cobertura,
-- vía de cobro, autorización de la obra social, copago y datos de ART.
create table public.treatments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete restrict,
  professional_id  uuid references public.professionals(id) on delete set null,
  practice_name    text not null,                 -- ej. Kinesiología motora
  practice_code    text,                          -- ej. 25.01.02
  -- Orden médica (sin orden se cobra particular)
  has_order        boolean not null default true,
  order_doctor     text,
  order_doctor_matricula text,
  order_diagnosis  text,
  order_sessions   int,
  order_date       date,
  order_file_path  text,
  -- Motivo y cobertura
  reason           text not null default 'comun' check (reason in ('comun','accidente_trabajo','accidente_transito','neurologico','respiratorio','pediatrico','otra')),
  financiador_id   uuid references public.obras_sociales(id) on delete set null,
  via              text check (via in ('convenio','colegio','reintegro','superintendencia','convenio_art','modulo_cud')),
  -- Autorización de la obra social (si la pide)
  auth_number      text,
  sessions_authorized int,                        -- total del período
  sessions_per_month int,                         -- discapacidad: sesiones aprobadas por mes
  period_from      date,
  period_to        date,
  auth_file_path   text,
  -- Copago: lo que paga el paciente por sesión
  copago_amount    numeric(14,2),
  -- ART
  art_siniestro    text,
  art_empleador    text,
  -- Valor manual por sesión (si se carga, tiene prioridad sobre la tabla de tarifas)
  manual_value     numeric(14,2),
  reason_other     text,                          -- categoría escrita a mano
  custom_tariff    text,                          -- tarifa propia elegida para este tratamiento
  notes            text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  check (period_to is null or period_from is null or period_to >= period_from)
);
create index treatments_patient_idx on public.treatments (patient_id);

-- Tarifas con fecha de vigencia. La app usa el valor vigente a la fecha de cada sesión.
create table public.tariffs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  tariff           text not null check (tariff in (
                     'discapacidad_nacional','discapacidad_ioma','discapacidad_provincial','incluir_salud',
                     'colegio','convenio','pami','ioma','art','seguro','particular','superintendencia','propia')),
  custom_name      text,                          -- nombre de la tarifa propia
  financiador_id   uuid references public.obras_sociales(id) on delete cascade,  -- solo convenio / art / seguro
  practice_code    text,                          -- vacío = cualquier práctica
  practice_name    text,
  value            numeric(14,2) not null check (value >= 0),
  valid_from       date not null,
  notes            text,
  created_at       timestamptz not null default now()
);
create index tariffs_lookup_idx on public.tariffs (organization_id, tariff, valid_from desc);

-- Series de turnos: "8 sesiones, 1 por semana"
create table public.treatment_packages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  name             text not null,
  total_sessions   int not null check (total_sessions > 0),
  interval_days    int not null default 7 check (interval_days > 0),
  created_at       timestamptz not null default now()
);

-- Turnos. Los del mismo profesional no se pueden superponer (salvo sobreturno).
create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete restrict,
  professional_id  uuid not null references public.professionals(id) on delete restrict,
  treatment_id     uuid references public.treatments(id) on delete set null,
  package_id       uuid references public.treatment_packages(id) on delete set null,
  session_number   int,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'confirmado'
                   check (status in ('confirmado','atendido','ausente','cancelado')),
  is_overbook      boolean not null default false,
  in_conflict      boolean not null default false, -- copiado encima de otro turno, falta resolverlo
  series_id        uuid,                          -- turnos agendados juntos
  notes            text,
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  check (starts_at >= '2020-01-01' and starts_at < '2100-01-01'),
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelado' and not is_overbook)
);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_treatment_idx on public.appointments (treatment_id);

-- Registros de historia clínica escritos desde un turno quedan vinculados a él
alter table public.clinical_entries
  add column appointment_id uuid references public.appointments(id) on delete set null,
  add column treatment_id   uuid references public.treatments(id) on delete set null;

-- Facturas. Mientras no esté ARCA integrado, se emiten en ARCA a mano
-- y acá se registra el número, el CAE y el PDF.
-- Circuito: preparada -> emitida -> presentada -> cobrada (o anulada)
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null check (kind in ('obra_social','reintegro','particular')),
  patient_id       uuid references public.patients(id) on delete restrict,
  obra_social_id   uuid references public.obras_sociales(id) on delete set null,
  treatment_id     uuid references public.treatments(id) on delete set null,
  professional_id  uuid references public.professionals(id) on delete set null,  -- a nombre de quién se factura (su CUIT)
  -- total: factura normal · financiador / copago: el monto se divide en dos facturas
  part             text not null default 'total' check (part in ('total','financiador','copago')),
  rule_case        int,                           -- regla de facturación aplicada (1 a 15)
  period           text,                          -- "2026-09"
  period_from      date,
  period_to        date,
  status           text not null default 'preparada' check (status in ('preparada','emitida','presentada','cobrada','anulada')),
  total            numeric(14,2) not null default 0,
  notes            text,
  -- Datos del comprobante emitido en ARCA
  tipo_comprobante text default 'C',
  punto_venta      int,
  arca_number      int,                           -- número de comprobante
  issue_date       date,
  cae              text,
  cae_vencimiento  date,
  arca_pdf_path    text,
  -- Presentación y cobro
  presented_at     date,
  presented_channel text check (presented_channel in ('mail','papel','portal','otro')),
  paid_at          date,
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz not null default now()
);
create index invoices_org_idx on public.invoices (organization_id, created_at desc);
create index invoices_patient_idx on public.invoices (patient_id);

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  description      text not null,
  code             text,
  quantity         numeric(10,2) not null default 1,
  unit_price       numeric(14,2) not null default 0
);

-- Historial de cada factura: notas, reclamos, cambios de estado
create table public.invoice_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  kind             text not null check (kind in ('estado','nota','reclamo')),
  text             text not null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- Registro de auditoría (lo llena un trigger; nadie lo puede editar)
create table public.audit_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  user_id          uuid,
  table_name       text not null,
  row_id           uuid,
  action           text not null,       -- INSERT / UPDATE / DELETE
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

-- Historia clínica: solo profesionales y administración (la secretaría nunca)
create or replace function public.can_see_clinical()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin','profesional'), false)
$$;

-- Agendas (profesionales) que el usuario puede ver y gestionar:
--   admin: todas · profesional: la suya · secretaria: las que tiene asignadas
create or replace function public.my_professional_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.professionals p
  where p.organization_id = public.current_org_id()
    and (public.is_admin()
         or p.profile_id = auth.uid()
         or exists (select 1 from public.secretary_assignments s
                    where s.secretary_id = auth.uid() and s.professional_id = p.id))
$$;

-- Un paciente es visible si es de alguno de "mis" profesionales
create or replace function public.can_see_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.patients x where x.id = p_patient and x.main_professional_id in (select public.my_professional_ids()))
    or exists (select 1 from public.treatments t where t.patient_id = p_patient and t.professional_id in (select public.my_professional_ids()))
    or exists (select 1 from public.appointments a where a.patient_id = p_patient and a.professional_id in (select public.my_professional_ids()))
$$;

-- Alta de una clínica nueva (la usa el equipo de MedApp, no la app).
-- Devuelve el código de invitación para la administradora.
create or replace function public.create_clinic(p_name text, p_admin_email text default null, p_with_agenda boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  insert into public.organizations (name, email) values (p_name, p_admin_email) returning id into v_org;
  insert into public.invitations (organization_id, role, email, with_agenda) values (v_org, 'admin', p_admin_email, p_with_agenda)
  returning code into v_code;
  return v_code;
end $$;
revoke execute on function public.create_clinic(text, text, boolean) from public, anon, authenticated;

-- Al registrarse: el código de invitación es obligatorio
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations%rowtype;
  v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  v_name text := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email);
begin
  select * into v_inv from public.invitations
  where code = v_code and used_at is null and expires_at > now();
  if not found then
    raise exception 'Código de invitación inválido o vencido';
  end if;

  insert into public.profiles (id, organization_id, full_name, email, role)
  values (new.id, v_inv.organization_id, v_name, new.email, v_inv.role);

  if v_inv.professional_id is not null then
    update public.professionals set profile_id = new.id where id = v_inv.professional_id;
  elsif v_inv.role = 'profesional' or v_inv.with_agenda then
    -- Profesionales (y la administradora que también atiende) tienen su propia agenda
    insert into public.professionals (organization_id, profile_id, full_name, specialty, matricula)
    values (v_inv.organization_id, new.id, v_name,
            nullif(new.raw_user_meta_data->>'specialty',''), nullif(new.raw_user_meta_data->>'matricula',''));
  end if;

  update public.invitations set used_at = now(), used_by = new.id where code = v_inv.code;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auditoría genérica
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (organization_id, user_id, table_name, row_id, action, old_data, new_data)
  values (
    (v_row->>'organization_id')::uuid,
    auth.uid(),
    tg_table_name,
    (v_row->>'id')::uuid,
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients','clinical_entries','treatments','tariffs','appointments','invoices',
                           'obras_sociales','professionals','profiles','organizations']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- Roles y accesos los cambia solo el equipo de MedApp (desde el panel / CLI), nunca un usuario de la app
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.organization_id is distinct from old.organization_id
     or new.role is distinct from old.role or new.active is distinct from old.active then
    raise exception 'Los roles y accesos no se pueden cambiar desde la app';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- La historia clínica no se edita: solo se puede anular (una vez)
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
create trigger clinical_entries_guard before update on public.clinical_entries
  for each row execute function public.clinical_entries_guard();

-- La fecha de un registro clínico es siempre la del día en que se escribe
create or replace function public.clinical_entries_date()
returns trigger language plpgsql as $
begin
  new.entry_date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  return new;
end $;
create trigger clinical_entries_date before insert on public.clinical_entries
  for each row execute function public.clinical_entries_date();

-- ---------------------------------------------------------------------
-- Seguridad: Row Level Security
-- Regla base: cada usuario solo ve filas de su organización.
-- Encima: permisos por rol.
-- ---------------------------------------------------------------------
alter table public.organizations      enable row level security;
alter table public.profiles           enable row level security;
alter table public.professionals      enable row level security;
alter table public.invitations        enable row level security;
alter table public.secretary_assignments enable row level security;
alter table public.obras_sociales     enable row level security;
alter table public.patients           enable row level security;
alter table public.clinical_entries   enable row level security;
alter table public.treatments         enable row level security;
alter table public.tariffs            enable row level security;
alter table public.treatment_packages enable row level security;
alter table public.appointments       enable row level security;
alter table public.invoices           enable row level security;
alter table public.invoice_items      enable row level security;
alter table public.invoice_events     enable row level security;
alter table public.audit_log          enable row level security;

-- Organización: todos la ven; solo admin la edita
create policy org_select on public.organizations for select using (id = public.current_org_id());
create policy org_update on public.organizations for update using (id = public.current_org_id() and public.is_admin());

-- Usuarios: todos ven al equipo; cada uno edita solo su nombre (roles/accesos: bloqueados por trigger)
create policy profiles_select on public.profiles for select using (organization_id = public.current_org_id());
create policy profiles_update on public.profiles for update using (organization_id = public.current_org_id() and id = auth.uid());

-- Profesionales: todos ven los nombres; solo admin edita. Altas: las hace el equipo de MedApp.
create policy professionals_select on public.professionals for select using (organization_id = public.current_org_id());
create policy professionals_update on public.professionals for update using (organization_id = public.current_org_id() and public.is_admin());

-- Invitaciones: sin acceso desde la app (las crea el equipo de MedApp)

-- Asignación secretaria → profesionales: todos ven, solo admin gestiona
create policy assign_select on public.secretary_assignments for select using (organization_id = public.current_org_id());
create policy assign_write on public.secretary_assignments for all
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- Pacientes: cada uno ve los de sus profesionales. Nadie borra: se archivan.
create policy patients_select on public.patients for select
  using (organization_id = public.current_org_id() and public.can_see_patient(id));
create policy patients_insert on public.patients for insert
  with check (organization_id = public.current_org_id()
              and (public.is_admin() or main_professional_id in (select public.my_professional_ids())));
create policy patients_update on public.patients for update
  using (organization_id = public.current_org_id() and public.can_see_patient(id));

-- Historia clínica: admin y profesionales, de pacientes visibles. Sin delete.
create policy clinical_select on public.clinical_entries for select
  using (organization_id = public.current_org_id() and public.can_see_clinical() and public.can_see_patient(patient_id));
create policy clinical_insert on public.clinical_entries for insert
  with check (organization_id = public.current_org_id() and public.can_see_clinical() and public.can_see_patient(patient_id));
create policy clinical_update on public.clinical_entries for update
  using (organization_id = public.current_org_id() and public.can_see_clinical() and public.can_see_patient(patient_id));

-- Tratamientos: de mis profesionales (admin: todos). Sin delete.
create policy treat_select on public.treatments for select
  using (organization_id = public.current_org_id() and (public.is_admin() or professional_id in (select public.my_professional_ids())));
create policy treat_insert on public.treatments for insert
  with check (organization_id = public.current_org_id() and (public.is_admin() or professional_id in (select public.my_professional_ids())));
create policy treat_update on public.treatments for update
  using (organization_id = public.current_org_id() and (public.is_admin() or professional_id in (select public.my_professional_ids())));

-- Tarifas: todos ven, solo admin gestiona · Coberturas: admin y secretaría gestionan
create policy tariffs_select on public.tariffs for select using (organization_id = public.current_org_id());
create policy tariffs_write on public.tariffs for all
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());
create policy os_select on public.obras_sociales for select using (organization_id = public.current_org_id());
create policy os_insert on public.obras_sociales for insert
  with check (organization_id = public.current_org_id() and public.current_app_role() in ('admin','secretaria'));
create policy os_update on public.obras_sociales for update
  using (organization_id = public.current_org_id() and public.current_app_role() in ('admin','secretaria'));

-- Turnos: solo de mis profesionales. Se pueden borrar si no fueron atendidos.
create policy appt_select on public.appointments for select
  using (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()));
create policy appt_insert on public.appointments for insert
  with check (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()));
create policy appt_update on public.appointments for update
  using (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()))
  with check (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()));
create policy appt_delete on public.appointments for delete
  using (organization_id = public.current_org_id() and professional_id in (select public.my_professional_ids()) and status not in ('atendido', 'ausente'));
create policy packages_all on public.treatment_packages for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

-- Facturación: admin todo · secretaria las de sus médicos · profesional las suyas (migración 0011)
create or replace function public.can_bill_for(p_professional uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or p_professional in (select public.my_professional_ids())
$$;
create policy inv_select on public.invoices for select
  using (organization_id = public.current_org_id() and (public.is_admin() or professional_id in (select public.my_professional_ids())));
create policy inv_insert on public.invoices for insert
  with check (organization_id = public.current_org_id() and public.can_bill_for(professional_id));
create policy inv_update on public.invoices for update
  using (organization_id = public.current_org_id() and public.can_bill_for(professional_id));
create policy items_select on public.invoice_items for select
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy items_write on public.invoice_items for insert
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.organization_id = public.current_org_id() and public.can_bill_for(i.professional_id)));
create policy events_select on public.invoice_events for select
  using (organization_id = public.current_org_id() and exists (select 1 from public.invoices i where i.id = invoice_id));
create policy events_insert on public.invoice_events for insert
  with check (organization_id = public.current_org_id() and exists (select 1 from public.invoices i where i.id = invoice_id and public.can_bill_for(i.professional_id)));

-- Auditoría: solo lectura, solo admin
create policy audit_select on public.audit_log for select
  using (organization_id = public.current_org_id() and public.current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- Archivos (autorizaciones, facturas de ARCA): bucket privado.
-- Ruta: <organization_id>/<carpeta>/<archivo>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 15728640)
on conflict (id) do nothing;

create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_org_id()::text);
create policy docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.current_org_id()::text);

-- Valores públicos de referencia, iguales para todas las clínicas
create table public.tariff_reference (
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
create policy tariff_reference_read on public.tariff_reference for select to authenticated using (true);

-- Conexión de cada profesional con ARCA para emitir facturas electrónicas (web service wsfev1).
-- La clave privada se guarda encriptada con ARCA_ENCRYPTION_KEY, que solo existe en el servidor.
create table if not exists public.arca_credentials (
  professional_id  uuid primary key references public.professionals(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  environment      text not null default 'produccion' check (environment in ('produccion','homologacion')),
  cuit             text not null check (cuit ~ '^[0-9]{11}$'),
  punto_venta      int check (punto_venta between 1 and 99998),
  private_key_enc  text not null,
  csr              text not null,
  certificate      text,
  cert_expires_at  timestamptz,
  -- Permiso de WSAA: dura unas 12 horas y ARCA no da otro mientras esté vigente
  ta_token         text,
  ta_sign          text,
  ta_expires_at    timestamptz,
  checked_at       timestamptz,
  check_error      text,
  updated_at       timestamptz not null default now()
);

alter table public.arca_credentials enable row level security;

-- Ven el estado: la administración, las secretarias de ese profesional y el profesional mismo
drop policy if exists arca_select on public.arca_credentials;
create policy arca_select on public.arca_credentials for select
  using (organization_id = public.current_org_id()
         and (public.can_bill_for(professional_id)
              or exists (select 1 from public.professionals p where p.id = professional_id and p.profile_id = auth.uid())));

-- Conectan o cambian el certificado: la administración y el profesional mismo
drop policy if exists arca_insert on public.arca_credentials;
create policy arca_insert on public.arca_credentials for insert
  with check (organization_id = public.current_org_id()
              and (public.is_admin()
                   or exists (select 1 from public.professionals p where p.id = professional_id and p.profile_id = auth.uid())));
drop policy if exists arca_update on public.arca_credentials;
create policy arca_update on public.arca_credentials for update
  using (organization_id = public.current_org_id()
         and (public.is_admin()
              or exists (select 1 from public.professionals p where p.id = professional_id and p.profile_id = auth.uid())));

-- Quien puede facturar por el profesional guarda el permiso de ARCA, sin poder tocar el resto
create or replace function public.arca_save_ta(p_professional uuid, p_token text, p_sign text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_bill_for(p_professional)
          or exists (select 1 from public.professionals p where p.id = p_professional and p.profile_id = auth.uid())) then
    raise exception 'Sin permiso';
  end if;
  update public.arca_credentials
     set ta_token = p_token, ta_sign = p_sign, ta_expires_at = p_expires
   where professional_id = p_professional and organization_id = public.current_org_id();
end $$;

create or replace function public.arca_save_check(p_professional uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_bill_for(p_professional)
          or exists (select 1 from public.professionals p where p.id = p_professional and p.profile_id = auth.uid())) then
    raise exception 'Sin permiso';
  end if;
  update public.arca_credentials
     set checked_at = now(), check_error = p_error
   where professional_id = p_professional and organization_id = public.current_org_id();
end $$;
