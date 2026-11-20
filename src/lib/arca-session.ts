import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, login, type ArcaEnv, type Ticket } from "./arca";

export type ArcaCredential = {
  professional_id: string;
  environment: ArcaEnv;
  cuit: string;
  punto_venta: number | null;
  private_key_enc: string;
  certificate: string | null;
  cert_expires_at: string | null;
  ta_token: string | null;
  ta_sign: string | null;
  ta_expires_at: string | null;
};

// Lo que se puede mostrar en pantalla: nunca la clave ni el permiso
export const ARCA_STATUS_SELECT = "professional_id, environment, cuit, punto_venta, certificate, cert_expires_at, checked_at, check_error, updated_at";

// Certificado del profesional y un permiso de ARCA vigente (reusa el guardado mientras dure)
export async function arcaConnection(supabase: SupabaseClient, professionalId: string) {
  const { data } = await supabase.from("arca_credentials").select("*").eq("professional_id", professionalId).maybeSingle();
  const c = data as ArcaCredential | null;
  if (!c?.certificate) throw new Error("El profesional todavía no conectó su cuenta de ARCA. Se hace en Configuración, ARCA.");
  if (!c.punto_venta) throw new Error("Falta el punto de venta de ARCA del profesional.");
  if (c.cert_expires_at && new Date(c.cert_expires_at) < new Date()) throw new Error("El certificado de ARCA venció. Hay que generar uno nuevo en Configuración, ARCA.");

  let ticket: Ticket;
  if (c.ta_token && c.ta_sign && c.ta_expires_at && new Date(c.ta_expires_at).getTime() > Date.now() + 5 * 60_000) {
    ticket = { token: c.ta_token, sign: c.ta_sign, expiresAt: c.ta_expires_at };
  } else {
    ticket = await login(c.environment, c.certificate, decrypt(c.private_key_enc));
    await supabase.rpc("arca_save_ta", { p_professional: professionalId, p_token: ticket.token, p_sign: ticket.sign, p_expires: ticket.expiresAt });
  }
  return { env: c.environment, cuit: c.cuit, pv: c.punto_venta, ticket };
}

export type ArcaStatus = {
  environment: ArcaEnv;
  cuit: string;
  punto_venta: number | null;
  hasCertificate: boolean;
  cert_expires_at: string | null;
  checked_at: string | null;
  check_error: string | null;
};

export const toArcaStatus = (c: Record<string, unknown> | undefined | null): ArcaStatus | null =>
  c
    ? {
        environment: c.environment as ArcaStatus["environment"],
        cuit: c.cuit as string,
        punto_venta: (c.punto_venta as number | null) ?? null,
        hasCertificate: !!c.certificate,
        cert_expires_at: (c.cert_expires_at as string | null) ?? null,
        checked_at: (c.checked_at as string | null) ?? null,
        check_error: (c.check_error as string | null) ?? null,
      }
    : null;
