import { csvResponse } from "@/lib/csv";
import { fetchAll } from "@/lib/fetch-all";
import { arToISO, fmtDate, fmtTime, fullName, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import { STATUS_STYLE } from "../status";
import type { AppointmentStatus } from "@/lib/types";

type Row = {
  starts_at: string;
  status: AppointmentStatus;
  notes: string | null;
  patient: { first_name: string; last_name: string } | null;
  treatment: { practice_name: string } | null;
  professional: { full_name: string } | null;
};

// Descarga los turnos de un período para abrir en Excel
export async function GET(request: Request) {
  const { supabase, myProfessionals } = await getSession();
  const p = new URL(request.url).searchParams;
  const desde = p.get("desde") ?? todayAR();
  const hasta = p.get("hasta") ?? desde;
  const prof = myProfessionals.find((x) => x.id === p.get("prof"))?.id ?? null;
  const rows = await fetchAll<Row>((a, b) =>
    supabase
    .from("appointments")
    .select("starts_at, status, notes, patient:patients(first_name, last_name), treatment:treatments(practice_name), professional:professionals(full_name)")
    .gte("starts_at", arToISO(desde, "00:00"))
    .lte("starts_at", arToISO(hasta, "23:59"))
    .in("professional_id", prof ? [prof] : myProfessionals.map((x) => x.id))
    .order("starts_at")
    .range(a, b),
  );
  return csvResponse(
    `agenda-${desde}-a-${hasta}.csv`,
    ["Fecha", "Hora", "Paciente", "Profesional", "Tratamiento", "Estado", "Nota"],
    rows.map((r) => [fmtDate(r.starts_at), fmtTime(r.starts_at), fullName(r.patient), r.professional?.full_name, r.treatment?.practice_name, STATUS_STYLE[r.status].label, r.notes]),
  );
}
