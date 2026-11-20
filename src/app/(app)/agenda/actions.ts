"use server";

import { addYears, format, parseISO } from "date-fns";
import { revalidatePath } from "next/cache";
import { arToISO, fmtDate, fmtTime, fullName, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { Appointment, AppointmentStatus } from "@/lib/types";
import type { ActionResult } from "./result";

const refresh = () => {
  revalidatePath("/agenda");
  revalidatePath("/");
};

// Traduce los errores de la base a mensajes entendibles
function friendly(error: { code?: string; message: string }, when?: string): string {
  if (error.code === "23P01" || error.message.includes("appointments_no_overlap"))
    return `El profesional ya tiene un turno en ese horario${when ? `: ${when}` : ""}. Elegí otro horario o marcalo como sobreturno.`;
  if (error.message.includes("row-level security")) return "No tenés permiso para modificar la agenda de ese profesional.";
  return error.message;
}

// Rango de fechas permitido para dar turnos: desde un año atrás hasta dos años adelante
export async function dateBounds() {
  const today = parseISO(todayAR());
  return { min: format(addYears(today, -1), "yyyy-MM-dd"), max: format(addYears(today, 2), "yyyy-MM-dd") };
}

export async function createAppointments(input: {
  patient_id: string;
  professional_id: string;
  treatment_id: string | null;
  date: string; // yyyy-MM-dd hora argentina
  time: string; // HH:mm
  duration: number;
  is_overbook?: boolean;
  notes?: string;
}): Promise<ActionResult> {
  const { supabase, org, myProfessionals } = await getSession();
  if (!myProfessionals.some((p) => p.id === input.professional_id)) return { ok: false, error: "No podés dar turnos en la agenda de ese profesional." };

  const { min, max } = await dateBounds();
  if (input.date < min || input.date > max) return { ok: false, error: `Las fechas tienen que estar entre ${fmtDate(min)} y ${fmtDate(max)}.` };

  // Control de sesiones del tratamiento (autorizadas, o si no, las indicadas en la orden)
  if (input.treatment_id) {
    const { data } = await supabase.from("treatments").select("sessions_authorized, order_sessions, practice_name, patient:patients(first_name, last_name)").eq("id", input.treatment_id).single();
    const tr = data as unknown as { sessions_authorized: number | null; order_sessions: number | null; practice_name: string; patient: { first_name: string; last_name: string } | null } | null;
    const limit = tr?.sessions_authorized ?? tr?.order_sessions ?? null;
    const { count } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("treatment_id", input.treatment_id)
      .in("status", ["confirmado", "atendido", "ausente"]);
    if (tr && limit && (count ?? 0) + 1 > limit) {
      return { ok: false, error: `${fullName(tr.patient)} · ${tr.practice_name}: tiene ${limit} sesiones y ya hay ${count} usadas o agendadas.` };
    }
  }

  const start = arToISO(input.date, input.time);
  const { error } = await supabase.from("appointments").insert({
    organization_id: org.id,
    patient_id: input.patient_id,
    professional_id: input.professional_id,
    treatment_id: input.treatment_id,
    starts_at: start,
    ends_at: new Date(new Date(start).getTime() + input.duration * 60000).toISOString(),
    is_overbook: !!input.is_overbook,
    notes: input.notes || null,
  });
  if (error) return { ok: false, error: friendly(error, `${fmtDate(start, "EEEE dd/MM")} a las ${fmtTime(start)}`) };
  refresh();
  return { ok: true, message: "Turno agendado." };
}

export async function updateAppointment(
  id: string,
  patch: { status?: AppointmentStatus; treatment_id?: string | null; notes?: string | null },
): Promise<ActionResult> {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("appointments").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "No tenés permiso para modificar ese turno." };
  refresh();
  return { ok: true };
}

// ¿Hay otro turno del profesional que ocupe ese horario?
async function overlapsOther(id: string, professionalId: string, start: string, end: string) {
  const { supabase } = await getSession();
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", professionalId)
    .neq("id", id)
    .neq("status", "cancelado")
    .eq("is_overbook", false)
    .lt("starts_at", end)
    .gt("ends_at", start);
  return (count ?? 0) > 0;
}

// Deja un turno en choque como sobreturno, salvo que el otro turno ya no esté
export async function keepAsOverbook(id: string): Promise<ActionResult> {
  const { supabase } = await getSession();
  const { data: a } = await supabase.from("appointments").select("professional_id, starts_at, ends_at").eq("id", id).single();
  if (!a) return { ok: false, error: "Turno no encontrado" };
  const is_overbook = await overlapsOther(id, a.professional_id, a.starts_at, a.ends_at);
  const { error } = await supabase.from("appointments").update({ in_conflict: false, is_overbook }).eq("id", id);
  if (error) return { ok: false, error: friendly(error) };
  refresh();
  return { ok: true };
}

// Marcar cualquier turno como sobreturno. Si tapaba a uno en rojo, ese choque queda resuelto.
export async function setOverbook(id: string, overbook: boolean): Promise<ActionResult> {
  const { supabase } = await getSession();
  const { data: a, error } = await supabase.from("appointments").update({ is_overbook: overbook, in_conflict: false }).eq("id", id).select("professional_id, starts_at, ends_at");
  if (error) return { ok: false, error: friendly(error) };
  if (!a?.length) return { ok: false, error: "No tenés permiso para modificar ese turno." };
  if (overbook) {
    const { data: red } = await supabase.from("appointments").select("id").eq("professional_id", a[0].professional_id).eq("in_conflict", true).lt("starts_at", a[0].ends_at).gt("ends_at", a[0].starts_at);
    for (const r of red ?? []) await keepAsOverbook(r.id);
  }
  refresh();
  return { ok: true };
}

// Cambia día, hora de inicio y, si se indica, hora de fin (si no, mantiene la duración)
export async function moveAppointment(id: string, date: string, time: string, endTime?: string): Promise<ActionResult> {
  const { supabase } = await getSession();
  const { min, max } = await dateBounds();
  if (date < min || date > max) return { ok: false, error: "Fecha fuera de rango." };
  const { data: a } = await supabase.from("appointments").select("professional_id, starts_at, ends_at, in_conflict").eq("id", id).single();
  if (!a) return { ok: false, error: "Turno no encontrado" };
  const start = arToISO(date, time);
  const end = endTime ? arToISO(date, endTime) : new Date(new Date(start).getTime() + new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()).toISOString();
  if (end <= start) return { ok: false, error: "La hora de fin tiene que ser después de la de inicio." };
  // Un turno en choque movido a un horario libre deja de estarlo
  const solved = a.in_conflict && !(await overlapsOther(id, a.professional_id, start, end));
  const { error } = await supabase
    .from("appointments")
    .update({ starts_at: start, ends_at: end, ...(solved && { in_conflict: false, is_overbook: false }) })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error) };
  refresh();
  return { ok: true };
}

// Deshacer: vuelve el turno a como estaba antes del último cambio (o lo recrea si se había borrado)
export type AppointmentSnapshot = Pick<
  Appointment,
  "id" | "patient_id" | "professional_id" | "treatment_id" | "package_id" | "session_number" | "series_id" | "starts_at" | "ends_at" | "status" | "is_overbook" | "in_conflict" | "notes"
>;
export async function restoreAppointment(snap: AppointmentSnapshot): Promise<ActionResult> {
  const { supabase, org, myProfessionals } = await getSession();
  if (!myProfessionals.some((p) => p.id === snap.professional_id)) return { ok: false, error: "No podés modificar la agenda de ese profesional." };
  const { error } = await supabase.from("appointments").upsert({ ...snap, organization_id: org.id });
  if (error) return { ok: false, error: friendly(error) };
  refresh();
  return { ok: true };
}

// Se pueden borrar los turnos sin atender: atendidos y ausentes quedan para facturación e historia clínica
export async function deleteAppointment(id: string): Promise<ActionResult> {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("appointments").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "No se puede borrar un turno atendido o ausente." };
  refresh();
  return { ok: true };
}

// Registro de historia clínica escrito desde un turno: queda vinculado al turno y al tratamiento
export async function addClinicalFromAppointment(appointmentId: string, kind: string, title: string, content: string): Promise<ActionResult> {
  const { supabase, org, profile, canSeeClinical } = await getSession();
  if (!canSeeClinical) return { ok: false, error: "No tenés acceso a historias clínicas." };
  if (!content.trim()) return { ok: false, error: "Escribí el registro." };
  const { data: a } = await supabase.from("appointments").select("patient_id, professional_id, treatment_id, patient:patients(archived_at)").eq("id", appointmentId).single();
  if (!a) return { ok: false, error: "Turno no encontrado" };
  if ((a.patient as unknown as { archived_at: string | null } | null)?.archived_at) return { ok: false, error: "El paciente está archivado. Restauralo para agregar registros." };
  const { error } = await supabase.from("clinical_entries").insert({
    organization_id: org.id,
    patient_id: a.patient_id,
    author_id: profile.id,
    professional_id: a.professional_id,
    appointment_id: appointmentId,
    treatment_id: a.treatment_id,
    kind,
    title: title.trim() || "Sesión",
    content: content.trim(),
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  revalidatePath(`/pacientes/${a.patient_id}`);
  return { ok: true };
}
