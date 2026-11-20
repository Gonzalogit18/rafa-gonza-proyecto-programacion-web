"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { saveUpload } from "@/lib/storage";
import type { AppointmentStatus } from "@/lib/types";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v);
};

export type TreatmentSession = { id: string; starts_at: string; status: AppointmentStatus; notes: string | null };

// Sesiones de un tratamiento, para la ficha completa
export async function getTreatmentSessions(id: string): Promise<TreatmentSession[]> {
  const { supabase } = await getSession();
  const { data } = await supabase.from("appointments").select("id, starts_at, status, notes").eq("treatment_id", id).order("starts_at");
  return (data ?? []) as TreatmentSession[];
}

export async function saveTreatment(formData: FormData): Promise<{ error?: string }> {
  const { supabase, org } = await getSession();
  const id = str(formData, "id");
  const patientId = str(formData, "patient_id");
  if (!patientId) return { error: "Elegí el paciente." };

  const data: Record<string, unknown> = {
    patient_id: patientId,
    professional_id: str(formData, "professional_id"),
    practice_name: str(formData, "practice_name"),
    practice_code: str(formData, "practice_code"),
    has_order: formData.get("has_order") === "on",
    order_doctor: str(formData, "order_doctor"),
    order_doctor_matricula: str(formData, "order_doctor_matricula"),
    order_diagnosis: str(formData, "order_diagnosis"),
    order_sessions: num(formData, "order_sessions"),
    order_date: str(formData, "order_date"),
    reason: str(formData, "reason") ?? "comun",
    reason_other: str(formData, "reason") === "otra" ? str(formData, "reason_other") : null,
    financiador_id: str(formData, "financiador_id"),
    via: str(formData, "via"),
    auth_number: str(formData, "auth_number"),
    sessions_authorized: num(formData, "sessions_authorized"),
    sessions_per_month: num(formData, "sessions_per_month"),
    period_from: str(formData, "period_from"),
    period_to: str(formData, "period_to"),
    copago_amount: num(formData, "copago_amount"),
    art_siniestro: str(formData, "art_siniestro"),
    art_empleador: str(formData, "art_empleador"),
    manual_value: num(formData, "manual_value"),
    custom_tariff: str(formData, "custom_tariff"),
    notes: str(formData, "notes"),
  };
  if (!data.practice_name) return { error: "Indicá la práctica." };

  try {
    const order = await saveUpload(supabase, org.id, "ordenes", formData.get("order_file"));
    const auth = await saveUpload(supabase, org.id, "autorizaciones", formData.get("auth_file"));
    if (order) data.order_file_path = order;
    if (auth) data.auth_file_path = auth;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir el archivo" };
  }

  const { error } = id
    ? await supabase.from("treatments").update(data).eq("id", id)
    : await supabase.from("treatments").insert({ ...data, organization_id: org.id });
  if (error) return { error: error.message };
  revalidatePath("/tratamientos");
  revalidatePath(`/pacientes/${patientId}`);
  return {};
}

export async function setTreatmentArchived(id: string, patientId: string, archived: boolean) {
  const { supabase } = await getSession();
  await supabase.from("treatments").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id);
  revalidatePath("/tratamientos");
  revalidatePath(`/pacientes/${patientId}`);
}
