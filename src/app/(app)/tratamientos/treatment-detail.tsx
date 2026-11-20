"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, FileText, Pencil } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { fileHref } from "@/components/file-upload";
import { Button, buttonClass } from "@/components/ui";
import { REASON_LABEL, VIA_LABEL, fmtDate, fullName, money } from "@/lib/format";
import type { TreatmentWithUsage } from "@/lib/treatments";
import { STATUS_STYLE } from "../agenda/status";
import type { AppointmentStatus } from "@/lib/types";
import { getTreatmentSessions, setTreatmentArchived, type TreatmentSession } from "./actions";

type Row = [string, string | number | null | undefined];

// Ficha completa del tratamiento: lo que piden las obras sociales para validar una factura
export function TreatmentDetail({ t, professional, canEdit, onEdit, onClose }: { t: TreatmentWithUsage; professional?: string; canEdit: boolean; onEdit?: () => void; onClose: () => void }) {
  const [sessions, setSessions] = useState<TreatmentSession[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const { ask } = useDialog();

  useEffect(() => {
    getTreatmentSessions(t.id).then(setSessions);
  }, [t.id]);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Paciente",
      rows: [
        ["Nombre", fullName(t.patient)],
        ["DNI", t.patient?.dni],
        ["Cobertura", t.financiador?.name ?? "Particular"],
        ["Plan", t.patient?.os_plan],
        ["N° de afiliado", t.patient?.os_affiliate_number],
      ],
    },
    {
      title: "Tratamiento",
      rows: [
        ["Práctica", t.practice_name],
        ["Código", t.practice_code],
        ["Profesional", professional],
        ["Categoría", (t.reason === "otra" && t.reason_other) || REASON_LABEL[t.reason]],
        ["Cómo se cobra", t.via ? VIA_LABEL[t.via] : "Según la cobertura"],
        ["Copago por sesión", t.copago_amount != null ? money(Number(t.copago_amount)) : null],
        ["Valor fijo por sesión", t.manual_value != null ? money(Number(t.manual_value)) : null],
        ["Tarifa", t.custom_tariff],
      ],
    },
    {
      title: "Orden médica",
      rows: t.has_order
        ? [
            ["Médico derivante", t.order_doctor],
            ["Matrícula", t.order_doctor_matricula],
            ["Diagnóstico", t.order_diagnosis],
            ["Sesiones indicadas", t.order_sessions],
            ["Fecha", t.order_date ? fmtDate(t.order_date) : null],
          ]
        : [["Orden", "Sin orden médica"]],
    },
    {
      title: "Autorización",
      rows: [
        ["N° de autorización", t.auth_number],
        ["Sesiones autorizadas", t.sessions_authorized],
        ["Sesiones por mes", t.sessions_per_month],
        ["Desde", t.period_from ? fmtDate(t.period_from) : null],
        ["Hasta", t.period_to ? fmtDate(t.period_to) : null],
      ],
    },
    { title: "ART", rows: [["N° de siniestro", t.art_siniestro], ["Empleador", t.art_empleador]] },
  ];
  const visible = groups.map((g) => ({ ...g, rows: g.rows.filter(([, v]) => v !== null && v !== undefined && v !== "") })).filter((g) => g.rows.length > 0);

  const copy = async () => {
    const lines = visible.flatMap((g) => [g.title.toUpperCase(), ...g.rows.map(([k, v]) => `${k}: ${v}`), ""]);
    if (sessions?.length) lines.push("SESIONES", ...sessions.map((s) => `${fmtDate(s.starts_at)} ${STATUS_STYLE[s.status].label}`));
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Atendidas" value={t.attended} />
        <Stat label="Ausentes" value={t.absent} />
        <Stat label="Agendadas" value={t.scheduled} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((g) => (
          <section key={g.title} className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
            <dl className="space-y-1 text-sm">
              {g.rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {t.notes && <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{t.notes}</p>}

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-2 text-sm font-semibold">Sesiones</h3>
        {sessions === null ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-slate-400">Sin sesiones</p>
        ) : (
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>{fmtDate(s.starts_at, "EEE dd/MM/yyyy HH:mm")}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {s.notes && <span className="truncate text-xs italic text-slate-500">{s.notes}</span>}
                  <Status status={s.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(t.order_file_path || t.auth_file_path) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {t.order_file_path && <a href={fileHref(t.order_file_path)} target="_blank" className="flex items-center gap-1 font-medium text-teal-700 hover:underline"><FileText size={14} /> Copia de la orden</a>}
          {t.auth_file_path && <a href={fileHref(t.auth_file_path)} target="_blank" className="flex items-center gap-1 font-medium text-teal-700 hover:underline"><FileText size={14} /> Copia de la autorización</a>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap gap-2">
          <Link href={`/pacientes/${t.patient_id}`} className={buttonClass("secondary")}>Ver paciente</Link>
          <Button variant="secondary" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copiado" : "Copiar datos"}
          </Button>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={async () =>
                (await ask(t.archived_at ? "¿Restaurar este tratamiento?" : "¿Archivar este tratamiento? Sus sesiones y facturas no se borran.", t.archived_at ? "Restaurar" : "Archivar")) &&
                start(async () => {
                  await setTreatmentArchived(t.id, t.patient_id, !t.archived_at);
                  onClose();
                })
              }
            >
              {t.archived_at ? "Restaurar" : "Archivar"}
            </Button>
            {onEdit && !t.archived_at && <Button onClick={onEdit}><Pencil size={15} /> Editar</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Status({ status }: { status: AppointmentStatus }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status].badge}`}>{STATUS_STYLE[status].label}</span>;
}
