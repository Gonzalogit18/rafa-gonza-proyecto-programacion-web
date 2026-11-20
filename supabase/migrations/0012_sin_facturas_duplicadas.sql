-- Nunca dos facturas vigentes por lo mismo: aunque dos personas preparen a la vez, la base rechaza la segunda.
-- Una anulada no cuenta (por eso se puede volver a preparar).
-- Con tratamiento: una por tratamiento, mes y parte (total, o financiador + copago)
create unique index if not exists invoices_una_por_tratamiento_mes
  on public.invoices (treatment_id, period, part)
  where status <> 'anulada' and treatment_id is not null;
-- Consultas sin tratamiento (rule_case = 0): una por paciente, profesional y mes
create unique index if not exists invoices_una_sin_tratamiento_mes
  on public.invoices (patient_id, professional_id, period)
  where status <> 'anulada' and rule_case = 0;
