"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Modal } from "@/components/modal";
import { PatientPicker } from "@/components/patient-picker";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { applyRules } from "@/lib/billing-rules";
import { REASON_LABEL, VIA_LABEL, fullName, todayAR } from "@/lib/format";
import type { TreatmentWithUsage } from "@/lib/treatments";
import type { ObraSocial, Patient, Professional, Reason, Via } from "@/lib/types";
import { saveTreatment } from "./actions";
import { TreatmentDetail } from "./treatment-detail";

export type TreatmentOpts = {
  patients: Pick<Patient, "id" | "first_name" | "last_name" | "obra_social_id" | "has_cud" | "cud_expiry" | "os_affiliate_number" | "main_professional_id">[];
  financiadores: Pick<ObraSocial, "id" | "name" | "type" | "default_via">[];
  professionals: Pick<Professional, "id" | "full_name">[];
  customTariffs?: string[];
};

const fileInput = "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-slate-200";

// Qué regla de facturación le toca a este tratamiento (vista previa)
function rulePreview(
  t: { has_order: boolean; reason: Reason; financiador_id: string | null; via: Via | null; copago_amount: number | null; art_siniestro: string | null },
  opts: TreatmentOpts,
  patientId: string,
) {
  const p = opts.patients.find((x) => x.id === patientId);
  const f = opts.financiadores.find((x) => x.id === t.financiador_id) ?? null;
  return applyRules({
    hasOrder: t.has_order,
    reason: t.reason,
    financiador: f,
    via: t.via,
    cudVigente: !!p?.has_cud && (!p.cud_expiry || p.cud_expiry >= todayAR()),
    copagoAmount: t.copago_amount ? Number(t.copago_amount) : null,
    affiliateNumber: p?.os_affiliate_number ?? null,
    siniestro: t.art_siniestro,
  });
}

// Tarjeta simple: quién, qué tratamiento y cuántas sesiones lleva. El resto está en la ficha.
export function TreatmentCard({ t, opts, showPatient, canEdit }: { t: TreatmentWithUsage; opts: TreatmentOpts; showPatient?: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  // Atendidas (y ausentes, que también se facturan), agendadas sin atender y las que quedan
  const done = t.attended + t.absent;
  const left = t.limit ? t.limit - done - t.scheduled : 0;

  return (
    <Card className={cn("flex flex-col p-4", t.archived_at && "bg-slate-50")}>
      <div className="min-w-0">
        {showPatient && <p className="truncate font-semibold">{fullName(t.patient)}</p>}
        <p className={cn("truncate", showPatient ? "text-sm text-slate-600" : "font-semibold")}>{t.practice_name}</p>
      </div>

      <div className="mt-3 flex-1">
        {t.limit ? (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-1.5", done > t.limit ? "bg-rose-500" : "bg-teal-600")} style={{ width: `${Math.min(100, (done / t.limit) * 100)}%` }} />
            <div className="h-1.5 bg-teal-200" style={{ width: `${Math.max(0, Math.min(100 - (done / t.limit) * 100, (t.scheduled / t.limit) * 100))}%` }} />
          </div>
        ) : null}
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-xs tabular-nums text-slate-500">
          <span><b className="font-semibold text-slate-800">{t.attended}</b> atendidas</span>
          {t.absent > 0 && <span>· {t.absent} ausentes</span>}
          <span>· {t.scheduled} agendadas</span>
          {t.limit ? (
            left >= 0 ? <span>· quedan <b className="font-semibold text-slate-800">{left}</b> de {t.limit}</span> : <span className="font-medium text-rose-700">· {-left} de más</span>
          ) : null}
        </p>
      </div>

      <div className="mt-3 flex justify-end">
        <Button variant="secondary" onClick={() => setViewing(true)}>Ver ficha</Button>
      </div>
      {editing && <TreatmentModal opts={opts} initial={t} onClose={() => setEditing(false)} />}
      {viewing && (
        <Modal open onClose={() => setViewing(false)} title={`${fullName(t.patient)} · ${t.practice_name}`} size="xl">
          <TreatmentDetail
            t={t}
            professional={opts.professionals.find((p) => p.id === t.professional_id)?.full_name}
            canEdit={canEdit}
            onEdit={() => {
              setViewing(false);
              setEditing(true);
            }}
            onClose={() => setViewing(false)}
          />
        </Modal>
      )}
    </Card>
  );
}

export function NewTreatmentButton({ opts, patientId }: { opts: TreatmentOpts; patientId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Nuevo tratamiento
      </Button>
      {open && <TreatmentModal opts={opts} patientId={patientId} onClose={() => setOpen(false)} />}
    </>
  );
}

function TreatmentModal({ opts, initial, patientId, onClose }: { opts: TreatmentOpts; initial?: TreatmentWithUsage; patientId?: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask } = useDialog();
  const startPatient = initial?.patient_id ?? patientId ?? "";
  const p0 = opts.patients.find((p) => p.id === startPatient);
  const [patient, setPatient] = useState(startPatient);
  const [hasOrder, setHasOrder] = useState(initial?.has_order ?? true);
  const [reason, setReason] = useState<Reason>(initial?.reason ?? "comun");
  const [fin, setFin] = useState(initial?.financiador_id ?? p0?.obra_social_id ?? "");
  const [via, setVia] = useState<Via | "">(initial?.via ?? "");
  const [copago, setCopago] = useState(initial?.copago_amount != null ? String(initial.copago_amount) : "");

  const rule = patient
    ? rulePreview({ has_order: hasOrder, reason, financiador_id: fin || null, via: via || null, copago_amount: copago ? Number(copago) : null, art_siniestro: initial?.art_siniestro ?? "x" }, opts, patient)
    : null;

  const onPatient = (id: string) => {
    setPatient(id);
    const p = opts.patients.find((x) => x.id === id);
    if (p?.obra_social_id) setFin(p.obra_social_id);
  };

  return (
    <Modal open onClose={onClose} title={initial ? "Editar tratamiento" : "Nuevo tratamiento"} size="xl">
      <form
        action={async (fd) => {
          if (!patient) return setError("Elegí un paciente.");
          const who = fullName(opts.patients.find((p) => p.id === patient));
          if (!(await ask(initial ? `¿Guardar los cambios del tratamiento de ${who}?` : `¿Crear el tratamiento de ${who}?`))) return;
          start(async () => {
            setError(null);
            fd.set("patient_id", patient);
            const r = await saveTreatment(fd);
            if (r.error) setError(r.error);
            else onClose();
          });
        }}
        className="space-y-5"
      >
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Paciente" className="sm:col-span-2">
            <PatientPicker patients={opts.patients} value={patient} onChange={onPatient} disabled={!!patientId || !!initial} />
          </Field>
          <Field label="Práctica"><Input name="practice_name" required defaultValue={initial?.practice_name} /></Field>
          <Field label="Código"><Input name="practice_code" defaultValue={initial?.practice_code ?? ""} /></Field>
          <Field label="Profesional" className="sm:col-span-2">
            <Select name="professional_id" defaultValue={initial?.professional_id ?? p0?.main_professional_id ?? ""}>
              <option value="">—</option>
              {opts.professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Categoría">
            <Select name="reason" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
              {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {reason === "otra" && <Field label="Cuál"><Input name="reason_other" required defaultValue={initial?.reason_other ?? ""} /></Field>}
          <Field label="Copago por sesión"><Input name="copago_amount" type="number" step="0.01" min={0} value={copago} onChange={(e) => setCopago(e.target.value)} placeholder="Sin copago" /></Field>
        </div>

        <Group title="Cobertura">
          <Field label="Cobertura" className="sm:col-span-2">
            <Select name="financiador_id" value={fin} onChange={(e) => setFin(e.target.value)}>
              <option value="">Particular</option>
              {opts.financiadores.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Cómo se cobra">
            <Select name="via" value={via} onChange={(e) => setVia(e.target.value as Via)}>
              <option value="">Según la cobertura</option>
              {Object.entries(VIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Valor fijo por sesión"><Input name="manual_value" type="number" step="0.01" min={0} defaultValue={initial?.manual_value ?? ""} placeholder="Usar tarifas" /></Field>
          {(opts.customTariffs?.length || initial?.custom_tariff) && (
            <Field label="Tarifa" className="sm:col-span-2">
              <Select name="custom_tariff" defaultValue={initial?.custom_tariff ?? ""}>
                <option value="">Según la cobertura</option>
                {[...new Set([...(opts.customTariffs ?? []), ...(initial?.custom_tariff ? [initial.custom_tariff] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
          )}
        </Group>

        <Group
          title={
            <label className="flex items-center gap-2">
              <input type="checkbox" name="has_order" checked={hasOrder} onChange={(e) => setHasOrder(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Orden médica
            </label>
          }
        >
          {hasOrder && (
            <>
              <Field label="Médico derivante"><Input name="order_doctor" defaultValue={initial?.order_doctor ?? ""} /></Field>
              <Field label="Matrícula"><Input name="order_doctor_matricula" defaultValue={initial?.order_doctor_matricula ?? ""} /></Field>
              <Field label="Sesiones indicadas"><Input name="order_sessions" type="number" min={1} defaultValue={initial?.order_sessions ?? ""} /></Field>
              <Field label="Fecha"><Input name="order_date" type="date" defaultValue={initial?.order_date ?? ""} /></Field>
              <Field label="Diagnóstico" className="sm:col-span-2"><Input name="order_diagnosis" defaultValue={initial?.order_diagnosis ?? ""} /></Field>
              <Field label={initial?.order_file_path ? "Reemplazar copia" : "Copia de la orden"} className="sm:col-span-2">
                <input type="file" name="order_file" accept="application/pdf,image/*" className={fileInput} />
              </Field>
            </>
          )}
        </Group>

        <Group title="Autorización de la cobertura">
          <Field label="N° de autorización"><Input name="auth_number" defaultValue={initial?.auth_number ?? ""} /></Field>
          <Field label="Sesiones autorizadas"><Input name="sessions_authorized" type="number" min={1} defaultValue={initial?.sessions_authorized ?? ""} /></Field>
          <Field label="Desde"><Input name="period_from" type="date" defaultValue={initial?.period_from ?? ""} /></Field>
          <Field label="Hasta"><Input name="period_to" type="date" defaultValue={initial?.period_to ?? ""} /></Field>
          <Field label="Sesiones por mes"><Input name="sessions_per_month" type="number" min={1} defaultValue={initial?.sessions_per_month ?? ""} /></Field>
          <Field label={initial?.auth_file_path ? "Reemplazar copia" : "Copia"} className="sm:col-span-3">
            <input type="file" name="auth_file" accept="application/pdf,image/*" className={fileInput} />
          </Field>
        </Group>

        {reason === "accidente_trabajo" && (
          <Group title="ART">
            <Field label="N° de siniestro"><Input name="art_siniestro" defaultValue={initial?.art_siniestro ?? ""} /></Field>
            <Field label="Empleador" className="sm:col-span-2"><Input name="art_empleador" defaultValue={initial?.art_empleador ?? ""} /></Field>
          </Group>
        )}

        <Field label="Notas"><Textarea name="notes" rows={2} className="min-h-0" defaultValue={initial?.notes ?? ""} /></Field>

        {rule && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium">Se factura:</span>
            <span>{rule.label}</span>
            {rule.copago && <Badge className="bg-violet-50 text-violet-700">+ copago al paciente</Badge>}
          </div>
        )}
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={pending || !patient}>{pending ? "Guardando…" : "Guardar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Group({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-4">{children}</div>
    </fieldset>
  );
}
