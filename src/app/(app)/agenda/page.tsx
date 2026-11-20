import { addDays, addMonths, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { EmptyState, PageHeader } from "@/components/ui";
import { arToISO, nowAR, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { Appointment, Patient, Treatment } from "@/lib/types";
import { dateBounds } from "./actions";
import { AgendaView, type View } from "./agenda-view";

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const sp = (await searchParams) as { vista?: string; fecha?: string; prof?: string };
  const { supabase, myProfessional, myProfessionals, canSeeClinical } = await getSession();

  if (myProfessionals.length === 0)
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Agenda" />
        <EmptyState title="No tenés agendas asignadas" />
      </div>
    );

  const view: View = sp.vista === "mes" ? "mes" : sp.vista === "dia" ? "dia" : "semana";
  const anchor = sp.fecha ?? todayAR();
  const a = parseISO(anchor);
  const prof = myProfessionals.find((p) => p.id === sp.prof) ?? myProfessional ?? myProfessionals[0];

  const from = view === "dia" ? a : view === "semana" ? startOfWeek(a, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(a), { weekStartsOn: 1 });
  const to = view === "dia" ? addDays(a, 1) : view === "semana" ? addDays(from, 7) : addDays(from, 42);

  const [{ data: appts }, { data: patients }, { data: treatments }, bounds] = await Promise.all([
    supabase
      .from("appointments")
      .select("*, patient:patients(id, first_name, last_name, phone), treatment:treatments(id, practice_name)")
      .eq("professional_id", prof.id)
      .gte("starts_at", arToISO(format(from, "yyyy-MM-dd"), "00:00"))
      .lt("starts_at", arToISO(format(to, "yyyy-MM-dd"), "00:00"))
      .order("starts_at"),
    supabase.from("patients").select("id, first_name, last_name, phone, main_professional_id").is("archived_at", null).order("last_name"),
    supabase
      .from("treatments")
      .select("id, patient_id, practice_name, sessions_authorized, order_sessions, period_to, professional_id")
      .is("archived_at", null)
      .or(`period_to.is.null,period_to.gte.${format(addDays(nowAR(), -120), "yyyy-MM-dd")}`),
    dateBounds(),
  ]);
  const list = (appts ?? []) as Appointment[];

  // Registros de historia clínica escritos desde cada turno
  const notesByAppt: Record<string, string[]> = {};
  if (canSeeClinical && list.length) {
    const { data: ce } = await supabase.from("clinical_entries").select("appointment_id, title").in("appointment_id", list.map((x) => x.id)).is("voided_at", null);
    for (const e of ce ?? []) (notesByAppt[e.appointment_id!] ??= []).push(e.title);
  }

  const step =
    view === "dia" ? { prev: addDays(a, -1), next: addDays(a, 1) } : view === "semana" ? { prev: addDays(a, -7), next: addDays(a, 7) } : { prev: addMonths(a, -1), next: addMonths(a, 1) };

  return (
    <AgendaView
      view={view}
      explicitView={!!sp.vista}
      anchor={anchor}
      professional={prof}
      professionals={myProfessionals}
      isOwnOnly={myProfessionals.length === 1}
      rangeStart={format(from, "yyyy-MM-dd")}
      today={format(nowAR(), "yyyy-MM-dd")}
      prev={format(step.prev, "yyyy-MM-dd")}
      next={format(step.next, "yyyy-MM-dd")}
      bounds={bounds}
      appointments={list}
      patients={(patients ?? []) as Patient[]}
      treatments={((treatments ?? []) as Treatment[]).filter((t) => !t.professional_id || t.professional_id === prof.id)}
      canWriteClinical={canSeeClinical}
      clinicalByAppointment={notesByAppt}
    />
  );
}
