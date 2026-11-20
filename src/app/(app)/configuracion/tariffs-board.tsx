"use client";

import { useMemo, useState, useTransition, useRef } from "react";
import { Check, ChevronDown, Pencil, Search, Trash2 } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Button, Card, Field, Input, Select, cn } from "@/components/ui";
import { TARIFF_LABEL, TARIFF_PER_FINANCIADOR, type TariffKey } from "@/lib/billing-rules";
import { fmtDate, money, todayAR } from "@/lib/format";
import type { ObraSocial, Tariff, TariffReference } from "@/lib/types";
import { deleteTariff, saveTariff } from "./actions";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const CATEGORIES: { id: string; label: string; keys: TariffKey[] }[] = [
  { id: "discapacidad", label: "Discapacidad", keys: ["discapacidad_nacional", "discapacidad_ioma", "discapacidad_provincial", "incluir_salud"] },
  { id: "publicas", label: "Colegio, PAMI e IOMA", keys: ["colegio", "pami", "ioma", "superintendencia"] },
  { id: "coberturas", label: "Por obra social", keys: ["convenio"] },
  { id: "art", label: "ART y seguros", keys: ["art", "seguro"] },
  { id: "particular", label: "Particular", keys: ["particular"] },
  { id: "propias", label: "Tarifas propias", keys: ["propia"] },
];

type Fin = Pick<ObraSocial, "id" | "name" | "type" | "default_via">;
type Entry = { id: string; tariff: TariffKey; title: string; subtitle: string; financiadorId: string | null; code: string | null; customName?: string; rows: Tariff[]; reference?: TariffReference };

// Una fila por valor a mantener: las tablas generales, una por cada obra social con convenio, ART y seguro
function buildEntries(tariffs: Tariff[], financiadores: Fin[], references: TariffReference[]): Entry[] {
  const entries = new Map<string, Entry>();
  const add = (tariff: TariffKey, financiadorId: string | null, code: string | null, title: string) => {
    const id = `${tariff}|${financiadorId ?? ""}|${code ?? ""}`;
    if (!entries.has(id)) entries.set(id, { id, tariff, title, subtitle: TARIFF_LABEL[tariff], financiadorId, code, rows: [] });
    return entries.get(id)!;
  };
  (Object.keys(TARIFF_LABEL) as TariffKey[]).filter((k) => !TARIFF_PER_FINANCIADOR.includes(k) && k !== "propia").forEach((k) => add(k, null, null, TARIFF_LABEL[k]));
  for (const f of financiadores) {
    if (f.type === "art") add("art", f.id, null, f.name);
    else if (f.type === "seguro") add("seguro", f.id, null, f.name);
    else if ((f.type === "obra_social" || f.type === "prepaga") && f.default_via === "convenio") add("convenio", f.id, null, f.name);
  }
  for (const t of tariffs) {
    if (t.tariff === "propia") {
      const name = t.custom_name ?? TARIFF_LABEL.propia;
      const code = t.practice_code || null;
      const id = `propia|${name}|${code ?? ""}`;
      if (!entries.has(id)) entries.set(id, { id, tariff: "propia", title: code ? `${name} · ${code}` : name, subtitle: TARIFF_LABEL.propia, financiadorId: null, code, customName: name, rows: [] });
      entries.get(id)!.rows.push(t);
      continue;
    }
    const fin = financiadores.find((f) => f.id === t.financiador_id);
    add(t.tariff, t.financiador_id, t.practice_code || null, fin?.name ?? (t.practice_code ? `${TARIFF_LABEL[t.tariff]} · ${t.practice_code}` : TARIFF_LABEL[t.tariff])).rows.push(t);
  }
  const list = [...entries.values()];
  list.forEach((e) => {
    e.rows.sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    if (!e.financiadorId && !e.code) e.reference = references.filter((r) => r.tariff === e.tariff).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  });
  return list;
}

export function TariffsBoard({ tariffs, financiadores, references, canEdit }: { tariffs: Tariff[]; financiadores: Fin[]; references: TariffReference[]; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => buildEntries(tariffs, financiadores, references), [tariffs, financiadores, references]);
  const shown = all.filter((e) => !q || norm(`${e.title} ${e.subtitle} ${e.code ?? ""}`).includes(norm(q)));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      {CATEGORIES.map((c) => {
        const list = shown.filter((e) => c.keys.includes(e.tariff));
        if (list.length === 0) return null;
        return (
          <section key={c.id}>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">{c.label}</h2>
            <Card className="divide-y divide-slate-100">
              {list.map((e) => <TariffRow key={e.id} entry={e} canEdit={canEdit} />)}
            </Card>
          </section>
        );
      })}
      {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Sin resultados</p>}

      {canEdit && <AddByPractice financiadores={financiadores} />}
    </div>
  );
}

function TariffRow({ entry: e, canEdit }: { entry: Entry; canEdit: boolean }) {
  const current = e.rows.find((r) => r.valid_from <= todayAR()) ?? e.rows[0];
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(todayAR());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask } = useDialog();

  const save = async (v: number, date: string) => {
    const before = current ? money(Number(current.value)) : "sin valor";
    if (!(await ask(`¿Cambiar ${e.title} de ${before} a ${money(v)} desde el ${fmtDate(date)}?`))) return;
    const fd = new FormData();
    fd.set("tariff", e.tariff);
    fd.set("value", String(v));
    fd.set("valid_from", date);
    if (e.financiadorId) fd.set("financiador_id", e.financiadorId);
    if (e.code) fd.set("practice_code", e.code);
    if (e.customName) fd.set("custom_name", e.customName);
    start(async () => {
      setError(null);
      const r = await saveTariff(fd);
      if (r.error) setError(r.error);
      else setEditing(false);
    });
  };
  const newer = e.reference && (!current || (Number(e.reference.value) !== Number(current.value) && e.reference.valid_from >= current.valid_from));

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{e.title}</p>
          {e.title !== e.subtitle && <p className="truncate text-xs text-slate-500">{e.subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {current ? (
            <span className="text-right">
              <span className="block font-semibold tabular-nums">{money(Number(current.value))}</span>
              <span className="block text-xs text-slate-500">desde {fmtDate(current.valid_from)}</span>
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
          {canEdit && <Button
            variant="ghost"
            aria-label="Cambiar valor"
            onClick={() => {
              setValue(current ? String(current.value) : "");
              setEditing((v) => !v);
            }}
          >
            <Pencil size={14} />
          </Button>}
          {e.rows.length > 0 && (
            <Button variant="ghost" aria-label="Ver historial" onClick={() => setHistory((v) => !v)}>
              <ChevronDown size={14} className={cn("transition", history && "rotate-180")} />
            </Button>
          )}
        </div>
      </div>

      {canEdit && newer && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span>Valor de referencia {money(Number(e.reference!.value))} desde {fmtDate(e.reference!.valid_from)} · {e.reference!.source}</span>
          <Button variant="secondary" disabled={pending} onClick={() => save(Number(e.reference!.value), e.reference!.valid_from)}><Check size={14} /> Usar este valor</Button>
        </div>
      )}

      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          <Field label="Valor por sesión"><Input type="number" min={0} step="0.01" value={value} onChange={(ev) => setValue(ev.target.value)} className="bg-white" /></Field>
          <Field label="Vigente desde"><Input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} className="bg-white" /></Field>
          <Button disabled={pending || !value || !from} onClick={() => save(Number(value), from)}>Guardar</Button>
          {error && <p className="w-full text-sm text-rose-600">{error}</p>}
        </div>
      )}

      {history && (
        <ul className="mt-2 space-y-1 text-sm">
          {e.rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-1">
              <span className="text-slate-600">Desde {fmtDate(r.valid_from)}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {money(Number(r.value))}
                {canEdit && <button onClick={async () => (await ask("¿Borrar este valor del historial?", "Borrar")) && start(() => deleteTariff(r.id))} className="text-slate-300 hover:text-rose-600" aria-label="Borrar"><Trash2 size={13} /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Tarifa con nombre propio, o valor especial para un código de práctica
function AddByPractice({ financiadores }: { financiadores: Fin[] }) {
  const [tariff, setTariff] = useState<TariffKey>("propia");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const needsFin = TARIFF_PER_FINANCIADOR.includes(tariff);
  const custom = tariff === "propia";
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-600">Agregar una tarifa</summary>
      <form
        ref={form}
        action={(fd) =>
          start(async () => {
            setError(null);
            const r = await saveTariff(fd);
            if (r.error) setError(r.error);
            else form.current?.reset();
          })
        }
        className="mt-3 grid items-end gap-3 sm:grid-cols-5"
      >
        <Field label="Tabla">
          <Select name="tariff" value={tariff} onChange={(e) => setTariff(e.target.value as TariffKey)}>
            <option value="propia">Nueva, escribir el nombre</option>
            {Object.entries(TARIFF_LABEL).filter(([k]) => k !== "propia").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {custom && <Field label="Nombre"><Input name="custom_name" required /></Field>}
        {needsFin && (
          <Field label="Cobertura">
            <Select name="financiador_id" required>
              <option value="">Elegí…</option>
              {financiadores.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Código"><Input name="practice_code" required={!custom} /></Field>
        <Field label="Valor"><Input name="value" type="number" step="0.01" min={0} required /></Field>
        <Field label="Vigente desde"><Input name="valid_from" type="date" required /></Field>
        <Button type="submit" disabled={pending}>Agregar</Button>
      </form>
      {error && <p className="mt-2 text-rose-600">{error}</p>}
    </details>
  );
}
