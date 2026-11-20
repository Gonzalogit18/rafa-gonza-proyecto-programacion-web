"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { CHANNEL_LABEL, FINANCIADOR_TYPE_LABEL, VIA_LABEL, WEEKDAYS_SHORT } from "@/lib/format";
import { useDialog } from "@/components/dialog";
import type { ObraSocial, Professional, Profile } from "@/lib/types";
import { saveObraSocial, saveProfessional, setObraSocialArchived, setSecretaryAssignments } from "./actions";

// ---------------------------------------------------------------- Profesionales
export function ProfessionalEditor({ p }: { p: Professional }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Card className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.full_name}</p>
            <p className="hidden truncate text-xs text-slate-500 sm:block">
              {[p.specialty, p.matricula, p.cuit ? `CUIT ${p.cuit}` : null, p.work_days.map((d) => WEEKDAYS_SHORT[d]).join(" ")].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!p.cuit && <Badge className="bg-amber-50 text-amber-700">Sin CUIT</Badge>}
          {p.profile_id && <Badge className="bg-teal-50 text-teal-700">Usuario</Badge>}
          <Button variant="ghost" onClick={() => setOpen(true)} aria-label="Editar"><Pencil size={14} /></Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <form
        action={(fd) =>
          start(async () => {
            await saveProfessional(fd);
            setOpen(false);
          })
        }
        className="grid gap-3 sm:grid-cols-3"
      >
        <input type="hidden" name="id" value={p.id} />
        <Field label="Nombre y apellido"><Input name="full_name" required defaultValue={p?.full_name} /></Field>
        <Field label="Especialidad"><Input name="specialty" defaultValue={p?.specialty ?? ""} /></Field>
        <Field label="Matrícula"><Input name="matricula" defaultValue={p?.matricula ?? ""} /></Field>
        <Field label="CUIT"><Input name="cuit" defaultValue={p?.cuit ?? ""} /></Field>
        <Field label="Condición IVA">
          <Select name="condicion_iva" defaultValue={p?.condicion_iva ?? "monotributo"}>
            <option value="monotributo">Monotributo</option>
            <option value="responsable_inscripto">Responsable inscripto</option>
            <option value="exento">Exento</option>
          </Select>
        </Field>
        <Field label="Punto de venta"><Input name="punto_venta" type="number" min={1} defaultValue={p?.punto_venta ?? ""} /></Field>
        <Field label="Días" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} className="flex items-center gap-1 rounded bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                <input type="checkbox" name="work_days" value={d} defaultChecked={(p?.work_days ?? [1, 2, 3, 4, 5]).includes(d)} className="accent-teal-600" /> {WEEKDAYS_SHORT[d]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Desde"><Input name="work_start" type="time" defaultValue={p?.work_start.slice(0, 5) ?? "08:00"} /></Field>
        <Field label="Hasta"><Input name="work_end" type="time" defaultValue={p?.work_end.slice(0, 5) ?? "20:00"} /></Field>
        <Field label="Minutos por turno"><Input name="slot_minutes" type="number" min={10} step={5} defaultValue={p?.slot_minutes ?? 45} /></Field>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={pending}>Guardar</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- Coberturas
export function ObraSocialEditor({ o }: { o?: ObraSocial }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { ask } = useDialog();
  const toggleArchived = async () => {
    if (!o) return;
    if (!o.archived_at && !(await ask(`¿Archivar ${o.name}? Deja de aparecer para elegir; se puede restaurar.`, "Archivar"))) return;
    start(async () => {
      await setObraSocialArchived(o.id, !o.archived_at);
      setOpen(false);
    });
  };

  if (!open) {
    if (!o)
      return (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Agregar cobertura
        </Button>
      );
    return (
      <Card className={cn("flex items-center justify-between gap-3 px-4 py-3", o.archived_at && "opacity-50")}>
        <div className="min-w-0">
          <p className="truncate font-medium">
            {o.name} {o.name.trim().toLowerCase() !== FINANCIADOR_TYPE_LABEL[o.type].toLowerCase() && <Badge className="ml-1 bg-slate-100 text-slate-600">{FINANCIADOR_TYPE_LABEL[o.type]}</Badge>}
          </p>
          <p className="hidden truncate text-xs text-slate-500 sm:block">
            {[o.razon_social, o.cuit, VIA_LABEL[o.default_via], CHANNEL_LABEL[o.presentation_channel], `paga ~${o.plazo_pago_dias ?? 60} días`].filter(Boolean).join(" · ")}
          </p>
          {o.requirements && <p className="mt-1 hidden whitespace-pre-wrap text-sm text-slate-700 sm:block">{o.requirements}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!o.cuit && <Badge className="bg-amber-50 text-amber-700">Sin CUIT</Badge>}
          {o.archived_at ? (
            <Button variant="ghost" disabled={pending} onClick={toggleArchived}>Restaurar</Button>
          ) : (
            <Button variant="ghost" onClick={() => setOpen(true)} aria-label="Editar"><Pencil size={14} /></Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <form
        action={(fd) =>
          start(async () => {
            await saveObraSocial(fd);
            setOpen(false);
          })
        }
        className="grid gap-3 sm:grid-cols-3"
      >
        {o && <input type="hidden" name="id" value={o.id} />}
        <Field label="Nombre"><Input name="name" required defaultValue={o?.name} /></Field>
        <Field label="Tipo">
          <Select name="type" defaultValue={o?.type ?? "obra_social"}>
            {Object.entries(FINANCIADOR_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Cómo se cobra">
          <Select name="default_via" defaultValue={o?.default_via ?? "colegio"}>
            {Object.entries(VIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Razón social para facturar"><Input name="razon_social" defaultValue={o?.razon_social ?? ""} /></Field>
        <Field label="CUIT"><Input name="cuit" defaultValue={o?.cuit ?? ""} /></Field>
        <Field label="Condición IVA">
          <Select name="condicion_iva" defaultValue={o?.condicion_iva ?? ""}>
            <option value="">—</option>
            <option value="responsable_inscripto">IVA Responsable Inscripto</option>
            <option value="exento">IVA Sujeto Exento</option>
            <option value="monotributo">Responsable Monotributo</option>
          </Select>
        </Field>
        <Field label="Domicilio fiscal" className="sm:col-span-2"><Input name="address" defaultValue={o?.address ?? ""} /></Field>
        <Field label="Código"><Input name="codigo" defaultValue={o?.codigo ?? ""} /></Field>
        <Field label="Presentación">
          <Select name="presentation_channel" defaultValue={o?.presentation_channel ?? "mail"}>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Mail de presentación"><Input name="presentation_email" type="email" defaultValue={o?.presentation_email ?? ""} /></Field>
        <Field label="Contacto"><Input name="contact" defaultValue={o?.contact ?? ""} /></Field>
        <Field label="Días para facturar"><Input name="plazo_presentacion_dias" type="number" min={0} defaultValue={o?.plazo_presentacion_dias ?? ""} /></Field>
        <Field label="Días de pago"><Input name="plazo_pago_dias" type="number" min={0} defaultValue={o?.plazo_pago_dias ?? 60} /></Field>
        <Field label="Requisitos" className="sm:col-span-3">
          <Textarea name="requirements" rows={2} defaultValue={o?.requirements ?? ""} />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-3">
          {o && <Button type="button" variant="ghost" disabled={pending} onClick={toggleArchived} className="mr-auto text-rose-700">Archivar</Button>}
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={pending}>Guardar</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- Coberturas con buscador
export function CoberturasList({ list }: { list: ObraSocial[] }) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const match = (o: ObraSocial) => !q || norm(`${o.name} ${o.razon_social ?? ""} ${o.cuit ?? ""}`).includes(norm(q));
  const active = list.filter((o) => !o.archived_at && match(o));
  const archived = list.filter((o) => o.archived_at && match(o));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1"><SearchBox value={q} onChange={setQ} placeholder="Buscar cobertura…" /></div>
        <ObraSocialEditor />
      </div>
      {active.map((o) => <ObraSocialEditor key={o.id} o={o} />)}
      {archived.length > 0 && (
        <details className="pt-2 text-sm">
          <summary className="cursor-pointer text-slate-500">Archivadas</summary>
          <div className="mt-2 space-y-2">{archived.map((o) => <ObraSocialEditor key={o.id} o={o} />)}</div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Secretarías: qué médicos maneja cada una
export function SecretaryAssignments({ secretary, professionals, assigned }: { secretary: Profile; professionals: Professional[]; assigned: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(assigned));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = sel.size !== assigned.length || assigned.some((a) => !sel.has(a));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{secretary.full_name} <span className="text-sm font-normal text-slate-500">· {secretary.email}</span></p>
        {dirty && (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setSecretaryAssignments(secretary.id, [...sel]);
                setMsg(r.error ?? "Guardado");
              })
            }
          >
            Guardar
          </Button>
        )}
        {!dirty && msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {professionals.map((p) => (
          <label key={p.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1", sel.has(p.id) ? "bg-teal-50 ring-teal-300" : "ring-slate-200")}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="accent-teal-600" />
            {p.full_name}
          </label>
        ))}
      </div>
    </Card>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
      />
    </div>
  );
}
