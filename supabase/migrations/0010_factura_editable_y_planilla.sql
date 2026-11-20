-- Antes de emitir se pueden corregir los renglones de la factura (descripción, cantidad y precio).
-- Una vez emitida ya no: solo mientras está "preparada".
drop policy if exists items_update on public.invoice_items;
create policy items_update on public.invoice_items for update
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'preparada'
                 and i.organization_id = public.current_org_id() and public.can_bill_for(i.professional_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'preparada'
                 and i.organization_id = public.current_org_id() and public.can_bill_for(i.professional_id)));

-- Planilla de asistencia firmada por el paciente (se presenta junto con la factura)
alter table public.invoices add column if not exists attendance_file_path text;
