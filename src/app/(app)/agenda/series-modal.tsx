"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addDays, addWeeks, format, getDay, parseISO, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Modal } from "@/components/modal";
import { PatientPicker } from "@/components/patient-picker";
import { Button, Field, Input, Select, cn } from "@/components/ui";
import { cap, fullName } from "@/lib/format";
import type { Patient, Professional, Treatment } from "@/lib/types";
import { checkSlots, createSlots, monthCopy, treatmentRemaining, type Conflict, type OverLimit, type Slot, type Taken } from "./series-actions";
import { OVERBOOK_BLOCK } from "./status";

const WEEK = [
  { dow: 1, short: "Lun", long: "Lunes" },
  { dow: 2, short: "Mar", long: "Martes" },
  { dow: 3, short: "Mié", long: "Miércoles" },
  { dow: 4, short: "Jue", long: "Jueves" },
  { dow: 5, short: "Vie", long: "Viernes" },
  { dow: 6, short: "Sáb", long: "Sábado" },
  { dow: 0, short: "Dom", long: "Domingo" },
];
const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_PX = 48;

type Common = { professional: Professional; bounds: { min: string; max: string } };
type Agenda = { conflicts: Conflict[]; taken: Taken[]; over: OverLimit[] };
type DayTime = { start: string; end: string };

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const plusMinutes = (time: string, minutes: number) => {
  const t = Math.min(toMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

// Fechas del esquema: cada semana, los días elegidos, hasta completar el total
function generate(days: Map<number, DayTime>, from: string, total: number, base: Omit<Slot, "key" | "date" | "time" | "duration">, skip = new Set<string>()) {
  const out: Slot[] = [];
  for (let d = parseISO(from); out.length < total && out.length < 400; d = addDays(d, 1)) {
    const time = days.get(getDay(d));
    const date = format(d, "yyyy-MM-dd");
    if (time && !skip.has(date)) out.push({ ...base, key: crypto.randomUUID(), date, time: time.start, duration: toMinutes(time.end) - toMinutes(time.start) });
  }
  return out;
}

// ---------------------------------------------------------------- Agendar sesiones con periodicidad
export function SeriesModal({ professional, bounds, today, patients, treatments, onClose }: Common & { today: string; patients: Patient[]; treatments: Treatment[]; onClose: () => void }) {
  const { ask } = useDialog();
  const [step, setStep] = useState<"form" | "preview">("form");
  const [patientId, setPatientId] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const [days, setDays] = useState<Map<number, DayTime>>(new Map());
  const [from, setFrom] = useState(today);
  const [total, setTotal] = useState(8);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ conflicts: [], taken: [], over: [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const own = treatments.filter((t) => t.patient_id === patientId && (!t.period_to || t.period_to >= today));
  const base = { patient_id: patientId, treatment_id: treatmentId || null };

  const pickTreatment = (id: string) => {
    setTreatmentId(id);
    setLeft(null);
    if (id)
      start(async () => {
        const n = await treatmentRemaining(id);
        setLeft(n);
        if (n) setTotal(n);
      });
  };
  const pickPatient = (id: string) => {
    setPatientId(id);
    const list = treatments.filter((t) => t.patient_id === id && (!t.period_to || t.period_to >= today));
    pickTreatment(list.length === 1 ? list[0].id : "");
  };
  const toggleDay = (dow: number) =>
    setDays((m) => {
      const n = new Map(m);
      if (n.has(dow)) n.delete(dow);
      else n.set(dow, [...m.values()].at(-1) ?? { start: "09:00", end: plusMinutes("09:00", professional.slot_minutes) });
      return n;
    });
  // Como en un calendario: al mover el inicio, la sesión mantiene su duración
  const setStart = (dow: number, start: string) =>
    setDays((m) => {
      const t = m.get(dow)!;
      const minutes = toMinutes(t.end) - toMinutes(t.start);
      return new Map(m).set(dow, { start, end: start && minutes > 0 ? plusMinutes(start, minutes) : t.end });
    });
  const setEnd = (dow: number, end: string) => setDays((m) => new Map(m).set(dow, { ...m.get(dow)!, end }));
  const refresh = (list: Slot[]) =>
    start(async () => {
      setSlots(list);
      setAgenda(await checkSlots(professional.id, list));
    });
  const toPreview = () => {
    setError(null);
    refresh(generate(days, from, total, base));
    setStep("preview");
  };
  // Saca las que chocan y agrega la misma cantidad de fechas al final del esquema
  const pushToEnd = () => {
    const bad = new Set(agenda.conflicts.filter((c) => !slots.find((s) => s.key === c.key)?.overbook).map((c) => c.key));
    const keep = slots.filter((s) => !bad.has(s.key));
    const last = [...keep].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? from;
    const used = new Set(slots.map((s) => s.date));
    const more = generate(days, format(addDays(parseISO(last), 1), "yyyy-MM-dd"), bad.size, base, used);
    refresh([...keep, ...more]);
  };

  const validTimes = [...days.values()].every((t) => t.start && t.end && toMinutes(t.end) > toMinutes(t.start));
  const canPreview = patientId && days.size > 0 && total > 0 && validTimes;
  const summary = days.size === 0 ? "Elegí los días" : days.size === 1 ? "1 vez por semana" : `${days.size} veces por semana`;

  return (
    <Modal open onClose={onClose} title={`Agendar sesiones · ${professional.full_name}`} size={step === "form" ? "xl" : "2xl"}>
      {step === "form" ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paciente"><PatientPicker patients={patients} value={patientId} onChange={pickPatient} /></Field>
            <Field label="Tratamiento">
              <Select value={treatmentId} onChange={(e) => pickTreatment(e.target.value)} disabled={!patientId}>
                <option value="">Sin tratamiento</option>
                {own.map((t) => <option key={t.id} value={t.id}>{t.practice_name}</option>)}
              </Select>
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">¿Qué días viene?</p>
              <p className="text-sm font-semibold text-teal-700">{summary}</p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {WEEK.map((d) => (
                <button
                  key={d.dow}
                  type="button"
                  onClick={() => toggleDay(d.dow)}
                  className={cn("rounded-xl py-3 text-sm font-semibold ring-1 transition", days.has(d.dow) ? "bg-teal-600 text-white ring-teal-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-teal-50")}
                >
                  {d.short}
                </button>
              ))}
            </div>
          </div>

          {days.size > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {WEEK.filter((d) => days.has(d.dow)).map((d) => (
                <div key={d.dow} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium">
                  {d.long}
                  <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                    <input
                      type="time"
                      aria-label={`Inicio del ${d.long}`}
                      value={days.get(d.dow)!.start}
                      onChange={(e) => setStart(d.dow, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm sm:flex-none"
                    />
                    a
                    <input
                      type="time"
                      aria-label={`Fin del ${d.long}`}
                      value={days.get(d.dow)!.end}
                      onChange={(e) => setEnd(d.dow, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm sm:flex-none"
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          {!validTimes && <p className="text-sm text-rose-600">La hora de fin tiene que ser después de la de inicio.</p>}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde"><Input type="date" min={bounds.min} max={bounds.max} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={left !== null ? `Sesiones, le quedan ${left}` : "Cantidad de sesiones"}>
              <Input type="number" inputMode="numeric" min={1} max={400} value={total || ""} onChange={(e) => setTotal(Number(e.target.value))} />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={toPreview} disabled={!canPreview || pending}>Ver en la agenda</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <OverLimitNotice over={agenda.over} slots={slots} onChange={refresh} />
          <SlotPreview slots={slots} agenda={agenda} pending={pending} bounds={bounds} newLabel={fullName(patients.find((p) => p.id === patientId))} onChange={refresh} onPushToEnd={pushToEnd} />
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap justify-between gap-2 border-t border-slate-100 bg-white px-6 py-3">
            {error && <p className="w-full whitespace-pre-line rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <Button variant="secondary" onClick={() => setStep("form")}><ArrowLeft size={15} /> Volver</Button>
            <ConfirmButton
              slots={slots}
              conflicts={agenda.conflicts}
              over={agenda.over}
              pending={pending}
              onConfirm={async () => {
                const who = fullName(patients.find((p) => p.id === patientId));
                if (!(await ask(`¿Agendar ${slots.length} sesiones de ${who}?`, "Agendar"))) return;
                start(async () => {
                  const r = await createSlots(professional.id, slots, true);
                  if (r.ok) onClose();
                  else setError(r.error);
                });
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Copiar un mes al siguiente
export function CopyMonthModal({ professional, bounds, anchor, onClose }: Common & { anchor: string; onClose: () => void }) {
  const { ask } = useDialog();
  const months = useMemo(() => {
    const first = parseISO(`${anchor.slice(0, 7)}-01`);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth() + i - 1, 1);
      return { id: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy", { locale: es }) };
    });
  }, [anchor]);
  const [source, setSource] = useState(months[1].id);
  const [target, setTarget] = useState(months[2].id);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ conflicts: [], taken: [], over: [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = (list: Slot[]) =>
    start(async () => {
      setSlots(list);
      setAgenda(await checkSlots(professional.id, list));
    });
  const load = () =>
    start(async () => {
      setError(null);
      const r = await monthCopy(professional.id, source, target);
      setSkipped(r.skipped);
      setSlots(r.slots);
      setAgenda(await checkSlots(professional.id, r.slots));
    });

  return (
    <Modal open onClose={onClose} title={`Copiar mes · ${professional.full_name}`} size={slots === null ? "xl" : "2xl"}>
      {slots === null ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Copiar los turnos de">
              <Select value={source} onChange={(e) => setSource(e.target.value)} className="capitalize">
                {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
            <Field label="Al mes de">
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="capitalize">
                {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-slate-500">Cada turno mantiene el día de la semana y la hora: el primer martes de {months.find((m) => m.id === source)?.label.split(" ")[0]} pasa al primer martes de {months.find((m) => m.id === target)?.label.split(" ")[0]}.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={load} disabled={pending || source === target}>Ver en la agenda</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <OverLimitNotice over={agenda.over} slots={slots} onChange={refresh} />
          <SlotPreview slots={slots} agenda={agenda} pending={pending} bounds={bounds} onChange={refresh} />
          {skipped.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Estos turnos no tienen fecha equivalente en el otro mes:</p>
              <p className="mt-1">{skipped.join(" · ")}</p>
            </div>
          )}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap justify-between gap-2 border-t border-slate-100 bg-white px-6 py-3">
            {error && <p className="w-full whitespace-pre-line rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <Button variant="secondary" onClick={() => setSlots(null)}><ArrowLeft size={15} /> Volver</Button>
            <ConfirmButton
              slots={slots}
              conflicts={agenda.conflicts}
              over={agenda.over}
              pending={pending}
              allowConflicts
              onConfirm={async () => {
                const clash = new Set(agenda.conflicts.map((c) => c.key));
                const list = slots.map((s) => ({ ...s, conflict: clash.has(s.key) && !s.overbook }));
                const open = list.filter((s) => s.conflict).length;
                if (!(await ask(`¿Agendar ${list.length} turnos?${open ? ` ${open} quedan en rojo en la agenda hasta que los resuelvas.` : ""}`, "Agendar"))) return;
                start(async () => {
                  const r = await createSlots(professional.id, list, false);
                  if (r.ok) onClose();
                  else setError(r.error);
                });
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

// Si a un tratamiento no le alcanzan las sesiones, se elige qué hacer con las fechas que sobran;
// el resto se agenda igual
function OverLimitNotice({ over, slots, onChange }: { over: OverLimit[]; slots: Slot[]; onChange: (list: Slot[]) => void }) {
  if (over.length === 0) return null;
  return (
    <div className="space-y-2">
      {over.map((o) => {
        const keys = new Set(o.keys);
        return (
          <div key={o.treatmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              <b>{o.who}</b>: {o.left === 0 ? "no le quedan sesiones" : `le ${o.left === 1 ? "queda 1 sesión" : `quedan ${o.left} sesiones`}`}, así que {o.keys.length === 1 ? "1 fecha no entra" : `${o.keys.length} fechas no entran`}.
            </span>
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onChange(slots.map((s) => (keys.has(s.key) ? { ...s, treatment_id: null } : s)))}>Agendarlas sin tratamiento</Button>
              <Button variant="secondary" onClick={() => onChange(slots.filter((s) => !keys.has(s.key)))}>No agendarlas</Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmButton({ slots, conflicts, over, pending, allowConflicts, onConfirm }: { slots: Slot[]; conflicts: Conflict[]; over: OverLimit[]; pending: boolean; allowConflicts?: boolean; onConfirm: () => void }) {
  const open = conflicts.filter((c) => !slots.find((s) => s.key === c.key)?.overbook).length;
  if (over.length > 0) return <Button disabled>Elegí qué hacer con las sesiones que no entran</Button>;
  return (
    <Button onClick={onConfirm} disabled={pending || slots.length === 0 || (open > 0 && !allowConflicts)}>
      {pending ? "Cargando…" : open > 0 && allowConflicts ? <><Check size={15} /> Agendar {slots.length} sesiones, {open} en choque</> : open > 0 ? `Resolvé ${open === 1 ? "el choque" : `los ${open} choques`}` : <><Check size={15} /> Agendar {slots.length} sesiones</>}
    </Button>
  );
}

// ---------------------------------------------------------------- Vista previa: la agenda real con los turnos nuevos encima
const weekOf = (date: string) => format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");

type Block = { id: string; start: number; end: number; slot?: Slot; taken?: Taken };

// Lo que se superpone va lado a lado, para ver contra qué turno choca
function layout(list: Block[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: (Block & { col: number; cols: number })[] = [];
  let cluster: (Block & { col: number })[] = [];
  let end = 0;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => out.push({ ...c, cols }));
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= end) flush();
    const used = new Set(cluster.filter((c) => c.end > b.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...b, col });
    end = cluster.length === 1 ? b.end : Math.max(end, b.end);
  }
  if (cluster.length) flush();
  return out;
}

function SlotPreview({
  slots,
  agenda,
  pending,
  bounds,
  newLabel,
  onChange,
  onPushToEnd,
}: {
  slots: Slot[];
  agenda: Agenda;
  pending: boolean;
  bounds: { min: string; max: string };
  newLabel?: string;
  onChange: (s: Slot[]) => void;
  onPushToEnd?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const clash = useMemo(() => new Map(agenda.conflicts.map((c) => [c.key, c.who])), [agenda.conflicts]);
  const sorted = useMemo(() => [...slots].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [slots]);
  const open = sorted.filter((s) => clash.has(s.key) && !s.overbook);
  const weeks = useMemo(() => {
    if (sorted.length === 0) return [];
    const last = weekOf(sorted[sorted.length - 1].date);
    const out: string[] = [];
    for (let w = weekOf(sorted[0].date); w <= last; w = format(addWeeks(parseISO(w), 1), "yyyy-MM-dd")) out.push(w);
    return out;
  }, [sorted]);
  const [picked, setPicked] = useState<string | null>(null);
  const [editTime, setEditTime] = useState(false);
  // De a un choque por vez: la tarjeta muestra la sesión elegida o, si no hay, el primer choque
  const current = slots.find((s) => s.key === selected);
  const active = current ?? open[0];
  const week = picked && weeks.includes(picked) ? picked : active ? weekOf(active.date) : weeks[0];
  const activeClash = active && !active.overbook ? clash.get(active.key) : undefined;
  const index = active ? open.findIndex((s) => s.key === active.key) : -1;

  const patch = (key: string, changes: Partial<Slot>) => onChange(slots.map((s) => (s.key === key ? { ...s, ...changes } : s)));
  const next = () => {
    setSelected(null);
    setPicked(null);
    setEditTime(false);
  };
  const select = (key: string | null) => {
    setSelected(key);
    setPicked(null);
    setEditTime(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        <b className="text-slate-900">{slots.length === 1 ? "1 sesión nueva" : `${slots.length} sesiones nuevas`}</b>
        {open.length > 0 ? <span className="text-rose-700"> · {open.length} con choque</span> : <span className="text-teal-700"> · sin choques</span>}
      </p>

      {active && (
        <div className={cn("rounded-xl border p-3", activeClash ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {activeClash && index >= 0 && <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Choque {index + 1} de {open.length}</p>}
              <p className="font-semibold text-slate-900">
                {cap(format(parseISO(active.date), "EEEE d/MM", { locale: es }))} · {active.time} a {plusMinutes(active.time, active.duration)}
              </p>
              <p className="text-sm text-slate-600">
                {activeClash ? <>Choca con <b>{activeClash}</b>. Tocá un horario libre en la agenda para moverla.</> : active.overbook ? "Queda como sobreturno." : "Tocá un horario libre en la agenda para moverla."}
              </p>
            </div>
            {current && !activeClash && (
              <Button variant="secondary" onClick={next}>{open.length > 0 ? `Siguiente choque (${open.length})` : "Listo"}</Button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {(activeClash || active.overbook) && (
              <Button variant="secondary" className="col-span-2" disabled={pending} onClick={() => { patch(active.key, { overbook: !active.overbook }); next(); }}>
                {active.overbook ? "Quitar sobreturno" : "Dejar como sobreturno"}
              </Button>
            )}
            <Button variant="secondary" disabled={pending} onClick={() => setEditTime((v) => !v)}>Cambiar fecha</Button>
            <Button variant="secondary" disabled={pending} onClick={() => { onChange(slots.filter((s) => s.key !== active.key)); next(); }}>
              <X size={15} /> No agendar
            </Button>
            {onPushToEnd && open.length > 1 && (
              <Button variant="ghost" className="col-span-2" disabled={pending} onClick={() => { onPushToEnd(); next(); }}>Pasar las {open.length} al final</Button>
            )}
          </div>
          {editTime && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
              <Field label="Fecha"><Input type="date" min={bounds.min} max={bounds.max} value={active.date} onChange={(e) => e.target.value && (setSelected(active.key), patch(active.key, { date: e.target.value }))} /></Field>
              <Field label="Hora"><Input type="time" value={active.time} onChange={(e) => e.target.value && (setSelected(active.key), patch(active.key, { time: e.target.value }))} /></Field>
            </div>
          )}
        </div>
      )}

      {week && (
        <WeekCalendar
          week={week}
          slots={sorted}
          taken={agenda.taken}
          clash={clash}
          selected={active?.key ?? null}
          newLabel={newLabel}
          onSelect={(key) => select(key)}
          onMove={active ? (date, time) => { setSelected(active.key); setPicked(null); patch(active.key, { date, time }); } : undefined}
          onShift={(n) => {
            const i = weeks.indexOf(week) + n;
            if (weeks[i]) setPicked(weeks[i]);
          }}
        />
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <Legend cls="bg-teal-500" label="Sesión nueva" />
        <Legend cls="bg-slate-300" label="Ya agendado" />
        <Legend cls="bg-rose-500" label="Choca" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded-sm", cls)} /> {label}</span>;
}

function WeekCalendar({
  week,
  slots,
  taken,
  clash,
  selected,
  newLabel,
  onSelect,
  onMove,
  onShift,
}: {
  week: string;
  slots: Slot[];
  taken: Taken[];
  clash: Map<string, string>;
  selected: string | null;
  newLabel?: string;
  onSelect: (key: string | null) => void;
  onMove?: (date: string, time: string) => void;
  onShift: (n: number) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(week), i), "yyyy-MM-dd"));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const scroller = useRef<HTMLDivElement>(null);
  const firstMinute = Math.min(...slots.filter((s) => days.includes(s.date)).map((s) => toMinutes(s.time)), 8 * 60);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, ((firstMinute - START_HOUR * 60) / 60 - 1) * HOUR_PX);
  }, [week, firstMinute]);
  const cols = "44px repeat(7, minmax(0, 1fr))";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <button onClick={() => onShift(-1)} className="p-1 text-slate-500 hover:text-slate-900" aria-label="Semana anterior"><ChevronLeft size={18} /></button>
        <p className="text-sm font-semibold">
          {format(parseISO(days[0]), "d MMM", { locale: es })} al {format(parseISO(days[6]), "d MMM yyyy", { locale: es })}
        </p>
        <button onClick={() => onShift(1)} className="p-1 text-slate-500 hover:text-slate-900" aria-label="Semana siguiente"><ChevronRight size={18} /></button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
            <div />
            {days.map((d) => (
              <div key={d} className="px-1 py-1 text-center">
                <p className="text-xs font-semibold capitalize">{format(parseISO(d), "EEE d", { locale: es })}</p>
              </div>
            ))}
          </div>
          <div ref={scroller} className="max-h-[46vh] overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: cols }}>
              <div>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR_PX }} className="pr-1.5 pt-0.5 text-right text-[11px] text-slate-400">{String(h).padStart(2, "0")}:00</div>
                ))}
              </div>
              {days.map((d) => {
                const blocks: Block[] = [
                  ...taken.filter((t) => t.date === d).map((t) => ({ id: t.id, start: toMinutes(t.time), end: toMinutes(t.time) + t.duration, taken: t })),
                  ...slots.filter((s) => s.date === d).map((s) => ({ id: s.key, start: toMinutes(s.time), end: toMinutes(s.time) + s.duration, slot: s })),
                ];
                return (
                  <div key={d} className="relative border-l border-slate-100">
                    {hours.flatMap((h) =>
                      ["00", "30"].map((m) => {
                        const time = `${String(h).padStart(2, "0")}:${m}`;
                        return (
                          <div
                            key={time}
                            style={{ height: HOUR_PX / 2 }}
                            onClick={() => onMove?.(d, time)}
                            className={cn(m === "00" ? "border-t border-slate-100" : "border-t border-dashed border-slate-50", onMove && "cursor-pointer hover:bg-teal-50")}
                          />
                        );
                      }),
                    )}
                    {layout(blocks).map((b) => {
                      const style = {
                        top: ((b.start - START_HOUR * 60) / 60) * HOUR_PX + 1,
                        height: Math.max(22, ((b.end - b.start) / 60) * HOUR_PX - 2),
                        left: `calc(${(b.col / b.cols) * 100}% + 1px)`,
                        width: `calc(${100 / b.cols}% - 2px)`,
                      };
                      if (b.taken)
                        return (
                          <div key={b.id} style={style} title={`Ya agendado: ${b.taken.who} ${b.taken.time}`} className="absolute overflow-hidden rounded border border-slate-300 bg-slate-100 px-1 text-[11px] leading-tight text-slate-700">
                            <p className="truncate font-semibold">{b.taken.who}</p>
                            <p className="truncate">{b.taken.time}</p>
                          </div>
                        );
                      const s = b.slot!;
                      const bad = clash.has(s.key) && !s.overbook;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          style={style}
                          title={bad ? `Choca con ${clash.get(s.key)}` : undefined}
                          onClick={() => onSelect(selected === s.key ? null : s.key)}
                          className={cn(
                            "absolute z-10 overflow-hidden rounded border px-1 text-left text-[11px] leading-tight shadow-sm",
                            bad ? "border-rose-300 bg-rose-100 text-rose-800" : s.overbook ? OVERBOOK_BLOCK : "border-teal-300 bg-teal-100 text-teal-900",
                            selected === s.key && "ring-2 ring-slate-800",
                          )}
                        >
                          <span className="block truncate font-semibold">{s.label ?? newLabel ?? "Nueva"}</span>
                          <span className="block truncate">{s.time} – {plusMinutes(s.time, s.duration)}{bad && " · Choca"}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
