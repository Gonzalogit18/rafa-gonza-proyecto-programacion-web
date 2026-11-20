import Link from "next/link";
import { Button, Card, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import type { ObraSocial, Patient, Professional } from "@/lib/types";
import { savePatient } from "./actions";
import { CudSection } from "./cud-section";

const fileInput = "block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200";

export function PatientForm({
  patient,
  obrasSociales,
  professionals,
  requireProfessional,
}: {
  patient?: Patient;
  obrasSociales: ObraSocial[];
  professionals: Professional[];
  requireProfessional?: boolean;
}) {
  return (
    <form action={savePatient} className="space-y-4">
      {patient && <input type="hidden" name="id" value={patient.id} />}

      <Section title="Datos personales">
        <Field label="Apellido"><Input name="last_name" required defaultValue={patient?.last_name} /></Field>
        <Field label="Nombre"><Input name="first_name" required defaultValue={patient?.first_name} /></Field>
        <Field label="DNI"><Input name="dni" inputMode="numeric" defaultValue={patient?.dni ?? ""} /></Field>
        <Field label="CUIL"><Input name="cuil" inputMode="numeric" defaultValue={patient?.cuil ?? ""} /></Field>
        <Field label="Nacimiento"><Input name="birth_date" type="date" defaultValue={patient?.birth_date ?? ""} /></Field>
        <Field label="Sexo">
          <Select name="sex" defaultValue={patient?.sex ?? ""}>
            <option value="">—</option>
            <option value="F">F</option>
            <option value="M">M</option>
            <option value="X">X</option>
          </Select>
        </Field>
        <Field label="Teléfono"><Input name="phone" defaultValue={patient?.phone ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={patient?.email ?? ""} /></Field>
        <Field label="Domicilio" className="sm:col-span-3"><Input name="address" defaultValue={patient?.address ?? ""} /></Field>
      </Section>

      <Section title="Tutor o responsable">
        <Field label="Nombre"><Input name="tutor_name" defaultValue={patient?.tutor_name ?? ""} /></Field>
        <Field label="DNI"><Input name="tutor_dni" defaultValue={patient?.tutor_dni ?? ""} /></Field>
        <Field label="Teléfono"><Input name="tutor_phone" defaultValue={patient?.tutor_phone ?? ""} /></Field>
      </Section>

      <Section title="Cobertura">
        <Field label="Cobertura">
          <Select name="obra_social_id" defaultValue={patient?.obra_social_id ?? ""}>
            <option value="">Particular</option>
            {obrasSociales.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="Plan"><Input name="os_plan" defaultValue={patient?.os_plan ?? ""} /></Field>
        <Field label="N° de afiliado"><Input name="os_affiliate_number" defaultValue={patient?.os_affiliate_number ?? ""} /></Field>
        <Field label={patient?.credential_file_path ? "Reemplazar credencial" : "Credencial"} className="sm:col-span-3">
          <input type="file" name="credential_file" accept="application/pdf,image/*" className={fileInput} />
          {patient?.credential_file_path && (
            <a href={`/archivo?path=${encodeURIComponent(patient.credential_file_path)}`} target="_blank" className="mt-1.5 inline-block text-sm font-medium text-teal-700 hover:underline">Ver la credencial guardada</a>
          )}
        </Field>
      </Section>

      <CudSection patient={patient} />

      <Section title="Clínico">
        <Field label="Profesional de cabecera">
          <Select name="main_professional_id" required={requireProfessional} defaultValue={patient?.main_professional_id ?? (professionals.length === 1 ? professionals[0].id : "")}>
            <option value="">{requireProfessional ? "Elegí…" : "—"}</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Antecedentes" className="sm:col-span-3"><Textarea name="background" rows={2} className="min-h-0" defaultValue={patient?.background ?? ""} /></Field>
        <Field label="Observaciones" className="sm:col-span-3"><Textarea name="notes" rows={2} className="min-h-0" defaultValue={patient?.notes ?? ""} /></Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Link href={patient ? `/pacientes/${patient.id}?tab=informacion` : "/pacientes"} className={buttonClass("secondary")}>Cancelar</Link>
        <Button type="submit">{patient ? "Guardar" : "Crear paciente"}</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">{children}</div>
    </Card>
  );
}
