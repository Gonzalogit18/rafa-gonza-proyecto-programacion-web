"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addDays, endOfMonth, format, getDay, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Copy, Download, FileText, MessageSquare, Plus, Repeat, Trash2, Undo2, X } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Modal } from "@/components/modal";
import { MoreMenu } from "@/components/more-menu";
import { PatientPicker } from "@/components/patient-picker";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { CLINICAL_KIND_LABEL, cap, fmtDate, fmtTime, fullName, toAR } from "@/lib/format";
import type { Appointment, AppointmentStatus, Patient, Professional, Treatment } from "@/lib/types";
import { type AppointmentSnapshot, addClinicalFromAppointment, createAppointments, deleteAppointment, keepAsOverbook, moveAppointment, restoreAppointment, setOverbook, updateAppointment } from "./actions";
import { CopyMonthModal, SeriesModal } from "./series-modal";
import { deleteSeriesFrom, moveSeriesFrom, seriesFollowing } from "./series-actions";
import { OVERBOOK_BLOCK, STATUS_ORDER, STATUS_STYLE } from "./status";

export type View = "dia" | "semana" | "mes";
const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_PX = 60;
const CONFLICT_BLOCK = "border-rose-300 bg-rose-100 text-rose-800";
const NOTE_CHIPS = ["Avisó que no viene", "No avisó", "Reprogramar", "Faltas repetidas"];

type Draft = { date: string; time: string };
type Remember = (a: Appointment, label: string) => void;
type UndoItem = { label: string; snap: AppointmentSnapshot };
const UNDO_KEY = "medapp-agenda-deshacer";

const snapshot = (a: Appointment): AppointmentSnapshot => ({
  id: a.id, patient_id: a.patient_id, professional_id: a.professional_id, treatment_id: a.treatment_id, package_id: a.package_id,
  session_number: a.session_number, series_id: a.series_id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status,
  is_overbook: a.is_overbook, in_conflict: a.in_conflict, notes: a.notes,
});

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const plusMinutes = (time: string, minutes: number) => {
  const t = Math.min(toMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

type Props = {
  view: View;
  explicitView: boolean;
  anchor: string;
  professional: Professional;
  professionals: Professional[];
  isOwnOnly: boolean;
  rangeStart: string;
  today: string;
  prev: string;
  next: string;
  bounds: { min: string; max: string };
  appointments: Appointment[];
  patients: Patient[];
  treatments: Treatment[];
  canWriteClinical: boolean;
  clinicalByAppointment: Record<string, string[]>;
};

export function AgendaView(props: Props) {
  const { view, anchor, professional, rangeStart, today, prev, next, appointments } = props;
  const router = useRouter();
  const { ask } = useDialog();
  // Desde Inicio, "Nuevo turno" llega con ?nuevo=1 y abre el formulario
  const params = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(() =>
    params.get("nuevo") === "1" ? { date: view === "semana" || view === "mes" ? today : anchor, time: "09:00" } : null,
  );
  const [batch, setBatch] = useState<"serie" | "mes" | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Deshacer: los últimos cambios de turnos quedan guardados mientras la pestaña esté abierta
  const [undo, setUndo] = useState<UndoItem[]>([]);
  useEffect(() => {
    let saved: UndoItem[] = [];
    try {
      saved = JSON.parse(sessionStorage.getItem(UNDO_KEY) ?? "[]");
    } catch {}
    // Se lee después de montar para que el servidor y el navegador dibujen lo mismo
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved.length) setUndo(saved);
  }, []);
  const saveUndo = (list: UndoItem[]) => {
    setUndo(list);
    try {
      sessionStorage.setItem(UNDO_KEY, JSON.stringify(list));
    } catch {}
  };
  const remember: Remember = (a, label) => saveUndo([...undo, { label: `${label} · ${fullName(a.patient)}`, snap: snapshot(a) }].slice(-10));
  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    start(async () => {
      const r = await restoreAppointment(last.snap);
      if (r.ok) saveUndo(undo.slice(0, -1));
      else setError(r.error ?? "No se pudo deshacer");
    });
  };

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const k = format(toAR(a.starts_at), "yyyy-MM-dd");
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [appointments]);

  const anchorDate = parseISO(anchor);
  const title =
    view === "dia"
      ? cap(format(anchorDate, "EEEE d MMM", { locale: es }))
      : view === "semana"
        ? `${format(parseISO(rangeStart), "d MMM", { locale: es })} – ${format(addDays(parseISO(rangeStart), 6), "d MMM yyyy", { locale: es })}`
        : cap(format(anchorDate, "MMMM yyyy", { locale: es }));

  const href = (o: { fecha?: string; vista?: View; prof?: string }) =>
    `/agenda?vista=${o.vista ?? view}&fecha=${o.fecha ?? anchor}&prof=${o.prof ?? professional.id}`;


  // En el celular la semana no entra: arranca en la vista de día
  useEffect(() => {
    if (!props.explicitView && window.innerWidth < 640) router.replace(href({ vista: "dia" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = async (id: string, date: string, time: string) => {
    const a = appointments.find((x) => x.id === id);
    if (!a || !(await ask(`¿Mover el turno de ${fullName(a.patient)} al ${fmtDate(date, "EEEE dd/MM")} a las ${time}?`, "Mover"))) return;
    start(async () => {
      const r = await moveAppointment(id, date, time);
      if (!r.ok) setError(r.error);
      else remember(a, "Turno movido");
    });
  };

  const days = view === "dia" ? [anchor] : Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(rangeStart), i), "yyyy-MM-dd"));

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Encabezado: flechas y título a la izquierda (no se mueven al cambiar de mes), lo de todos los días a la derecha */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-3 xl:flex-nowrap">
        <div className="flex w-full min-w-0 items-center gap-3 xl:w-auto xl:flex-1">
          <div className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-white">
            <Link href={href({ fecha: prev })} className="p-2 text-slate-500 hover:text-slate-900" aria-label="Anterior"><ChevronLeft size={18} /></Link>
            <Link href={href({ fecha: today })} className="px-2 text-sm font-medium text-slate-700">Hoy</Link>
            <Link href={href({ fecha: next })} className="p-2 text-slate-500 hover:text-slate-900" aria-label="Siguiente"><ChevronRight size={18} /></Link>
          </div>
          <h1 title={title} className="truncate whitespace-nowrap text-lg font-semibold tracking-[-0.015em] sm:text-[22px] xl:text-xl 2xl:text-[26px]">{title}</h1>
        </div>
        <div className="flex w-full items-center gap-2 sm:justify-end xl:w-auto xl:shrink-0">
          {props.isOwnOnly ? (
            <span className="text-sm font-medium text-slate-600">{professional.full_name}</span>
          ) : (
            <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
              <Select value={professional.id} onChange={(e) => router.push(href({ prof: e.target.value }))} aria-label="Profesional">
                {props.professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </div>
          )}
          <div className="grid shrink-0 grid-cols-3 rounded-[10px] bg-[#EDECE7] p-[3px] text-sm">
            {([["dia", "Día", "Día"], ["semana", "Semana", "Sem"], ["mes", "Mes", "Mes"]] as const).map(([v, label, short]) => (
              <Link key={v} href={href({ vista: v })} className={cn("flex min-h-[38px] items-center justify-center rounded-[7px] border px-2 text-center font-medium sm:px-3", view === v ? "border-slate-300 bg-white text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </div>
          <MoreMenu
            compact
            items={[
              { label: "Agendar varias sesiones", icon: <Repeat size={16} />, onClick: () => setBatch("serie") },
              { label: "Copiar turnos de un mes a otro", icon: <Copy size={16} />, onClick: () => setBatch("mes") },
              { label: "Descargar el mes en Excel", icon: <Download size={16} />, download: true, href: `/agenda/exportar?prof=${professional.id}&desde=${format(startOfMonth(anchorDate), "yyyy-MM-dd")}&hasta=${format(endOfMonth(anchorDate), "yyyy-MM-dd")}` },
            ]}
          />
          <div className="hidden sm:block">
            <Button onClick={() => setDraft({ date: view === "semana" || view === "mes" ? today : anchor, time: "09:00" })}>
              <Plus size={16} /> Nuevo turno
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex justify-between gap-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error} <button onClick={() => setError(null)} aria-label="Cerrar">✕</button>
        </div>
      )}

      <div className={cn(pending && "opacity-70 transition")}>
        {view === "mes" ? (
          <MonthGrid rangeStart={rangeStart} anchor={anchorDate} today={today} byDay={byDay} hrefDay={(d) => href({ fecha: d, vista: "dia" })} />
        ) : (
          <TimeGrid
            days={days}
            today={today}
            byDay={byDay}
            professional={professional}
            clinical={props.clinicalByAppointment}
            onSlot={(date, time) => setDraft({ date, time })}
            onOpen={setSelected}
            onDrop={onDrop}
          />
        )}
        <Legend />
      </div>

      {draft && <NewAppointmentModal draft={draft} {...props} onClose={() => setDraft(null)} />}
      {batch === "serie" && <SeriesModal professional={professional} bounds={props.bounds} today={today} patients={props.patients} treatments={props.treatments} onClose={() => setBatch(null)} />}
      {batch === "mes" && <CopyMonthModal professional={professional} bounds={props.bounds} anchor={anchor} onClose={() => setBatch(null)} />}
      {selected && (
        <AppointmentModal
          key={selected.id}
          appt={appointments.find((a) => a.id === selected.id) ?? selected}
          treatments={props.treatments.filter((t) => t.patient_id === selected.patient_id)}
          canWriteClinical={props.canWriteClinical}
          clinical={props.clinicalByAppointment[selected.id] ?? []}
          bounds={props.bounds}
          remember={remember}
          onClose={() => setSelected(null)}
        />
      )}

      {/* En el celular, como en Google Calendar: botón redondo para un turno nuevo */}
      <button
        onClick={() => setDraft({ date: view === "semana" || view === "mes" ? today : anchor, time: "09:00" })}
        aria-label="Nuevo turno"
        className="fixed bottom-5 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-lg active:scale-95 sm:hidden print:hidden"
      >
        <Plus size={26} />
      </button>

      {undo.length > 0 && (
        <div className="fixed inset-x-4 bottom-24 z-40 sm:bottom-4 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg print:hidden">
          <span className="min-w-0 flex-1 truncate">{undo[undo.length - 1].label}</span>
          <button disabled={pending} onClick={undoLast} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-teal-200 hover:bg-white/10">
            <Undo2 size={15} /> Deshacer
          </button>
          <button onClick={() => saveUndo([])} aria-label="Cerrar" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Día / semana
function TimeGrid({
  days,
  today,
  byDay,
  professional,
  clinical,
  onSlot,
  onOpen,
  onDrop,
}: {
  days: string[];
  today: string;
  byDay: Map<string, Appointment[]>;
  professional: Professional;
  clinical: Record<string, string[]>;
  onSlot: (date: string, time: string) => void;
  onOpen: (a: Appointment) => void;
  onDrop: (id: string, date: string, time: string) => void;
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const [over, setOver] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Arranca mostrando desde las 7
    if (scroller.current) scroller.current.scrollTop = (7 - START_HOUR) * HOUR_PX;
  }, []);

  const offHours = (day: string, time: string) => {
    const dow = getDay(parseISO(day));
    return !professional.work_days.includes(dow) || time < professional.work_start.slice(0, 5) || time >= professional.work_end.slice(0, 5);
  };
  const dense = days.length > 1;
  const cols = `var(--hours-col) repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <Card className="overflow-hidden [--hours-col:36px] sm:[--hours-col:48px]">
      <div className="overflow-x-auto">
        <div className={dense ? "md:min-w-[720px]" : ""}>
          <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
            <div />
            {days.map((d) => (
              <div key={d} className={cn("py-1.5 text-center sm:py-2.5", d === today && "bg-teal-50")}>
                <p className="text-[11px] capitalize text-slate-500 sm:text-xs">
                  <span className={dense ? "sm:hidden" : "hidden"}>{format(parseISO(d), "EEEEEE", { locale: es })}</span>
                  <span className={dense ? "hidden sm:inline" : ""}>{format(parseISO(d), "EEEE", { locale: es })}</span>
                </p>
                <p className={cn("mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold sm:h-8 sm:w-8 sm:text-lg", d === today && "bg-teal-600 text-white")}>
                  {format(parseISO(d), "d")}
                </p>
              </div>
            ))}
          </div>
          <div ref={scroller} className="lg:max-h-[68vh] lg:overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: cols }}>
              <div>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_PX }} className="pr-1 pt-1 text-right text-[10px] text-slate-400 sm:pr-2 sm:text-xs">
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
              {days.map((d) => (
                <div key={d} className={cn("relative border-l border-slate-100", d === today && "bg-teal-50/30")}>
                  {hours.flatMap((h) =>
                    ["00", "30"].map((m) => {
                      const time = `${String(h).padStart(2, "0")}:${m}`;
                      const key = `${d}T${time}`;
                      return (
                        <div
                          key={key}
                          style={{ height: HOUR_PX / 2 }}
                          className={cn(
                            "cursor-pointer border-slate-100 transition hover:bg-teal-50",
                            m === "00" ? "border-t" : "border-t border-dashed border-slate-50",
                            offHours(d, time) && "bg-slate-50",
                            over === key && "bg-teal-100",
                          )}
                          onClick={() => onSlot(d, time)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setOver(key);
                          }}
                          onDragLeave={() => setOver(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setOver(null);
                            onDrop(e.dataTransfer.getData("text/plain"), d, time);
                          }}
                        />
                      );
                    }),
                  )}
                  {layoutDay(byDay.get(d) ?? []).map(({ a, col, cols: n }) => {
                    const s = toAR(a.starts_at);
                    const minutes = (s.getHours() - START_HOUR) * 60 + s.getMinutes();
                    const dur = (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000;
                    if (minutes < 0) return null;
                    return (
                      <button
                        key={a.id}
                        draggable={a.status !== "atendido"}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)}
                        onClick={() => onOpen(a)}
                        style={{
                          top: (minutes / 60) * HOUR_PX + 1,
                          height: Math.max(24, (dur / 60) * HOUR_PX - 2),
                          left: `calc(${(col / n) * 100}% + 2px)`,
                          width: `calc(${100 / n}% - 4px)`,
                        }}
                        className={cn(
                          "absolute overflow-hidden rounded-md border py-0.5 text-left transition hover:z-10 hover:brightness-[0.97]",
                          dense ? "px-1 text-[10px] leading-tight sm:px-1.5 sm:text-xs sm:leading-normal" : "px-1.5 text-xs",
                          a.in_conflict ? CONFLICT_BLOCK : a.is_overbook && a.status === "confirmado" ? OVERBOOK_BLOCK : STATUS_STYLE[a.status].block,
                        )}
                      >
                        <p className="flex items-center gap-1 truncate font-medium">
                          {dense ? <><span className="sm:hidden">{a.patient?.last_name}</span><span className="hidden sm:inline">{fullName(a.patient)}</span></> : fullName(a.patient)}
                          {a.notes && <MessageSquare size={11} className="shrink-0 opacity-70" />}
                          {clinical[a.id] && <FileText size={11} className="shrink-0 opacity-70" />}
                        </p>
                        <p className={cn("truncate opacity-80", dense && "hidden sm:block")}>
                          {fmtTime(a.starts_at)} – {fmtTime(a.ends_at)} · {a.in_conflict ? "Choque" : a.is_overbook ? (a.status === "confirmado" ? "Sobreturno" : `Sobreturno · ${STATUS_STYLE[a.status].label}`) : STATUS_STYLE[a.status].label}
                          {a.treatment && ` · ${a.treatment.practice_name}`}
                        </p>
                        {a.notes && <p className="truncate italic opacity-80">{a.notes}</p>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Turnos simultáneos (sobreturnos) lado a lado
function layoutDay(list: Appointment[]) {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const out: { a: Appointment; col: number; cols: number }[] = [];
  let cluster: { a: Appointment; col: number }[] = [];
  let clusterEnd = "";
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => out.push({ ...c, cols }));
    cluster = [];
  };
  for (const a of sorted) {
    if (cluster.length && a.starts_at >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.a.ends_at > a.starts_at).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ a, col });
    clusterEnd = cluster.length === 1 || a.ends_at > clusterEnd ? a.ends_at : clusterEnd;
  }
  if (cluster.length) flush();
  return out;
}

// ---------------------------------------------------------------- Mes
function MonthGrid({ rangeStart, anchor, today, byDay, hrefDay }: { rangeStart: string; anchor: Date; today: string; byDay: Map<string, Appointment[]>; hrefDay: (d: string) => string }) {
  // Siempre 6 semanas y celdas de alto fijo: la grilla no cambia de tamaño al pasar de mes.
  const days: string[] = [];
  for (let d = parseISO(rangeStart); days.length < 42; d = addDays(d, 1)) days.push(format(d, "yyyy-MM-dd"));
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase text-slate-500">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = (byDay.get(d) ?? []).filter((a) => a.status !== "cancelado");
          return (
            <Link key={d} href={hrefDay(d)} className={cn("h-14 min-w-0 overflow-hidden border-b border-r border-slate-100 p-1 transition hover:bg-teal-50 sm:h-[124px] sm:p-2", !isSameMonth(parseISO(d), anchor) && "bg-slate-50/60 text-slate-400")}>
              <div className="flex items-center justify-between">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium", d === today && "bg-teal-600 text-white")}>{format(parseISO(d), "d")}</span>
                {list.length > 0 && <span className="text-xs font-semibold text-slate-500">{list.length}</span>}
              </div>
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map((a) => (
                  <p key={a.id} className={cn("truncate rounded border px-1 text-[11px]", a.in_conflict ? CONFLICT_BLOCK : STATUS_STYLE[a.status].block)}>
                    {fmtTime(a.starts_at)} {a.patient?.last_name}
                  </p>
                ))}
                {list.length > 3 && <p className="text-[11px] text-slate-400">+{list.length - 3}</p>}
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-600">
      {STATUS_ORDER.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("h-3.5 w-3.5 rounded-sm border", STATUS_STYLE[s].block)} /> {STATUS_STYLE[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><span className={cn("h-3.5 w-3.5 rounded-sm border", CONFLICT_BLOCK)} /> Choque</span>
      <span className="flex items-center gap-1.5"><span className={cn("h-3.5 w-3.5 rounded-sm border", OVERBOOK_BLOCK)} /> Sobreturno</span>
      <span className="flex items-center gap-1.5"><MessageSquare size={12} /> Con nota</span>
      <span className="flex items-center gap-1.5"><FileText size={12} /> Con registro clínico</span>
    </div>
  );
}

// ---------------------------------------------------------------- Nuevo turno
function NewAppointmentModal({ draft, patients, professional, treatments, bounds, onClose }: Props & { draft: Draft; onClose: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [date, setDate] = useState(draft.date);
  const [time, setTime] = useState(draft.time);
  const [end, setEnd] = useState(plusMinutes(draft.time, professional.slot_minutes));
  const [overbook, setOverbook] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask } = useDialog();

  const patientTreatments = treatments.filter((t) => t.patient_id === patientId && (!t.period_to || t.period_to >= date));
  const duration = toMinutes(end) - toMinutes(time);
  const validTimes = duration > 0;

  // Como en un calendario: al mover el inicio, el turno mantiene su duración
  const onStart = (value: string) => {
    if (value && validTimes) setEnd(plusMinutes(value, duration));
    setTime(value);
  };

  const onPatient = (id: string) => {
    setPatientId(id);
    const own = treatments.filter((t) => t.patient_id === id && (!t.period_to || t.period_to >= date));
    setTreatmentId(own.length === 1 ? own[0].id : "");
  };

  const submit = async () => {
    const who = fullName(patients.find((p) => p.id === patientId));
    if (!(await ask(`¿Agendar a ${who} el ${fmtDate(date, "EEEE dd/MM")} de ${time} a ${end}?`, "Agendar"))) return;
    start(async () => {
      setError(null);
      const r = await createAppointments({
        patient_id: patientId,
        professional_id: professional.id,
        treatment_id: treatmentId || null,
        date,
        time,
        duration,
        is_overbook: overbook,
        notes,
      });
      if (r.ok) onClose();
      else setError(r.error);
    });
  };

  return (
    <Modal open onClose={onClose} title={`Nuevo turno · ${professional.full_name}`} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paciente">
            <PatientPicker patients={patients} value={patientId} onChange={onPatient} />
          </Field>
          <Field label="Tratamiento">
            <Select value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)} disabled={!patientId}>
              <option value="">Sin tratamiento</option>
              {patientTreatments.map((t) => <option key={t.id} value={t.id}>{t.practice_name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Fecha" className="col-span-2 sm:col-span-1"><Input type="date" min={bounds.min} max={bounds.max} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Hora de inicio"><Input type="time" step={300} value={time} onChange={(e) => onStart(e.target.value)} /></Field>
          <Field label="Hora de fin"><Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {!validTimes && <p className="text-sm text-rose-600">La hora de fin tiene que ser después de la de inicio.</p>}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} className="h-4 w-4 accent-fuchsia-600" />
          Sobreturno
        </label>
        <Field label="Nota"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={!patientId || !validTimes || pending}>
            {pending ? "Guardando…" : "Agendar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Cambios de este turno en adelante
function SeriesActions({ appt, onDone, onError }: { appt: Appointment; onDone: () => void; onError: (e: string) => void }) {
  const s = toAR(appt.starts_at);
  const [count, setCount] = useState<number | null>(null);
  const [time, setTime] = useState(format(s, "HH:mm"));
  const [pending, start] = useTransition();
  const { ask } = useDialog();
  useEffect(() => {
    seriesFollowing(appt.id).then(setCount);
  }, [appt.id]);
  const weekday = format(s, "EEEE", { locale: es });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) onDone();
      else onError(r.error ?? "Error");
    });
  if (!count) return null;
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Repeat size={15} /> Sesiones en serie</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Horario de los ${weekday} siguientes`}><Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} className="bg-white" /></Field>
        <Button
          variant="secondary"
          disabled={pending || time === format(s, "HH:mm")}
          onClick={async () => (await ask(`¿Cambiar a las ${time} este turno y todos los ${weekday} siguientes de la serie?`)) && run(() => moveSeriesFrom(appt.id, time))}
        >
          Cambiar horario
        </Button>
      </div>
      <button
        disabled={pending}
        onClick={async () => (await ask(`Se van a borrar ${count} turnos: este y los siguientes de la serie. Los atendidos y ausentes no se tocan. ¿Seguir?`, "Borrar")) && run(() => deleteSeriesFrom(appt.id))}
        className="mt-3 flex items-center gap-1 text-sm text-rose-600 hover:underline"
      >
        <Trash2 size={14} /> Borrar este y los siguientes, {count} turnos
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Cambiar el día o la hora de un turno
function MoveForm({ appt, onDone, onError, bounds, remember }: { appt: Appointment; onDone: () => void; onError: (e: string) => void; bounds: Props["bounds"]; remember: Remember }) {
  const s = toAR(appt.starts_at);
  const e = toAR(appt.ends_at);
  const [date, setDate] = useState(format(s, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(s, "HH:mm"));
  const [end, setEnd] = useState(format(e, "HH:mm"));
  const [pending, start] = useTransition();
  const { ask } = useDialog();
  const changed = date !== format(s, "yyyy-MM-dd") || time !== format(s, "HH:mm") || end !== format(e, "HH:mm");
  const valid = !!date && !!time && !!end && toMinutes(end) > toMinutes(time);

  // Al cambiar el inicio, el fin se corre igual para mantener la duración
  const changeTime = (v: string) => {
    if (v && time && end) setEnd(plusMinutes(v, toMinutes(end) - toMinutes(time)));
    setTime(v);
  };

  const move = async () => {
    if (!(await ask(`¿Cambiar el turno de ${fullName(appt.patient)} al ${fmtDate(date, "EEEE dd/MM")} de ${time} a ${end}?`, "Cambiar"))) return;
    start(async () => {
      const r = await moveAppointment(appt.id, date, time, end);
      if (r.ok) {
        remember(appt, "Turno cambiado");
        onDone();
      } else onError(r.error);
    });
  };

  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-slate-600">Cambiar día u horario</p>
      <div className="grid grid-cols-2 items-end gap-2 sm:flex">
        <Field label="Fecha" className="col-span-2 sm:flex-1"><Input type="date" min={bounds.min} max={bounds.max} value={date} onChange={(ev) => setDate(ev.target.value)} /></Field>
        <Field label="Inicio" className="sm:w-28"><Input type="time" step={300} value={time} onChange={(ev) => changeTime(ev.target.value)} /></Field>
        <Field label="Fin" className="sm:w-28"><Input type="time" step={300} value={end} onChange={(ev) => setEnd(ev.target.value)} /></Field>
        <Button variant="secondary" className="col-span-2" disabled={pending || !changed || !valid} onClick={move}>Guardar cambio</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Detalle del turno
function AppointmentModal({
  appt,
  treatments,
  canWriteClinical,
  clinical,
  bounds,
  remember,
  onClose,
}: {
  appt: Appointment;
  treatments: Treatment[];
  canWriteClinical: boolean;
  clinical: string[];
  bounds: Props["bounds"];
  remember: Remember;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [entryKind, setEntryKind] = useState("evolucion");
  const [entryTitle, setEntryTitle] = useState("");
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = toAR(appt.starts_at);
  const { ask } = useDialog();

  // undo: si se indica, el cambio queda en "Deshacer"
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string, close?: boolean, undo?: string) =>
    start(async () => {
      setError(null);
      setSaved(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Error");
      else {
        if (undo) remember(appt, undo);
        if (close) onClose();
        else if (ok) setSaved(ok);
      }
    });

  const changeStatus = async (st: AppointmentStatus) => {
    if (st === appt.status) return;
    if (await ask(`¿Cambiar el turno a "${STATUS_STYLE[st].label}"?`)) run(() => updateAppointment(appt.id, { status: st }), undefined, false, `Estado: ${STATUS_STYLE[st].label}`);
  };

  return (
    <Modal open onClose={onClose} title={cap(format(s, "EEEE d 'de' MMMM, HH:mm", { locale: es }))} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/pacientes/${appt.patient_id}`} className="text-xl font-semibold hover:text-teal-700">{fullName(appt.patient)}</Link>
            {appt.patient?.phone && <p className="text-sm text-slate-500">{appt.patient.phone}</p>}
          </div>
          {!appt.in_conflict && (
            <span className="flex items-center gap-2">
              {appt.is_overbook && <Badge className="bg-violet-100 text-violet-800">Sobreturno</Badge>}
              <Button variant="ghost" disabled={pending} onClick={() => run(() => setOverbook(appt.id, !appt.is_overbook), undefined, false, appt.is_overbook ? "Sobreturno quitado" : "Marcado como sobreturno")}>
                {appt.is_overbook ? "Quitar sobreturno" : "Marcar como sobreturno"}
              </Button>
            </span>
          )}
        </div>

        {appt.in_conflict && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
            <span>Este turno choca con otro. Dejalo como sobreturno o pasalo a un horario libre.</span>
            <Button variant="secondary" disabled={pending} onClick={() => run(() => keepAsOverbook(appt.id), undefined, false, "Dejado como sobreturno")}>Dejar como sobreturno</Button>
          </div>
        )}

        <div>
          <p className="mb-2 text-[13px] font-medium text-slate-600">Estado</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map((st) => (
              <button
                key={st}
                disabled={pending}
                onClick={() => changeStatus(st)}
                className={cn("rounded-full px-3 py-1 text-sm font-medium ring-1 transition", appt.status === st ? cn(STATUS_STYLE[st].badge, "ring-current") : "text-slate-500 ring-slate-200 hover:bg-slate-50")}
              >
                {STATUS_STYLE[st].label}
              </button>
            ))}
          </div>
        </div>

        {appt.status !== "atendido" && <MoveForm appt={appt} bounds={bounds} remember={remember} onDone={onClose} onError={setError} />}

        <div>
          <Field label="Tratamiento">
            <Select
              value={appt.treatment_id ?? ""}
              disabled={pending}
              onChange={async (e) => {
                const v = e.target.value;
                if (await ask("¿Cambiar el tratamiento de este turno?")) run(() => updateAppointment(appt.id, { treatment_id: v || null }), undefined, false, "Tratamiento cambiado");
              }}
            >
              <option value="">Sin tratamiento</option>
              {treatments.map((t) => <option key={t.id} value={t.id}>{t.practice_name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare size={15} /> Nota del turno</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {NOTE_CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => setNotes(notes ? `${notes}. ${c}` : c)} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                {c}
              </button>
            ))}
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="min-h-0 bg-white" />
          {notes !== (appt.notes ?? "") && (
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" disabled={pending} onClick={() => run(() => updateAppointment(appt.id, { notes: notes || null }), "Nota guardada")}>Guardar nota</Button>
            </div>
          )}
        </div>

        {canWriteClinical && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><FileText size={15} /> Historia clínica</p>
            {clinical.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm text-slate-600">
                {clinical.map((c, i) => <li key={i}>✓ {c}</li>)}
              </ul>
            )}
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select aria-label="Tipo" value={entryKind} onChange={(e) => setEntryKind(e.target.value)}>
                  {Object.entries(CLINICAL_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Input aria-label="Título" value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} />
              </div>
              <Textarea aria-label="Registro" value={entry} onChange={(e) => setEntry(e.target.value)} rows={3} />
              <div className="flex justify-end">
                <Button
                  disabled={pending || !entry.trim()}
                  onClick={() =>
                    run(async () => {
                      const r = await addClinicalFromAppointment(appt.id, entryKind, entryTitle, entry);
                      if (r.ok) {
                        setEntry("");
                        setEntryTitle("");
                      }
                      return r;
                    }, "Guardado en la historia clínica")
                  }
                >
                  Guardar en historia clínica
                </Button>
              </div>
            </div>
          </div>
        )}

        {appt.series_id && appt.status === "confirmado" && <SeriesActions appt={appt} onDone={onClose} onError={setError} />}

        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {saved && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{saved}</p>}

        <div className="flex justify-between border-t border-slate-100 pt-4">
          {appt.status !== "atendido" && appt.status !== "ausente" ? (
            <button
              disabled={pending}
              onClick={async () => (await ask("¿Borrar este turno?", "Borrar")) && run(() => deleteAppointment(appt.id), undefined, true, "Turno borrado")}
              className="flex items-center gap-1 text-sm text-slate-400 hover:text-rose-600"
            >
              <Trash2 size={14} /> Borrar turno
            </button>
          ) : <span />}
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}
