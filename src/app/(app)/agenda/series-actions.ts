"use server";

import { addDays, endOfWeek, format, getDay, parseISO, startOfWeek } from "date-fns";
import { revalidatePath } from "next/cache";
import { fetchAll } from "@/lib/fetch-all";
import { arToISO, fmtDate, fmtTime, fullName, toAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import { dateBounds } from "./actions";
import type { ActionResult } from "./result";

export type Slot = {
  key: string;
  date: string; // yyyy-MM-dd hora argentina
  time: string; // HH:mm
  duration: number;
  patient_id: string;
  treatment_id: string | null;
  label?: string; // paciente, cuando el lote tiene varios
  overbook?: boolean;
  conflict?: boolean; // se agenda igual y queda en rojo para resolverlo después
};
export type Conflict = { key: string; who: string };
export type Taken = { id: string; date: string; time: string; duration: number; who: string };
// Fechas que pasan el límite de sesiones de su tratamiento (las últimas del lote)
export type OverLimit = { treatmentId: string; who: string; left: number; keys: string[] };

const MAX_SLOTS = 400;
const endOf = (start: string, minutes: number) => new Date(new Date(start).getTime() + minutes * 60000).toISOString();

// Sesiones que le quedan a un tratamiento, para proponer el total
export async function treatmentRemaining(id: string): Promise<number | null> {
  const { supabase } = await getSession();
  const { data: tr } = await supabase.from("treatments").select("sessions_authorized, order_sessions").eq("id", id).single();
  const limit = tr?.sessions_authorized ?? tr?.order_sessions ?? null;
  if (!limit) return null;
  const { count } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("treatment_id", id).in("status", ["confirmado", "atendido", "ausente"]);
  return Math.max(0, limit - (count ?? 0));
}

// La agenda real de las semanas involucradas y qué fechas chocan con ella
export async function checkSlots(professionalId: string, slots: Slot[]): Promise<{ conflicts: Conflict[]; taken: Taken[]; over: OverLimit[] }> {
  if (slots.length === 0) return { conflicts: [], taken: [], over: [] };
  const { supabase } = await getSession();
  const days = slots.map((s) => s.date).sort();
  const from = format(startOfWeek(parseISO(days[0]), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const to = format(endOfWeek(parseISO(days[days.length - 1]), { weekStartsOn: 1 }), "yyyy-MM-dd");
  type Row = { id: string; starts_at: string; ends_at: string; is_overbook: boolean; patient: { first_name: string; last_name: string } | null };
  const rows = await fetchAll<Row>((a, b) =>
    supabase
      .from("appointments")
      .select("id, starts_at, ends_at, is_overbook, patient:patients(first_name, last_name)")
      .eq("professional_id", professionalId)
      .neq("status", "cancelado")
      .gte("starts_at", arToISO(from, "00:00"))
      .lte("starts_at", arToISO(to, "23:59"))
      .order("starts_at")
      .range(a, b),
  );
  const conflicts: Conflict[] = [];
  // También chocan dos sesiones nuevas entre sí (por ejemplo, al mover una encima de otra): queda marcada la segunda
  const ordered = [...slots].sort((x, y) => `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`));
  const placed: { start: number; end: number; who: string; time: string }[] = [];
  for (const s of ordered) {
    const start = arToISO(s.date, s.time);
    const end = endOf(start, s.duration);
    const hit = rows.find((t) => !t.is_overbook && new Date(t.starts_at) < new Date(end) && new Date(t.ends_at) > new Date(start));
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    const twin = placed.find((p) => p.start < b && p.end > a);
    if (hit) conflicts.push({ key: s.key, who: `${fullName(hit.patient)} a las ${fmtTime(hit.starts_at)}` });
    else if (twin && !s.overbook) conflicts.push({ key: s.key, who: `otra sesión nueva (${twin.who}) a las ${twin.time}` });
    if (!s.overbook) placed.push({ start: a, end: b, who: s.label ?? "del mismo paciente", time: s.time });
  }
  const taken = rows.map((t) => ({
    id: t.id,
    date: format(toAR(t.starts_at), "yyyy-MM-dd"),
    time: fmtTime(t.starts_at),
    duration: (new Date(t.ends_at).getTime() - new Date(t.starts_at).getTime()) / 60000,
    who: fullName(t.patient),
  }));
  return { conflicts, taken, over: await overLimit(slots) };
}

// Por tratamiento: si se quieren agendar más sesiones de las que quedan, cuáles no entran
async function overLimit(slots: Slot[]): Promise<OverLimit[]> {
  const { supabase } = await getSession();
  const ids = [...new Set(slots.map((s) => s.treatment_id).filter(Boolean))] as string[];
  const out: OverLimit[] = [];
  for (const id of ids) {
    const left = await treatmentRemaining(id);
    const mine = slots.filter((s) => s.treatment_id === id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (left === null || mine.length <= left) continue;
    const { data } = await supabase.from("treatments").select("practice_name, patient:patients(first_name, last_name)").eq("id", id).single();
    const tr = data as unknown as { practice_name: string; patient: { first_name: string; last_name: string } | null } | null;
    out.push({ treatmentId: id, who: `${fullName(tr?.patient)} · ${tr?.practice_name ?? ""}`, left, keys: mine.slice(left).map((s) => s.key) });
  }
  return out;
}

// Crea todos los turnos juntos: si alguno falla, no se crea ninguno
export async function createSlots(professionalId: string, slots: Slot[], asSeries: boolean): Promise<ActionResult> {
  const { supabase, org, myProfessionals } = await getSession();
  if (!myProfessionals.some((p) => p.id === professionalId)) return { ok: false, error: "No podés dar turnos en la agenda de ese profesional." };
  if (slots.length === 0 || slots.length > MAX_SLOTS) return { ok: false, error: `Se pueden agendar hasta ${MAX_SLOTS} sesiones por vez.` };

  const { min, max } = await dateBounds();
  if (slots.some((s) => s.date < min || s.date > max)) return { ok: false, error: `Las fechas tienen que estar entre ${fmtDate(min)} y ${fmtDate(max)}.` };

  // Control de sesiones de cada tratamiento
  const perTreatment = new Map<string, number>();
  for (const s of slots) if (s.treatment_id) perTreatment.set(s.treatment_id, (perTreatment.get(s.treatment_id) ?? 0) + 1);
  const exceeded: string[] = [];
  for (const [id, n] of perTreatment) {
    const left = await treatmentRemaining(id);
    if (left !== null && n > left) {
      const { data } = await supabase.from("treatments").select("practice_name, patient:patients(first_name, last_name)").eq("id", id).single();
      const tr = data as unknown as { practice_name: string; patient: { first_name: string; last_name: string } | null } | null;
      exceeded.push(`${fullName(tr?.patient)} · ${tr?.practice_name}: le quedan ${left} sesiones y querés agendar ${n}.`);
    }
  }
  if (exceeded.length) return { ok: false, error: exceeded.join("\n") };

  const series_id = asSeries ? crypto.randomUUID() : null;
  const rows = slots.map((s) => {
    const start = arToISO(s.date, s.time);
    return {
      organization_id: org.id,
      patient_id: s.patient_id,
      professional_id: professionalId,
      treatment_id: s.treatment_id,
      starts_at: start,
      ends_at: endOf(start, s.duration),
      is_overbook: !!s.overbook || !!s.conflict,
      in_conflict: !!s.conflict,
      series_id,
    };
  });
  const { error } = await supabase.from("appointments").insert(rows);
  if (error) return { ok: false, error: error.code === "23P01" ? "Alguna fecha se ocupó mientras tanto. Revisá los choques y volvé a confirmar." : error.message };
  revalidatePath("/agenda");
  revalidatePath("/");
  return { ok: true, message: `Se agendaron ${rows.length} sesiones.` };
}

// N-ésimo día de la semana del mes: el 2° martes de marzo pasa al 2° martes de abril
export async function monthCopy(professionalId: string, fromMonth: string, toMonth: string): Promise<{ slots: Slot[]; skipped: string[] }> {
  const { supabase } = await getSession();
  const start = parseISO(`${fromMonth}-01`);
  const next = format(addDays(parseISO(`${fromMonth}-28`), 7), "yyyy-MM-01");
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, patient_id, treatment_id, is_overbook, in_conflict, patient:patients(first_name, last_name)")
    .eq("professional_id", professionalId)
    .neq("status", "cancelado")
    .gte("starts_at", arToISO(format(start, "yyyy-MM-dd"), "00:00"))
    .lt("starts_at", arToISO(next, "00:00"))
    .order("starts_at");
  const rows = (data ?? []) as unknown as { id: string; starts_at: string; ends_at: string; patient_id: string; treatment_id: string | null; is_overbook: boolean; in_conflict: boolean; patient: { first_name: string; last_name: string } | null }[];

  const firstOfTarget = parseISO(`${toMonth}-01`);
  const slots: Slot[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const s = toAR(r.starts_at);
    const nth = Math.floor((s.getDate() - 1) / 7);
    const offset = (getDay(s) - getDay(firstOfTarget) + 7) % 7;
    const day = addDays(firstOfTarget, offset + nth * 7);
    const date = format(day, "yyyy-MM-dd");
    if (!date.startsWith(toMonth)) {
      skipped.push(`${fmtDate(r.starts_at, "EEEE dd/MM")} ${fullName(r.patient)}`);
      continue;
    }
    slots.push({
      key: r.id,
      date,
      time: format(s, "HH:mm"),
      duration: (new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 60000,
      patient_id: r.patient_id,
      treatment_id: r.treatment_id,
      label: fullName(r.patient),
      overbook: r.is_overbook && !r.in_conflict,
    });
  }
  return { slots, skipped };
}

// Turnos de la serie que todavía no pasaron, desde este en adelante
async function following(id: string) {
  const { supabase } = await getSession();
  const { data: a } = await supabase.from("appointments").select("series_id, starts_at").eq("id", id).single();
  if (!a?.series_id) return [];
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at")
    .eq("series_id", a.series_id)
    .eq("status", "confirmado")
    .gte("starts_at", a.starts_at)
    .order("starts_at");
  return data ?? [];
}

export async function seriesFollowing(id: string): Promise<number> {
  return (await following(id)).length;
}

export async function deleteSeriesFrom(id: string): Promise<ActionResult> {
  const { supabase } = await getSession();
  const list = await following(id);
  const { error } = await supabase.from("appointments").delete().in("id", list.map((x) => x.id));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agenda");
  return { ok: true, message: `Se borraron ${list.length} turnos.` };
}

// Cambia la hora de este turno y de los siguientes del mismo día de la semana
export async function moveSeriesFrom(id: string, time: string): Promise<ActionResult> {
  const { supabase, org } = await getSession();
  const { data: a } = await supabase.from("appointments").select("starts_at, professional_id").eq("id", id).single();
  if (!a) return { ok: false, error: "Turno no encontrado" };
  const dow = getDay(toAR(a.starts_at));
  const list = (await following(id)).filter((x) => getDay(toAR(x.starts_at)) === dow);
  const moved = list.map((x) => {
    const date = format(toAR(x.starts_at), "yyyy-MM-dd");
    const minutes = (new Date(x.ends_at).getTime() - new Date(x.starts_at).getTime()) / 60000;
    const start = arToISO(date, time);
    return { id: x.id, date, starts_at: start, ends_at: endOf(start, minutes), minutes };
  });

  // Antes de tocar nada, ver que el nuevo horario esté libre en todas las fechas
  const { conflicts: others } = await checkSlots(
    a.professional_id,
    moved.map((m) => ({ key: m.id, date: m.date, time, duration: m.minutes, patient_id: "", treatment_id: null })),
  );
  const ownIds = new Set(list.map((x) => x.id));
  const { data: taken } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at")
    .eq("organization_id", org.id)
    .eq("professional_id", a.professional_id)
    .neq("status", "cancelado")
    .eq("is_overbook", false)
    .gte("starts_at", moved[0]?.starts_at ?? a.starts_at)
    .lte("starts_at", moved[moved.length - 1]?.ends_at ?? a.starts_at);
  const real = others.filter((c) => {
    const m = moved.find((x) => x.id === c.key)!;
    return (taken ?? []).some((t) => !ownIds.has(t.id) && t.starts_at < m.ends_at && t.ends_at > m.starts_at);
  });
  if (real.length) {
    const m = moved.find((x) => x.id === real[0].key)!;
    return { ok: false, error: `A esa hora ya hay turno el ${fmtDate(m.date, "EEEE dd/MM")}: ${real[0].who}. No se cambió nada.` };
  }

  for (const m of moved) {
    const { error } = await supabase.from("appointments").update({ starts_at: m.starts_at, ends_at: m.ends_at }).eq("id", m.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/agenda");
  return { ok: true, message: `Se cambiaron ${moved.length} turnos.` };
}
