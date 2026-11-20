"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v);
};

export async function saveOrganization(formData: FormData) {
  const { supabase, org } = await requireRole("admin");
  await supabase
    .from("organizations")
    .update({
      name: str(formData, "name") ?? org.name,
      razon_social: str(formData, "razon_social"),
      cuit: str(formData, "cuit"),
      condicion_iva: str(formData, "condicion_iva"),
      punto_venta: num(formData, "punto_venta") ?? 1,
      ingresos_brutos: str(formData, "ingresos_brutos"),
      inicio_actividades: str(formData, "inicio_actividades"),
      address: str(formData, "address"),
      phone: str(formData, "phone"),
      email: str(formData, "email"),
    })
    .eq("id", org.id);
  revalidatePath("/", "layout");
}

export async function saveProfessional(formData: FormData) {
  const { supabase } = await requireRole("admin");
  const id = str(formData, "id");
  const data = {
    full_name: str(formData, "full_name")!,
    specialty: str(formData, "specialty"),
    matricula: str(formData, "matricula"),
    cuit: str(formData, "cuit"),
    condicion_iva: str(formData, "condicion_iva"),
    punto_venta: num(formData, "punto_venta"),
    work_days: formData.getAll("work_days").map(Number),
    work_start: str(formData, "work_start") ?? "08:00",
    work_end: str(formData, "work_end") ?? "20:00",
    slot_minutes: num(formData, "slot_minutes") ?? 45,
  };
  if (id) await supabase.from("professionals").update(data).eq("id", id);
  revalidatePath("/configuracion");
  revalidatePath("/agenda");
}

export async function saveObraSocial(formData: FormData) {
  const { supabase, org } = await requireRole("admin", "secretaria");
  const id = str(formData, "id");
  const data = {
    name: str(formData, "name")!,
    type: str(formData, "type") ?? "obra_social",
    default_via: str(formData, "default_via") ?? "colegio",
    razon_social: str(formData, "razon_social"),
    cuit: str(formData, "cuit"),
    condicion_iva: str(formData, "condicion_iva"),
    address: str(formData, "address"),
    codigo: str(formData, "codigo"),
    presentation_channel: str(formData, "presentation_channel") ?? "mail",
    presentation_email: str(formData, "presentation_email"),
    contact: str(formData, "contact"),
    plazo_presentacion_dias: num(formData, "plazo_presentacion_dias"),
    plazo_pago_dias: num(formData, "plazo_pago_dias") ?? 60,
    requirements: str(formData, "requirements"),
  };
  if (id) await supabase.from("obras_sociales").update(data).eq("id", id);
  else await supabase.from("obras_sociales").insert({ ...data, organization_id: org.id });
  revalidatePath("/configuracion");
}

export async function setObraSocialArchived(id: string, archived: boolean) {
  const { supabase } = await requireRole("admin", "secretaria");
  await supabase.from("obras_sociales").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id);
  revalidatePath("/configuracion");
}

export async function saveTariff(formData: FormData) {
  const { supabase, org } = await requireRole("admin");
  const tariff = str(formData, "tariff")!;
  const custom_name = str(formData, "custom_name");
  if (tariff === "propia" && !custom_name) return { error: "Escribí el nombre de la tarifa." };
  const { error } = await supabase.from("tariffs").insert({
    organization_id: org.id,
    tariff,
    custom_name,
    financiador_id: str(formData, "financiador_id"),
    practice_code: str(formData, "practice_code"),
    practice_name: str(formData, "practice_name"),
    value: num(formData, "value"),
    valid_from: str(formData, "valid_from"),
  });
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return {};
}

export async function deleteTariff(id: string) {
  const { supabase } = await requireRole("admin");
  await supabase.from("tariffs").delete().eq("id", id);
  revalidatePath("/configuracion");
}

// Qué profesionales (agendas) maneja cada secretaria
export async function setSecretaryAssignments(secretaryId: string, professionalIds: string[]) {
  const { supabase, org } = await requireRole("admin");
  const { error: e1 } = await supabase.from("secretary_assignments").delete().eq("secretary_id", secretaryId);
  if (e1) return { error: e1.message };
  if (professionalIds.length) {
    const { error } = await supabase
      .from("secretary_assignments")
      .insert(professionalIds.map((professional_id) => ({ organization_id: org.id, secretary_id: secretaryId, professional_id })));
    if (error) return { error: error.message };
  }
  revalidatePath("/configuracion");
  return {};
}
