import { csvResponse } from "@/lib/csv";
import { fetchAll } from "@/lib/fetch-all";
import { fmtDate, fullName, monthLabel, todayAR } from "@/lib/format";
import { historyQuery, type HistoryRow } from "@/lib/invoice-history";
import { getSession } from "@/lib/session";

// Descarga las facturas cobradas para abrir en Excel, con los mismos filtros de la pantalla
export async function GET(request: Request) {
  const { supabase } = await getSession();
  const p = new URL(request.url).searchParams;
  const filters = { desde: p.get("desde") ?? undefined, hasta: p.get("hasta") ?? undefined, q: p.get("q") ?? undefined, prof: p.get("prof") ?? undefined };
  const rows = await fetchAll<HistoryRow>(async (a, b) => (await historyQuery(supabase, filters)).query.range(a, b));
  return csvResponse(
    `facturas-cobradas-${todayAR()}.csv`,
    ["Cobrada", "Período", "Punto de venta", "Número", "Paciente", "DNI", "Cobertura", "Práctica", "Profesional", "Total"],
    rows.map((r) => [
      r.paid_at ? fmtDate(r.paid_at) : "",
      r.period ? monthLabel(r.period) : "",
      r.punto_venta,
      r.arca_number,
      fullName(r.patient),
      r.patient?.dni,
      r.obra_social?.name ?? "Particular",
      r.treatment?.practice_name,
      r.professional?.full_name,
      Number(r.total),
    ]),
  );
}
