"use server";

import { isTestSite } from "@/lib/site";
import { revalidatePath } from "next/cache";
import { cleanCuit, decrypt, encrypt, lastNumber, newKeyAndCsr, readCertificate, TIPO_COMPROBANTE, type ArcaEnv } from "@/lib/arca";
import { arcaConnection } from "@/lib/arca-session";
import { fmtDate } from "@/lib/format";
import { getSession } from "@/lib/session";

type Result = { error?: string; message?: string; csr?: string };

const refresh = () => {
  revalidatePath("/configuracion");
  revalidatePath("/perfil");
  revalidatePath("/facturacion", "layout");
};

// La administración, o el profesional para su propia cuenta
async function manage(professionalId: string) {
  const s = await getSession();
  if (!s.isAdmin && s.myProfessional?.id !== professionalId) throw new Error("Sin permiso");
  const { data: pro } = await s.supabase.from("professionals").select("id, full_name, organization_id").eq("id", professionalId).single();
  if (!pro) throw new Error("Profesional no encontrado");
  return { ...s, pro };
}

// Paso 1: genera la clave (queda guardada encriptada) y devuelve el pedido para subir a ARCA
export async function arcaNewRequest(professionalId: string, cuitInput: string): Promise<Result> {
  const { supabase, pro } = await manage(professionalId);
  const cuit = cleanCuit(cuitInput);
  if (cuit.length !== 11) return { error: "El CUIT tiene que tener 11 números." };
  const { data: prev } = await supabase.from("arca_credentials").select("environment, punto_venta").eq("professional_id", professionalId).maybeSingle();
  try {
    const { keyPem, csrPem } = newKeyAndCsr(cuit, pro.full_name);
    const { error } = await supabase.from("arca_credentials").upsert({
      professional_id: professionalId,
      organization_id: pro.organization_id,
      environment: prev?.environment ?? "produccion",
      punto_venta: prev?.punto_venta ?? null,
      cuit,
      private_key_enc: encrypt(keyPem),
      csr: csrPem,
      certificate: null,
      cert_expires_at: null,
      ta_token: null,
      ta_sign: null,
      ta_expires_at: null,
      checked_at: null,
      check_error: null,
      updated_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
    refresh();
    return { csr: csrPem };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// Paso 2: el certificado que devolvió ARCA para ese pedido
export async function arcaUploadCertificate(professionalId: string, certPem: string): Promise<Result> {
  const { supabase } = await manage(professionalId);
  const { data: c } = await supabase.from("arca_credentials").select("cuit, private_key_enc").eq("professional_id", professionalId).maybeSingle();
  if (!c) return { error: "Primero descargá el pedido." };
  try {
    const { expiresAt } = readCertificate(certPem.trim(), decrypt(c.private_key_enc), c.cuit);
    const { error } = await supabase
      .from("arca_credentials")
      .update({ certificate: certPem.trim(), cert_expires_at: expiresAt.toISOString(), ta_token: null, ta_sign: null, ta_expires_at: null, check_error: null, updated_at: new Date().toISOString() })
      .eq("professional_id", professionalId);
    if (error) return { error: error.message };
    refresh();
    return { message: `Certificado guardado. Vence el ${fmtDate(expiresAt)}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function arcaSaveSettings(professionalId: string, data: { punto_venta: number | null; environment: ArcaEnv }): Promise<Result> {
  const { supabase } = await manage(professionalId);
  if (data.punto_venta !== null && !(data.punto_venta >= 1 && data.punto_venta <= 99998)) return { error: "El punto de venta es un número de 1 a 99998." };
  const { data: prev } = await supabase.from("arca_credentials").select("environment").eq("professional_id", professionalId).maybeSingle();
  if (!prev) return { error: "Primero descargá el pedido." };
  if (!isTestSite()) data.environment = "produccion";
  const envChanged = prev.environment !== data.environment;
  const { error } = await supabase
    .from("arca_credentials")
    .update({ punto_venta: data.punto_venta, environment: data.environment, ...(envChanged && { ta_token: null, ta_sign: null, ta_expires_at: null }), updated_at: new Date().toISOString() })
    .eq("professional_id", professionalId);
  if (error) return { error: error.message };
  refresh();
  return { message: "Guardado." };
}

// Paso 3: se conecta con ARCA y pide el último número de factura del punto de venta
export async function arcaTest(professionalId: string): Promise<Result> {
  const { supabase } = await manage(professionalId);
  try {
    const { env, cuit, pv, ticket } = await arcaConnection(supabase, professionalId);
    const last = await lastNumber(env, ticket, cuit, pv, TIPO_COMPROBANTE.C);
    await supabase.rpc("arca_save_check", { p_professional: professionalId, p_error: null });
    refresh();
    return { message: `Conectado con ARCA. Última factura C del punto de venta ${pv}: ${last === 0 ? "ninguna todavía" : `número ${last}`}.` };
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.rpc("arca_save_check", { p_professional: professionalId, p_error: msg });
    refresh();
    return { error: msg };
  }
}
