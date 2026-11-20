import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import type { ObraSocial } from "@/lib/types";
import { PatientForm } from "../patient-form";

export default async function NuevoPacientePage() {
  const { supabase, myProfessionals, isAdmin } = await getSession();
  const [{ data: os }] = await Promise.all([
    supabase.from("obras_sociales").select("*").is("archived_at", null).order("name"),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Nuevo paciente" />
      <PatientForm obrasSociales={(os ?? []) as ObraSocial[]} professionals={myProfessionals} requireProfessional={!isAdmin} />
    </div>
  );
}
