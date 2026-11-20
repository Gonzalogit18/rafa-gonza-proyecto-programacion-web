"use client";

import { useState } from "react";
import { Card, Field, Input } from "@/components/ui";
import type { Patient } from "@/lib/types";

const fileInput = "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200";

// Los datos del CUD aparecen solo si el paciente tiene CUD
export function CudSection({ patient }: { patient?: Patient }) {
  const [has, setHas] = useState(!!patient?.has_cud);
  return (
    <Card className="p-5">
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input type="checkbox" name="has_cud" checked={has} onChange={(e) => setHas(e.target.checked)} className="h-4 w-4 accent-violet-600" /> Tiene CUD
      </label>
      <div className={has ? "mt-4 grid gap-4 sm:grid-cols-3" : "hidden"}>
        <Field label="N° de CUD"><Input name="cud_number" defaultValue={patient?.cud_number ?? ""} /></Field>
        <Field label="Diagnóstico del CUD" className="sm:col-span-2"><Input name="cud_diagnosis" defaultValue={patient?.cud_diagnosis ?? ""} /></Field>
        <Field label="Emisión"><Input name="cud_issued" type="date" defaultValue={patient?.cud_issued ?? ""} /></Field>
        <Field label="Vencimiento"><Input name="cud_expiry" type="date" defaultValue={patient?.cud_expiry ?? ""} /></Field>
        <Field label={patient?.cud_file_path ? "Reemplazar copia" : "Copia del CUD"}>
          <input type="file" name="cud_file" accept="application/pdf,image/*" className={fileInput} />
          {patient?.cud_file_path && (
            <a href={`/archivo?path=${encodeURIComponent(patient.cud_file_path)}`} target="_blank" className="mt-1.5 inline-block text-sm font-medium text-teal-700 hover:underline">Ver la copia guardada</a>
          )}
        </Field>
      </div>
    </Card>
  );
}
