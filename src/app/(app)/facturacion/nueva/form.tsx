"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Plus, Trash2, User, UserCheck } from "lucide-react";
import { PatientPicker } from "@/components/patient-picker";
import { Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { money, todayAR } from "@/lib/format";
import type { InvoiceKind, ObraSocial, Patient, Professional } from "@/lib/types";
import { createManualInvoice } from "../actions";

const KINDS: { id: InvoiceKind; title: string; desc: string; icon: typeof User }[] = [
  { id: "obra_social", title: "Obra social", desc: "Le facturás a la obra social", icon: Building2 },
  { id: "reintegro", title: "Reintegro", desc: "El paciente la presenta a su obra social", icon: UserCheck },
  { id: "particular", title: "Particular", desc: "La paga el paciente", icon: User },
];

// Valor vigente de cada tarifa de la clínica, para elegirlo como prestación
export type TariffOption = { id: string; label: string; code: string | null; value: number; financiadorId: string | null };
// Los números se guardan como texto mientras se escriben, así el campo se puede vaciar
type Item = { tariffId: string; description: string; code: string; quantity: string; unit_price: string };
const emptyItem = (): Item => ({ tariffId: "", description: "", code: "", quantity: "1", unit_price: "" });
const num = (s: string) => Number(s) || 0;

export function NewInvoiceForm({
  patients,
  obrasSociales,
  professionals,
  tariffs,
  patientCoverages,
}: {
  patients: Patient[];
  obrasSociales: ObraSocial[];
  professionals: Professional[];
  tariffs: TariffOption[];
  patientCoverages: Record<string, string[]>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<InvoiceKind>("obra_social");
  const [patientId, setPatientId] = useState("");
  const [osId, setOsId] = useState("");
  const [professionalId, setProfessionalId] = useState(professionals.length === 1 ? professionals[0].id : "");
  const [period, setPeriod] = useState(todayAR().slice(0, 7));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Solo las coberturas del paciente: la de su ficha y las de sus tratamientos
  const coverages = obrasSociales.filter((o) => (patientCoverages[patientId] ?? []).includes(o.id));
  // Tarifas que tienen sentido para lo elegido: las generales y las de esa cobertura
  const tariffOptions = tariffs.filter((t) => !t.financiadorId || t.financiadorId === osId);
  const total = items.reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0);
  const setItem = (idx: number, patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const onPatient = (id: string) => {
    setPatientId(id);
    const p = patients.find((x) => x.id === id);
    const own = (patientCoverages[id] ?? [])[0] ?? "";
    setOsId(p?.obra_social_id && (patientCoverages[id] ?? []).includes(p.obra_social_id) ? p.obra_social_id : own);
    if (p?.main_professional_id && professionals.some((x) => x.id === p.main_professional_id)) setProfessionalId(p.main_professional_id);
  };

  const pickTariff = (idx: number, id: string) => {
    const t = tariffs.find((x) => x.id === id);
    setItem(idx, t ? { tariffId: id, description: t.label, code: t.code ?? "", unit_price: String(t.value) } : { tariffId: "" });
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createManualInvoice({
        kind,
        patient_id: patientId || null,
        obra_social_id: osId || null,
        professional_id: professionalId || null,
        period: period || null,
        notes: notes || null,
        items: items.map((i) => ({ description: i.description, code: i.code || null, quantity: num(i.quantity), unit_price: num(i.unit_price) })),
      });
      if (r.ok) router.push(`/facturacion?ver=${r.id}`);
      else setError(r.error);
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {KINDS.map(({ id, title, desc, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setKind(id)}
            className={cn("rounded-xl border-2 p-4 text-left transition", kind === id ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300")}
          >
            <Icon className={kind === id ? "text-teal-600" : "text-slate-400"} />
            <p className="mt-2 font-semibold">{title}</p>
            <p className="text-xs text-slate-500">{desc}</p>
          </button>
        ))}
      </div>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Paciente">
          <PatientPicker patients={patients} value={patientId} onChange={onPatient} />
        </Field>
        {kind !== "particular" && (
          <Field label="Obra social">
            {patientId && coverages.length === 0 ? (
              <p className="flex min-h-11 items-center text-sm text-amber-700">El paciente no tiene obra social cargada.</p>
            ) : (
              <Select value={osId} onChange={(e) => setOsId(e.target.value)} disabled={!patientId || coverages.length === 1}>
                {coverages.length !== 1 && <option value="">{patientId ? "Elegí…" : "Primero elegí el paciente"}</option>}
                {coverages.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Factura a nombre de">
          <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            <option value="">La clínica</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Mes de las prestaciones"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Prestaciones</h2>
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-end gap-2">
              <Field label="Tarifa" className="flex-1">
                <Select value={it.tariffId} onChange={(e) => pickTariff(i, e.target.value)}>
                  <option value="">Otra (escribir a mano)</option>
                  {tariffOptions.map((t) => <option key={t.id} value={t.id}>{t.label} · {money(t.value)}</option>)}
                </Select>
              </Field>
              {items.length > 1 && (
                <button onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 hover:text-rose-600" aria-label="Quitar">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <Field label="Descripción en la factura"><Input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Cantidad"><Input type="number" inputMode="numeric" min={1} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></Field>
              <Field label="Precio unitario"><Input type="number" inputMode="decimal" min={0} value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></Field>
              <Field label="Subtotal"><p className="flex min-h-11 items-center justify-end text-sm font-medium tabular-nums">{money(num(it.quantity) * num(it.unit_price))}</p></Field>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <Button variant="ghost" onClick={() => setItems((l) => [...l, emptyItem()])}>
            <Plus size={16} /> Agregar prestación
          </Button>
          <p className="text-lg">Total: <b className="tabular-nums">{money(total)}</b></p>
        </div>
      </Card>

      <Card className="p-5">
        <Field label="Observaciones"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </Card>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button onClick={submit} disabled={pending}>{pending ? "Guardando…" : "Crear factura"}</Button>
      </div>
    </div>
  );
}
