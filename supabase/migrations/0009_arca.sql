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
