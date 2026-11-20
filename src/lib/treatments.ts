import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format, parseISO } from "date-fns";
import { todayAR } from "./format";
import type { Treatment } from "./types";

export type TreatmentWithUsage = Treatment & { attended: number; absent: number; scheduled: number; limit: number | null };

// Tratamientos con sesiones atendidas, ausentes y agendadas. Un ausente cuenta igual: se factura.
export async function fetchTreatments(
  supabase: SupabaseClient,
  opts: { patientId?: string; includeArchived?: boolean } = {},
): Promise<TreatmentWithUsage[]> {
  let q = supabase
    .from("treatments")
    .select("*, patient:patients(id, first_name, last_name, dni, os_plan, os_affiliate_number), financiador:obras_sociales(id, name, type, default_via)")
    .order("created_at", { ascending: false });
  if (opts.patientId) q = q.eq("patient_id", opts.patientId);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data } = await q;
  const list = (data ?? []) as Treatment[];
  if (list.length === 0) return [];

  const { data: appts } = await supabase
    .from("appointments")
    .select("treatment_id, status")
    .in("treatment_id", list.map((t) => t.id))
    .in("status", ["confirmado", "atendido", "ausente"]);

  return list.map((t) => {
    const mine = (appts ?? []).filter((x) => x.treatment_id === t.id);
    return {
      ...t,
      attended: mine.filter((x) => x.status === "atendido").length,
      absent: mine.filter((x) => x.status === "ausente").length,
      scheduled: mine.filter((x) => x.status === "confirmado").length,
      limit: t.sessions_authorized ?? t.order_sessions,
    };
  });
}

export type TreatmentAlert = "excedido" | "terminado" | "vencido" | "por_terminar" | "por_vencer" | null;

// Solo avisa lo que requiere acción: sesiones terminadas o por terminar, y autorización vencida o por vencer
export function treatmentAlert(t: TreatmentWithUsage): TreatmentAlert {
  if (t.limit) {
    const used = t.attended + t.absent + t.scheduled;
    if (used > t.limit) return "excedido";
    if (used === t.limit) return "terminado";
  }
  const today = todayAR();
  if (t.period_to && t.period_to < today) return "vencido";
  if (t.limit && t.limit - (t.attended + t.absent + t.scheduled) <= 2) return "por_terminar";
  if (t.period_to && t.period_to <= format(addDays(parseISO(today), 15), "yyyy-MM-dd")) return "por_vencer";
  return null;
}

export const ALERT_STYLE: Record<Exclude<TreatmentAlert, null>, { label: string; cls: string }> = {
  excedido: { label: "Sesiones excedidas", cls: "bg-rose-100 text-rose-700" },
  terminado: { label: "Sin sesiones disponibles", cls: "bg-amber-100 text-amber-800" },
  vencido: { label: "Autorización vencida", cls: "bg-rose-100 text-rose-700" },
  por_terminar: { label: "Quedan pocas sesiones", cls: "bg-amber-100 text-amber-800" },
  por_vencer: { label: "Autorización por vencer", cls: "bg-amber-100 text-amber-800" },
};

// Nombres de las tarifas propias de la clínica, para elegirlas en un tratamiento
export async function fetchCustomTariffs(supabase: SupabaseClient) {
  const { data } = await supabase.from("tariffs").select("custom_name").eq("tariff", "propia");
  return [...new Set((data ?? []).map((t) => t.custom_name as string).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
