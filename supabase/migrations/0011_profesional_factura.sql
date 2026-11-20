-- Cada profesional puede facturar lo suyo (preparar, emitir, presentar y cobrar sus facturas).
-- Administración factura todo; una asistente, lo de los profesionales que tiene asignados;
-- un profesional, solo lo propio (my_professional_ids() le devuelve únicamente su registro).
create or replace function public.can_bill_for(p_professional uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or p_professional in (select public.my_professional_ids())
$$;
