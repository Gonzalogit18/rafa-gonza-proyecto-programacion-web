"use client";

import { useState, useTransition } from "react";
import { PatientPicker } from "@/components/patient-picker";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { CLINICAL_KIND_LABEL, fmtTime } from "@/lib/format";
import type { Appointment, Patient } from "@/lib/types";
import { addClinicalQuick } from "../pacientes/actions";

// Registro médico para usar durante la consulta
export function QuickEntry({ professionalId, todays, patients }: { professionalId: string; todays: Appointment[]; patients: Pick<Patient, "id" | "first_name" | "last_name">[] }) {
  const [patientId, setPatientId] = useState(todays[0]?.patient_id ?? "");
  // Si el paciente tiene turno hoy, el registro queda vinculado a ese turno
  const appt = todays.find((a) => a.patient_id === patientId) ?? null;
  const items = [
    ...todays.map((a) => ({ id: a.patient_id, first_name: a.patient?.first_name ?? "", last_name: a.patient?.last_name ?? "", hint: fmtTime(a.starts_at) })),
    ...patients.filter((p) => !todays.some((a) => a.patient_id === p.id)),
  ];
  const [kind, setKind] = useState("evolucion");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await addClinicalQuick({ professionalId, patientId, appointmentId: appt?.id ?? null, kind, title, content: text });
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: "Guardado en la historia clínica" });
        setText("");
        setTitle("");
      }
    });

  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-[#EDEBE6] px-5 py-4 text-[15px] font-semibold">Registro médico</h2>
      <div className="space-y-4 p-5">
        <Field label="Paciente"><PatientPicker patients={items} value={patientId} onChange={setPatientId} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de registro">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(CLINICAL_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
        <Field label="Evolución e indicaciones"><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} /></Field>
        <div className="flex items-center justify-between gap-2">
          <span className={msg?.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg?.text}</span>
          <Button onClick={save} disabled={pending || !patientId || !text.trim()}>Guardar registro</Button>
        </div>
      </div>
    </Card>
  );
}
