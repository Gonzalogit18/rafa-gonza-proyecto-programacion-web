"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { saveUpload } from "@/lib/storage";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

function patientFromForm(f: FormData) {
  return {
    first_name: str(f, "first_name")!,
    last_name: str(f, "last_name")!,
    dni: str(f, "dni"),
    cuil: str(f, "cuil"),
    birth_date: str(f, "birth_date"),
    sex: str(f, "sex"),
    phone: str(f, "phone"),
    email: str(f, "email"),
    address: str(f, "address"),
    tutor_name: str(f, "tutor_name"),
    tutor_dni: str(f, "tutor_dni"),
    tutor_phone: str(f, "tutor_phone"),
    obra_social_id: str(f, "obra_social_id"),
    os_plan: str(f, "os_plan"),
    os_affiliate_number: str(f, "os_affiliate_number"),
    has_cud: f.get("has_cud") === "on",
    cud_number: str(f, "cud_number"),
    cud_diagnosis: str(f, "cud_diagnosis"),
    cud_issued: str(f, "cud_issued"),
    cud_expiry: str(f, "cud_expiry"),
    background: str(f, "background"),
    main_professional_id: str(f, "main_professional_id"),
    notes: str(f, "notes"),
  };
}

export async function savePatient(formData: FormData) {
  const { supabase, org } = await getSession();
  const id = str(formData, "id");
  const data: Record<string, unknown> = patientFromForm(formData);
  const credential = await saveUpload(supabase, org.id, "credenciales", formData.get("credential_file"));
  const cud = await saveUpload(supabase, org.id, "cud", formData.get("cud_file"));
  if (credential) data.credential_file_path = credential;
  if (cud) data.cud_file_path = cud;

  if (id) {
    const { error } = await supabase.from("patients").update(data).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(`/pacientes/${id}`);
    redirect(`/pacientes/${id}?tab=informacion`);
  }
  // El id lo genera la app: si se pidiera la fila de vuelta, la base no la deja ver a una asistente
  // en el mismo momento en que se crea (todavía no "es suya") y rechaza el alta
  const newId = crypto.randomUUID();
  const { error } = await supabase.from("patients").insert({ ...data, id: newId, organization_id: org.id });
  if (error) throw new Error(error.message);
  revalidatePath("/pacientes");
  redirect(`/pacientes/${newId}`);
}

// Archivar = papelera. No se borra nada: se puede restaurar.
export async function setPatientArchived(id: string, archived: boolean) {
  const { supabase } = await getSession();
  await supabase.from("patients").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id);
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${id}`);
}

export async function addClinicalEntry(formData: FormData) {
  const { supabase, org, profile, myProfessional } = await getSession();
  const patientId = String(formData.get("patient_id"));
  const { data: p } = await supabase.from("patients").select("archived_at").eq("id", patientId).single();
  if (p?.archived_at) throw new Error("El paciente está archivado. Restauralo para agregar registros.");
  const { error } = await supabase.from("clinical_entries").insert({
    organization_id: org.id,
    patient_id: patientId,
    author_id: profile.id,
    professional_id: myProfessional?.id ?? null,
    kind: str(formData, "kind") ?? "consulta",
    title: str(formData, "title")!,
    content: str(formData, "content")!,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/pacientes/${patientId}`);
}

// La historia clínica no se borra: se anula con un motivo y queda visible tachada
export async function voidClinicalEntry(id: string, patientId: string, reason: string) {
  const { supabase, profile } = await getSession();
  const { error } = await supabase
    .from("clinical_entries")
    .update({ voided_at: new Date().toISOString(), voided_by: profile.id, void_reason: reason.trim() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/pacientes/${patientId}`);
  return {};
}

// Importación desde CSV (Excel > Guardar como CSV). Devuelve cuántos se cargaron.
export async function importPatients(rows: Record<string, string>[]) {
  const { supabase, org, isAdmin, myProfessionals } = await getSession();
  // Quien no es administración solo puede cargar pacientes de sus profesionales: si la fila no dice cuál, el primero suyo
  const fallbackPro = isAdmin ? null : (myProfessionals[0]?.id ?? null);
  const [{ data: os }, { data: pros }] = await Promise.all([
    supabase.from("obras_sociales").select("id, name"),
    supabase.from("professionals").select("id, full_name"),
  ]);
  const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const osByName = new Map((os ?? []).map((o) => [key(o.name), o.id]));
  const proByName = new Map((pros ?? []).map((p) => [key(p.full_name), p.id]));

  const clean = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);
  const toDate = (v?: string) => {
    const s = clean(v);
    if (!s) return null;
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // dd/mm/aaaa
    if (m) {
      const y = m[3].length === 2 ? `19${m[3]}` : m[3];
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const records = rows
    .filter((r) => clean(r.apellido) && clean(r.nombre))
    .map((r) => ({
      organization_id: org.id,
      last_name: clean(r.apellido)!,
      first_name: clean(r.nombre)!,
      dni: clean(r.dni)?.replace(/\D/g, "") ?? null,
      cuil: clean(r.cuil),
      birth_date: toDate(r.nacimiento),
      phone: clean(r.telefono),
      email: clean(r.email),
      address: clean(r.domicilio),
      obra_social_id: (r.cobertura ?? r.obra_social) ? osByName.get(key(r.cobertura ?? r.obra_social)) ?? null : null,
      os_plan: clean(r.plan),
      os_affiliate_number: clean(r.afiliado),
      has_cud: ["si", "sí", "s", "x", "1", "true"].includes((r.cud ?? "").trim().toLowerCase()),
      cud_number: clean(r.cud_numero),
      cud_expiry: toDate(r.cud_vencimiento),
      diagnosis: clean(r.diagnostico),
      consult_reason: clean(r.motivo_consulta),
      background: clean(r.antecedentes),
      main_professional_id: (r.profesional ? proByName.get(key(r.profesional)) : undefined) ?? fallbackPro,
      tutor_name: clean(r.tutor),
      tutor_phone: clean(r.tutor_telefono),
      notes: clean(r.observaciones),
    }));

  if (records.length === 0) return { inserted: 0, skipped: rows.length, error: "No se encontraron filas con apellido y nombre." };
  const { error } = await supabase.from("patients").insert(records);
  if (error) return { inserted: 0, skipped: rows.length, error: error.message };
  revalidatePath("/pacientes");
  return { inserted: records.length, skipped: rows.length - records.length };
}

// Registro rápido de historia clínica (desde el inicio). Si se elige un turno, queda vinculado a él.
// Solo el médico de la cuenta, en su propia agenda: el registro queda firmado por quien atendió
export async function addClinicalQuick(input: { professionalId?: string; patientId: string; appointmentId: string | null; kind: string; title: string; content: string }) {
  const { supabase, org, profile, myProfessional, canSeeClinical } = await getSession();
  if (!canSeeClinical || !myProfessional) return { error: "Solo el profesional puede escribir en su historia clínica." };
  if (input.professionalId && input.professionalId !== myProfessional.id) return { error: "Solo podés escribir en tu propia agenda." };
  const professionalId = myProfessional.id;
  if (!input.content.trim()) return { error: "Escribí el registro." };
  const { data: p } = await supabase.from("patients").select("archived_at").eq("id", input.patientId).single();
  if (p?.archived_at) return { error: "El paciente está archivado. Restauralo para agregar registros." };
  let treatmentId: string | null = null;
  if (input.appointmentId) {
    const { data: a } = await supabase.from("appointments").select("treatment_id").eq("id", input.appointmentId).single();
    treatmentId = a?.treatment_id ?? null;
  }
  const { error } = await supabase.from("clinical_entries").insert({
    organization_id: org.id,
    patient_id: input.patientId,
    author_id: profile.id,
    professional_id: professionalId,
    appointment_id: input.appointmentId,
    treatment_id: treatmentId,
    kind: input.kind,
    title: input.title.trim() || "Sesión",
    content: input.content.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/pacientes/${input.patientId}`);
  revalidatePath("/");
  return {};
}
