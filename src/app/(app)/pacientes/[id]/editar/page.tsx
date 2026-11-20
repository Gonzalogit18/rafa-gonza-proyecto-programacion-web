import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import type { ObraSocial, Patient } from "@/lib/types";
import { PatientForm } from "../../patient-form";

export default async function EditarPacientePage({ params }: PageProps<"/pacientes/[id]/editar">) {
  const { id } = await params;
  const { supabase, myProfessionals, isAdmin } = await getSession();
  const [{ data: patient }, { data: os }] = await Promise.all([
    supabase.from("patients").select("*").eq("id", id).single(),
    supabase.from("obras_sociales").select("*").is("archived_at", null).order("name"),
  ]);
  if (!patient) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Editar: ${patient.last_name}, ${patient.first_name}`} />
      <PatientForm patient={patient as Patient} obrasSociales={(os ?? []) as ObraSocial[]} professionals={myProfessionals} requireProfessional={!isAdmin} />
    </div>
  );
}
