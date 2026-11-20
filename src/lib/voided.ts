import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO, subMonths } from "date-fns";
import { arToISO, todayAR } from "./format";

export type VoidedRow = {
  id: string;
  period: string | null;
  total: number;
  part: string;
  treatment_id: string | null;
  voided_at: string;
  void_reason: string | null;
  professional_id: string | null;
  patient: { id: string; first_name: string; last_name: string } | null;
  obra_social: { name: string } | null;
  // Las sesiones ya tienen otra factura: esa plata no se pierde
  redone: boolean;
};

// Facturas anuladas del último año. Si se anuló y no se volvió a preparar, esas sesiones quedan sin cobrar.
export async function fetchVoided(supabase: SupabaseClient, professionalId?: string | null) {
  const since = format(subMonths(parseISO(todayAR()), 12), "yyyy-MM-dd");
  let q = supabase
    .from("invoices")
    .select("id, period, total, part, treatment_id, voided_at, void_reason, professional_id, patient:patients(id, first_name, last_name), obra_social:obras_sociales(name)")
    .eq("status", "anulada")
    .gte("voided_at", arToISO(since, "00:00"))
    .order("voided_at", { ascending: false });
  if (professionalId) q = q.eq("professional_id", professionalId);
  const [{ data }, { data: active }] = await Promise.all([
    q,
    supabase.from("invoices").select("treatment_id, period, part").neq("status", "anulada").not("treatment_id", "is", null),
  ]);
  const redone = new Set((active ?? []).map((i) => `${i.treatment_id}|${i.period}|${i.part}`));
  return ((data ?? []) as unknown as Omit<VoidedRow, "redone">[]).map((v) => ({
    ...v,
    redone: !v.treatment_id || redone.has(`${v.treatment_id}|${v.period}|${v.part}`),
  }));
}
