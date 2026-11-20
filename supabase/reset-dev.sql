-- =====================================================================
drop table if exists public.tariff_reference cascade;
drop table if exists public.schema_migrations cascade;
-- SOLO PARA LA BASE DE PRUEBAS. Borra TODO (tablas, datos, usuarios)
-- para reinstalar schema.sql desde cero. NUNCA correr en producción.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.audit_log, public.invoice_events, public.invoice_items, public.invoices,
  public.waitlist, public.appointments, public.treatment_packages, public.authorizations, public.treatments, public.tariffs,
  public.clinical_summaries, public.clinical_entries, public.patients, public.obras_sociales,
  public.secretary_assignments, public.invitations, public.professionals, public.profiles, public.organizations
cascade;

drop function if exists public.current_org_id(), public.current_app_role(), public.can_see_clinical(),
  public.is_staff(), public.create_clinic(text, text), public.create_clinic(text, text, boolean), public.handle_new_user(), public.audit_trigger(),
  public.clinical_entries_guard(), public.profiles_guard(), public.set_invoice_number(),
  public.is_admin(), public.my_professional_ids(), public.can_see_patient(uuid), public.can_bill_for(uuid) cascade;

drop policy if exists docs_select on storage.objects;
drop policy if exists docs_insert on storage.objects;

delete from auth.users;
