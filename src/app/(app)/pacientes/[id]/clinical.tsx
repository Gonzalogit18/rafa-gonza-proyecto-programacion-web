"use client";

import { useRef, useTransition } from "react";
import { Ban } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { CLINICAL_KIND_LABEL } from "@/lib/format";
import { addClinicalEntry, voidClinicalEntry } from "../actions";

export function ClinicalEntryForm({ patientId }: { patientId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-semibold">Nuevo registro</h3>
      <form
        ref={ref}
        action={async (fd) => {
          await addClinicalEntry(fd);
          ref.current?.reset();
        }}
        className="space-y-3"
      >
        <input type="hidden" name="patient_id" value={patientId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select name="kind" defaultValue="evolucion">
              {Object.entries(CLINICAL_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Título"><Input name="title" required /></Field>
        </div>
        <Field label="Detalle"><Textarea name="content" required rows={5} /></Field>
        <Button type="submit" className="w-full">Guardar en historia clínica</Button>
      </form>
    </Card>
  );
}

export function VoidEntryButton({ id, patientId }: { id: string; patientId: string }) {
  const [pending, start] = useTransition();
  const { askText, notify } = useDialog();
  return (
    <button
      disabled={pending}
      onClick={async () => {
        const reason = await askText("Motivo de anulación. El registro queda visible tachado.");
        if (reason)
          start(async () => {
            const r = await voidClinicalEntry(id, patientId, reason);
            if (r.error) await notify(r.error);
          });
      }}
      className="flex items-center gap-1 rounded px-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
      title="Anular registro"
    >
      <Ban size={13} /> <span className="text-[11px]">Anular</span>
    </button>
  );
}
