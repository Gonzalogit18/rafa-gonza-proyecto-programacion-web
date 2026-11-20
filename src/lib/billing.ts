import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyRules, pickTariff, priceSessions, type RuleResult, type TariffKey, type TariffRow } from "./billing-rules";
import { arToISO, toAR } from "./format";
import type { Invoice, ObraSocial, Patient, Treatment } from "./types";

type BillingPatient = Pick<Patient, "id" | "first_name" | "last_name" | "dni" | "cuil" | "os_affiliate_number" | "has_cud" | "cud_expiry">;

// Una fila = un tratamiento en un mes: sesiones atendidas, qué regla aplica, cuánto se factura y a quién.
export interface BillingRow {
  key: string; // treatmentId|period
  period: string; // yyyy-MM
  treatment: Treatment & { financiador: Pick<ObraSocial, "id" | "name" | "type" | "default_via"> | null };
  patient: BillingPatient;
  dates: string[];
  rule: RuleResult;
  lines: { from: string; to: string; quantity: number; unit: number }[];
  total: number;
  copagoTotal: number; // parte del paciente (si hay copago)
  unpriced: string[]; // fechas sin tarifa cargada
  invoices: Pick<Invoice, "id" | "status" | "arca_number" | "punto_venta" | "total" | "part">[];
}

// Sesiones atendidas sin tratamiento (consultas sueltas): una fila por paciente, profesional y mes.
// No hay regla que diga el precio: se propone la tarifa de su cobertura y se confirma a mano.
export const UNTREATED_RULE = 0; // marca en invoices.rule_case de las facturas hechas así
export interface UntreatedRow {
  key: string; // sin|patientId|professionalId|period
  period: string;
  patient: BillingPatient;
  professionalId: string;
  coverage: { id: string; name: string; type: string } | null;
  dates: string[];
  suggested: number | null;
  invoiced: boolean;
}

// Qué tarifa corresponde por defecto a cada tipo de cobertura
const COVERAGE_TARIFF: Record<string, TariffKey> = { pami: "pami", ioma: "ioma", incluir_salud: "incluir_salud", art: "art", seguro: "seguro" };

export const monthRange = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: arToISO(`${period}-01`, "00:00"), to: arToISO(`${next}-01`, "00:00") };
};

/**
 * Sesiones atendidas y ausentes (los ausentes se facturan igual) agrupadas por tratamiento y mes, con la regla y el valor que corresponde.
 * - period: un mes (para preparar las de un mes)
 * - patientId: todas las de un paciente (para su ficha)
 */
export async function fetchBillingRows(supabase: SupabaseClient, opts: { period?: string; patientId?: string }) {
  let q = supabase
    .from("appointments")
    .select(
      "starts_at, treatment_id, patient_id, professional_id, " +
        "treatment:treatments(*, financiador:obras_sociales(id, name, type, default_via)), " +
        "patient:patients(id, first_name, last_name, dni, cuil, os_affiliate_number, has_cud, cud_expiry, coverage:obras_sociales(id, name, type))",
    )
    .in("status", ["atendido", "ausente"])
    .order("starts_at");
  if (opts.period) {
    const r = monthRange(opts.period);
    q = q.gte("starts_at", r.from).lt("starts_at", r.to);
  }
  if (opts.patientId) q = q.eq("patient_id", opts.patientId);
  const [{ data }, { data: tariffRows }] = await Promise.all([q, supabase.from("tariffs").select("tariff, custom_name, financiador_id, practice_code, value, valid_from")]);
  type Row = {
    starts_at: string;
    treatment_id: string | null;
    patient_id: string;
    professional_id: string;
    treatment: BillingRow["treatment"] | null;
    patient: BillingPatient & { coverage: UntreatedRow["coverage"] };
  };
  const appts = (data ?? []) as unknown as Row[];
  const tariffs = ((tariffRows ?? []) as TariffRow[]).map((t) => ({ ...t, value: Number(t.value) }));

  const groups = new Map<string, { period: string; treatment: BillingRow["treatment"]; patient: BillingPatient; dates: string[] }>();
  const withoutTreatment: Row[] = [];
  for (const a of appts) {
    if (!a.treatment_id || !a.treatment) {
      withoutTreatment.push(a);
      continue;
    }
    const day = format(toAR(a.starts_at), "yyyy-MM-dd");
    const period = day.slice(0, 7);
    const key = `${a.treatment_id}|${period}`;
    const g = groups.get(key) ?? { period, treatment: a.treatment, patient: a.patient, dates: [] };
    g.dates.push(day);
    groups.set(key, g);
  }

  const rows: BillingRow[] = [...groups.entries()].map(([key, g]) => {
    const t = g.treatment;
    const lastDate = g.dates[g.dates.length - 1];
    const cudVigente = g.patient.has_cud && (!g.patient.cud_expiry || g.patient.cud_expiry >= lastDate);
    const rule = applyRules({
      hasOrder: t.has_order,
      reason: t.reason,
      financiador: t.financiador,
      via: t.via,
      cudVigente,
      copagoAmount: t.copago_amount ? Number(t.copago_amount) : null,
      affiliateNumber: g.patient.os_affiliate_number,
      siniestro: t.art_siniestro,
    });
    if (g.patient.has_cud && !cudVigente) rule.missing.push("CUD vencido");
    const valueFor = (d: string) =>
      t.manual_value != null
        ? Number(t.manual_value)
        : pickTariff(tariffs, { tariff: rule.tariff, financiadorId: rule.tariffFinanciadorId, practiceCode: t.practice_code, date: d, customName: t.custom_tariff })?.value ?? null;
    const priced = priceSessions(g.dates, valueFor);
    const copagoTotal = rule.copago ? Number(t.copago_amount) * g.dates.length : 0;
    return { key, ...g, rule, ...priced, copagoTotal, invoices: [] };
  });

  const ids = [...new Set(rows.map((r) => r.treatment.id))];
  if (ids.length) {
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, status, arca_number, punto_venta, total, part, treatment_id, period")
      .in("treatment_id", ids)
      .neq("status", "anulada");
    for (const inv of invs ?? []) rows.find((r) => r.key === `${inv.treatment_id}|${inv.period}`)?.invoices.push(inv);
  }

  rows.sort((a, b) => b.period.localeCompare(a.period) || a.patient.last_name.localeCompare(b.patient.last_name));

  // Consultas sin tratamiento, agrupadas por paciente, profesional y mes
  const loose = new Map<string, UntreatedRow>();
  for (const a of withoutTreatment) {
    const day = format(toAR(a.starts_at), "yyyy-MM-dd");
    const period = day.slice(0, 7);
    const key = `sin|${a.patient_id}|${a.professional_id}|${period}`;
    const { coverage, ...patient } = a.patient;
    const g = loose.get(key) ?? { key, period, patient, professionalId: a.professional_id, coverage: coverage ?? null, dates: [], suggested: null, invoiced: false };
    g.dates.push(day);
    loose.set(key, g);
  }
  const untreated = [...loose.values()];
  for (const u of untreated) {
    const date = u.dates[u.dates.length - 1];
    const tariff: TariffKey = u.coverage ? COVERAGE_TARIFF[u.coverage.type] ?? "convenio" : "particular";
    u.suggested = pickTariff(tariffs, { tariff, financiadorId: u.coverage?.id ?? null, practiceCode: null, date })?.value ?? null;
  }
  const loosePatients = [...new Set(untreated.map((u) => u.patient.id))];
  if (loosePatients.length) {
    const { data: invs } = await supabase
      .from("invoices")
      .select("patient_id, professional_id, period")
      .eq("rule_case", UNTREATED_RULE)
      .in("patient_id", loosePatients)
      .neq("status", "anulada");
    for (const inv of invs ?? []) {
      const u = loose.get(`sin|${inv.patient_id}|${inv.professional_id}|${inv.period}`);
      if (u) u.invoiced = true;
    }
  }

  return {
    rows,
    untreated,
    withoutTreatment: withoutTreatment.length,
    withoutTreatmentDates: withoutTreatment.map((w) => format(toAR(w.starts_at), "yyyy-MM-dd")),
    withoutTreatmentPatients: [...new Map(withoutTreatment.map((w) => [w.patient_id, w.patient])).values()],
  };
}
