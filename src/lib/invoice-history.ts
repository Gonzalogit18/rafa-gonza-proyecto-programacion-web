import type { SupabaseClient } from "@supabase/supabase-js";
import { arToISO } from "./format";
import { matchesSearch } from "./search";

export const INVOICE_SELECT =
  "*, patient:patients(id, first_name, last_name, dni, os_affiliate_number), " +
  "obra_social:obras_sociales(id, name, razon_social, cuit, condicion_iva, address, plazo_pago_dias, presentation_channel, presentation_email), " +
  "treatment:treatments(id, practice_name, auth_number), professional:professionals(id, full_name, cuit, condicion_iva, matricula, specialty), items:invoice_items(*), " +
  "events:invoice_events(id, kind, text, created_at, author:profiles(full_name))";

export type HistoryFilters = { desde?: string; hasta?: string; q?: string; prof?: string };

export const HISTORY_SELECT =
  "id, period, paid_at, total, arca_number, punto_venta, part, kind, patient:patients(first_name, last_name, dni), obra_social:obras_sociales(name), treatment:treatments(practice_name), professional:professionals(full_name)";

export type HistoryRow = {
  id: string;
  period: string | null;
  paid_at: string | null;
  total: number;
  arca_number: number | null;
  punto_venta: number | null;
  part: string | null;
  kind: string;
  patient: { first_name: string; last_name: string; dni: string | null } | null;
  obra_social: { name: string } | null;
  treatment: { practice_name: string } | null;
  professional: { full_name: string } | null;
};

// Facturas cobradas, de la más reciente a la más vieja, filtradas por fecha de cobro y obra social.
// Devuelve la consulta sin ejecutar para poder paginarla.
export async function historyQuery(supabase: SupabaseClient, f: HistoryFilters) {
  let q = supabase.from("invoices").select(HISTORY_SELECT, { count: "exact" }).eq("status", "cobrada").order("paid_at", { ascending: false, nullsFirst: false });
  if (f.prof === "clinica") q = q.is("professional_id", null);
  else if (f.prof) q = q.eq("professional_id", f.prof);
  if (f.desde) q = q.gte("paid_at", arToISO(f.desde, "00:00"));
  if (f.hasta) q = q.lte("paid_at", arToISO(f.hasta, "23:59"));
  const text = f.q?.trim();
  if (text) {
    const { data } = await supabase.from("obras_sociales").select("id, name");
    q = q.in("obra_social_id", (data ?? []).filter((o) => matchesSearch([o.name], text)).map((o) => o.id));
  }
  return { query: q };
}
