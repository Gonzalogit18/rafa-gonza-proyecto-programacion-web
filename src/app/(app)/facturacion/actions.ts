"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { differenceInDays, format, parseISO } from "date-fns";
import { fetchBillingRows, UNTREATED_RULE } from "@/lib/billing";
import { CHANNEL_LABEL, STATUS_LABEL, fmtDate, invoiceLineText, toAR, todayAR } from "@/lib/format";
import { cleanCuit, COND_IVA_RECEPTOR, lastNumber, requestCae, TIPO_COMPROBANTE } from "@/lib/arca";
import { arcaConnection } from "@/lib/arca-session";
import { createPreference, mercadoPagoEnabled, paymentsFor } from "@/lib/mercadopago";
import { requireRole } from "@/lib/session";
import type { InvoiceItem, InvoiceKind, InvoiceStatus, PresentationChannel } from "@/lib/types";

type Result = { error?: string; message?: string };

const refresh = () => {
  revalidatePath("/facturacion", "layout");
  revalidatePath("/balance");
  revalidatePath("/");
  revalidatePath("/pacientes", "layout");
};

async function logEvent(invoiceId: string, kind: "estado" | "nota" | "reclamo", text: string) {
  const { supabase, org, profile } = await requireRole("admin", "secretaria", "profesional");
  await supabase.from("invoice_events").insert({ organization_id: org.id, invoice_id: invoiceId, kind, text, created_by: profile.id });
}

// Tipo de comprobante según quién factura y quién recibe
function comprobante(issuerIva: string | null | undefined, receptorIva: string | null | undefined) {
  if (issuerIva === "responsable_inscripto") return receptorIva === "responsable_inscripto" ? "A" : "B";
  return "C";
}

// Arma (estado "preparada") las facturas del mes: una por tratamiento, a nombre del profesional que atendió.
// Con copago salen dos (financiador + paciente). Los valores se recalculan acá; no se confía en el navegador.
// Las sesiones elegidas pueden ser de distintos meses: se arma cada mes por separado
export async function prepareInvoices(keys: string[]): Promise<Result> {
  const periods = [...new Set(keys.map((k) => k.split("|")[1]).filter(Boolean))].sort();
  if (periods.length === 0) return { error: "Elegí qué facturas preparar." };
  let created = 0;
  for (const period of periods) {
    const r = await prepareForPeriod(period, keys);
    if (r.error) return { error: created ? `Se prepararon ${created} facturas, pero hubo un problema: ${r.error}` : r.error };
    created += r.created;
  }
  return { message: `Se ${created === 1 ? "preparó 1 factura" : `prepararon ${created} facturas`}.` };
}

async function prepareForPeriod(period: string, keys: string[]): Promise<{ error?: string; created: number }> {
  const { supabase, org } = await requireRole("admin", "secretaria", "profesional");
  const { rows } = await fetchBillingRows(supabase, { period });
  const selected = rows.filter((r) => keys.includes(r.key) && r.invoices.length === 0);
  if (selected.length === 0) return { created: 0 };
  const blocked = selected.filter((r) => r.unpriced.length > 0);
  if (blocked.length)
    return { created: 0, error: `Falta cargar la tarifa para: ${blocked.map((r) => `${r.patient.last_name} (${r.treatment.practice_name})`).join(", ")}. Cargala en Configuración → Tarifas.` };

  const lastDay = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate();
  const { data: pros } = await supabase.from("professionals").select("id, punto_venta, condicion_iva");
  const { data: fins } = await supabase.from("obras_sociales").select("id, condicion_iva");
  let created = 0;

  const insert = async (row: (typeof selected)[number], part: "total" | "financiador" | "copago", items: { description: string; quantity: number; unit_price: number }[]) => {
    const t = row.treatment;
    const pro = pros?.find((p) => p.id === t.professional_id);
    const toFinanciador = part !== "copago" && row.rule.billTo === "financiador";
    const finIva = fins?.find((f) => f.id === t.financiador_id)?.condicion_iva;
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        organization_id: org.id,
        kind: toFinanciador ? "obra_social" : row.rule.kind === "reintegro" ? "reintegro" : "particular",
        patient_id: row.patient.id,
        obra_social_id: t.financiador_id,
        treatment_id: t.id,
        professional_id: t.professional_id,
        period,
        period_from: `${period}-01`,
        period_to: `${period}-${String(lastDay).padStart(2, "0")}`,
        status: "preparada",
        part,
        rule_case: row.rule.rule,
        total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
        punto_venta: pro?.punto_venta ?? org.punto_venta ?? 1,
        tipo_comprobante: comprobante(pro?.condicion_iva ?? org.condicion_iva, toFinanciador ? finIva : "consumidor_final"),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.code === "23505" ? `La factura de ${row.patient.last_name} ya estaba preparada (puede que otra persona la haya hecho recién). Actualizá la página.` : error.message);
    await supabase.from("invoice_items").insert(items.map((i) => ({ ...i, invoice_id: inv.id, code: t.practice_code })));
    await logEvent(inv.id, "estado", `Preparada: ${row.dates.length} sesiones · ${row.rule.label}`);
    created++;
  };

  try {
    for (const r of selected) {
      const t = r.treatment;
      const base = {
        practice: t.practice_name,
        patient: r.patient,
        affiliate: r.rule.billTo === "financiador" ? r.patient.os_affiliate_number : null,
        authNumber: r.rule.billTo === "financiador" ? t.auth_number : null,
        period,
      };
      const reintegro = r.rule.kind === "reintegro" ? { diagnosis: t.order_diagnosis, dates: r.dates, financiador: t.financiador?.name } : undefined;
      const copagoPerSession = r.rule.copago ? Number(t.copago_amount) : 0;
      const items = r.lines.map((l) => ({
        description: invoiceLineText({ ...base, reintegro }),
        quantity: l.quantity,
        unit_price: l.unit - copagoPerSession,
      }));
      await insert(r, r.rule.copago ? "financiador" : "total", items);
      if (r.rule.copago)
        await insert(r, "copago", [{ description: invoiceLineText({ ...base, affiliate: null, authNumber: null, copago: true }), quantity: r.dates.length, unit_price: copagoPerSession }]);
    }
  } catch (e) {
    refresh();
    return { created, error: e instanceof Error ? e.message : "Error al preparar" };
  }
  refresh();
  return { created };
}

// Consultas sin tratamiento: el precio por sesión lo pone quien prepara (se propone la tarifa de la cobertura).
// Se factura a la cobertura del paciente o como particular. Lo demás se recalcula acá.
export async function prepareUntreated(list: { key: string; unit: number; toCoverage: boolean }[]): Promise<Result> {
  const { supabase, org } = await requireRole("admin", "secretaria", "profesional");
  if (list.length === 0) return { error: "Elegí qué facturas preparar." };
  if (list.some((l) => !(l.unit > 0))) return { error: "Poné el precio por sesión de cada consulta elegida." };
  const { untreated } = await fetchBillingRows(supabase, {});
  const { data: pros } = await supabase.from("professionals").select("id, punto_venta, condicion_iva, specialty");
  const { data: fins } = await supabase.from("obras_sociales").select("id, condicion_iva");
  let created = 0;
  for (const l of list) {
    const u = untreated.find((x) => x.key === l.key);
    if (!u || u.invoiced) continue;
    const toOS = l.toCoverage && !!u.coverage;
    const pro = pros?.find((p) => p.id === u.professionalId);
    const lastDay = new Date(Number(u.period.slice(0, 4)), Number(u.period.slice(5, 7)), 0).getDate();
    const description = invoiceLineText({
      practice: pro?.specialty || "consulta",
      patient: u.patient,
      affiliate: toOS ? u.patient.os_affiliate_number : null,
      period: u.period,
    });
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        organization_id: org.id,
        kind: toOS ? "obra_social" : "particular",
        patient_id: u.patient.id,
        obra_social_id: toOS ? u.coverage!.id : null,
        treatment_id: null,
        professional_id: u.professionalId,
        period: u.period,
        period_from: `${u.period}-01`,
        period_to: `${u.period}-${String(lastDay).padStart(2, "0")}`,
        status: "preparada",
        part: "total",
        rule_case: UNTREATED_RULE,
        total: l.unit * u.dates.length,
        punto_venta: pro?.punto_venta ?? org.punto_venta ?? 1,
        tipo_comprobante: comprobante(pro?.condicion_iva ?? org.condicion_iva, toOS ? fins?.find((f) => f.id === u.coverage!.id)?.condicion_iva : "consumidor_final"),
      })
      .select("id")
      .single();
    if (error) {
      refresh();
      const text = error.code === "23505" ? `La factura de ${u.patient.last_name} ya estaba preparada (puede que otra persona la haya hecho recién). Actualizá la página.` : error.message;
      return { error: created ? `Se prepararon ${created} facturas, pero hubo un problema: ${text}` : text };
    }
    await supabase.from("invoice_items").insert({ invoice_id: inv.id, description, quantity: u.dates.length, unit_price: l.unit, code: null });
    await logEvent(inv.id, "estado", `Preparada: ${u.dates.length} sesiones sin tratamiento`);
    created++;
  }
  refresh();
  return { message: `Se ${created === 1 ? "preparó 1 factura" : `prepararon ${created} facturas`}.` };
}

// Factura manual (particulares, casos sueltos)
export async function createManualInvoice(input: {
  kind: InvoiceKind;
  patient_id: string | null;
  obra_social_id: string | null;
  professional_id: string | null;
  period: string | null;
  notes: string | null;
  items: InvoiceItem[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { supabase, org } = await requireRole("admin", "secretaria", "profesional");
  const items = input.items.filter((i) => i.description.trim() && i.quantity > 0);
  if (items.length === 0) return { ok: false, error: "Agregá al menos un ítem." };
  if (input.kind === "obra_social" && !input.obra_social_id) return { ok: false, error: "Elegí la obra social a facturar." };
  if (input.kind !== "obra_social" && !input.patient_id) return { ok: false, error: "Elegí el paciente." };
  // Período del servicio: el mes elegido completo (se puede ajustar antes de emitir)
  const lastDay = input.period ? new Date(Number(input.period.slice(0, 4)), Number(input.period.slice(5, 7)), 0).getDate() : 0;
  const { data: pro } = input.professional_id
    ? await supabase.from("professionals").select("punto_venta, condicion_iva").eq("id", input.professional_id).single()
    : { data: null };
  const issuerIva = pro?.condicion_iva ?? org.condicion_iva;

  const { data: inv, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: org.id,
      kind: input.kind,
      patient_id: input.patient_id,
      obra_social_id: input.kind === "particular" ? null : input.obra_social_id,
      professional_id: input.professional_id,
      period: input.period,
      period_from: input.period ? `${input.period}-01` : null,
      period_to: input.period ? `${input.period}-${String(lastDay).padStart(2, "0")}` : null,
      notes: input.notes,
      status: "preparada",
      total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
      punto_venta: pro?.punto_venta ?? org.punto_venta ?? 1,
      tipo_comprobante: issuerIva === "responsable_inscripto" ? "B" : "C",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await supabase.from("invoice_items").insert(items.map((i) => ({ invoice_id: inv.id, description: i.description, code: i.code, quantity: i.quantity, unit_price: i.unit_price })));
  await logEvent(inv.id, "estado", "Factura cargada a mano");
  refresh();
  return { ok: true, id: inv.id };
}

// Corrige la factura antes de emitirla: período del servicio y renglones. El total se recalcula acá.
export async function saveDraft(
  id: string,
  data: { period_from: string; period_to: string; items: { id: string; description: string; quantity: number; unit_price: number }[] },
): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { data: inv } = await supabase.from("invoices").select("status").eq("id", id).single();
  if (!inv) return { error: "Factura no encontrada." };
  if (inv.status !== "preparada") return { error: "La factura ya fue emitida: no se puede cambiar." };
  if (!data.period_from !== !data.period_to || (data.period_from && data.period_from > data.period_to))
    return { error: "Revisá el período: completá las dos fechas y que la de inicio sea anterior a la de fin." };
  for (const it of data.items) {
    if (!it.description.trim()) return { error: "Hay un renglón sin descripción." };
    if (!(it.quantity > 0) || !(it.unit_price >= 0)) return { error: "Revisá cantidades y precios." };
    const { error } = await supabase.from("invoice_items").update({ description: it.description.trim(), quantity: it.quantity, unit_price: it.unit_price }).eq("id", it.id).eq("invoice_id", id);
    if (error) return { error: error.message };
  }
  const total = data.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const { error } = await supabase.from("invoices").update({ period_from: data.period_from || null, period_to: data.period_to || null, total }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return {};
}

// Paso 2 hecho en la página de ARCA: se sube el PDF y se anota el número (el CAE ya está en el PDF)
export async function registerEmission(id: string, data: { arca_number: number; punto_venta: number; issue_date: string; arca_pdf_path: string }): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  if (!data.arca_number) return { error: "Falta el número de factura." };
  if (!data.arca_pdf_path) return { error: "Subí el PDF que te dio ARCA." };
  const { data: inv } = await supabase.from("invoices").select("status").eq("id", id).single();
  if (inv?.status !== "preparada") return { error: "La factura ya fue emitida." };
  const { error } = await supabase.from("invoices").update({ ...data, status: "emitida" }).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", `Emitida en la página de ARCA: factura ${data.punto_venta}-${data.arca_number}, con su PDF`);
  refresh();
  return {};
}

// Planilla de asistencia firmada por el paciente
export async function saveAttendanceFile(id: string, path: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { error } = await supabase.from("invoices").update({ attendance_file_path: path }).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", "Planilla de asistencia firmada subida");
  refresh();
  return {};
}

// Paso 3: se presentó a la obra social
export async function markPresented(id: string, date: string, channel: PresentationChannel, note?: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { error } = await supabase.from("invoices").update({ status: "presentada", presented_at: date, presented_channel: channel }).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", `Presentada el ${fmtDate(date)} por ${CHANNEL_LABEL[channel].toLowerCase()}${note ? `: ${note}` : ""}`);
  refresh();
  return {};
}

// Paso 4: cobrada
export async function markPaid(id: string, date: string = todayAR()): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { error } = await supabase.from("invoices").update({ status: "cobrada", paid_at: date }).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", `Cobrada el ${fmtDate(date)}`);
  refresh();
  return {};
}

// Volver un paso atrás (si se marcó por error)
export async function revertStatus(id: string, to: InvoiceStatus): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  if (to === "preparada") {
    const { data: inv } = await supabase.from("invoices").select("arca_number, cae").eq("id", id).single();
    if (inv?.arca_number || inv?.cae)
      return { error: "Esta factura ya está emitida en ARCA y no puede volver a Para emitir. Si tiene un error, anulala y hacé la nota de crédito en ARCA." };
  }
  const patch: Record<string, unknown> = { status: to };
  if (to !== "cobrada") patch.paid_at = null;
  if (to === "preparada" || to === "emitida") {
    patch.presented_at = null;
    patch.presented_channel = null;
  }
  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", `Vuelta a "${STATUS_LABEL[to]}"`);
  refresh();
  return {};
}

export async function voidInvoice(id: string, reason: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  if (!reason.trim()) return { error: "Indicá el motivo." };
  const { error } = await supabase.from("invoices").update({ status: "anulada", voided_at: new Date().toISOString(), void_reason: reason }).eq("id", id);
  if (error) return { error: error.message };
  await logEvent(id, "estado", `Anulada: ${reason}`);
  refresh();
  return {};
}

export async function addInvoiceNote(id: string, kind: "nota" | "reclamo", text: string): Promise<Result> {
  if (!text.trim()) return { error: "Escribí algo." };
  await logEvent(id, kind, text.trim());
  revalidatePath("/facturacion");
  return {};
}

// ---------------------------------------------------------------- Mercado Pago
const MP_LINK = "Link de pago de Mercado Pago: ";

// Link para que el paciente pague la factura. El monto sale de la base, no del navegador.
export async function createPaymentLink(id: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  if (!mercadoPagoEnabled()) return { error: "Mercado Pago no está configurado." };
  const { data: inv } = await supabase.from("invoices").select("id, total, status, kind, part, patient:patients(first_name, last_name)").eq("id", id).single();
  if (!inv) return { error: "Factura no encontrada." };
  if (inv.status === "cobrada" || inv.status === "anulada") return { error: "La factura ya no se puede cobrar." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const patient = inv.patient as unknown as { first_name: string; last_name: string } | null;
  try {
    const url = await createPreference({
      reference: inv.id,
      title: `Atención de ${patient ? `${patient.first_name} ${patient.last_name}` : "paciente"}`,
      amount: Number(inv.total),
      returnUrl: `${origin}/pago`,
    });
    await logEvent(id, "nota", MP_LINK + url);
    refresh();
    return { message: url };
  } catch (e) {
    return { error: `No se pudo crear el link: ${(e as Error).message}.` };
  }
}

// Consulta a Mercado Pago si el paciente ya pagó y, si pagó todo, marca la factura como cobrada
export async function checkPayment(id: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  if (!mercadoPagoEnabled()) return { error: "Mercado Pago no está configurado." };
  const { data: inv } = await supabase.from("invoices").select("total, status").eq("id", id).single();
  if (!inv) return { error: "Factura no encontrada." };
  try {
    const payments = await paymentsFor(id);
    const paid = payments.find((p) => p.status === "approved" && p.transaction_amount >= Number(inv.total));
    if (!paid) return { message: payments.length ? "El pago todavía no está aprobado." : "Todavía no pagó." };
    if (inv.status === "cobrada") return { message: "Ya estaba cobrada." };
    const date = format(toAR(paid.date_approved ?? new Date()), "yyyy-MM-dd");
    const { error } = await supabase.from("invoices").update({ status: "cobrada", paid_at: date }).eq("id", id);
    if (error) return { error: error.message };
    await logEvent(id, "estado", `Cobrada el ${fmtDate(date)} por Mercado Pago, operación ${paid.id}`);
    refresh();
    return { message: "Pago aprobado. La factura quedó cobrada." };
  } catch (e) {
    return { error: `No se pudo consultar: ${(e as Error).message}.` };
  }
}

// ---------------------------------------------------------------- ARCA
// Emite la factura en ARCA con el certificado del profesional y guarda número y CAE
export async function emitInArca(id: string, issueDate?: string): Promise<Result> {
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { data } = await supabase
    .from("invoices")
    .select("id, kind, status, total, period_from, period_to, arca_number, professional_id, patient:patients(dni), obra_social:obras_sociales(cuit, condicion_iva), professional:professionals(condicion_iva)")
    .eq("id", id)
    .single();
  const inv = data as unknown as {
    kind: InvoiceKind;
    status: InvoiceStatus;
    total: number;
    period_from: string | null;
    period_to: string | null;
    arca_number: number | null;
    professional_id: string | null;
    patient: { dni: string | null } | null;
    obra_social: { cuit: string | null; condicion_iva: string | null } | null;
    professional: { condicion_iva: string | null } | null;
  } | null;
  if (!inv) return { error: "Factura no encontrada." };
  if (inv.status !== "preparada" || inv.arca_number) return { error: "La factura ya fue emitida." };
  if (!inv.professional_id) return { error: "Las facturas a nombre de la clínica todavía se emiten a mano." };
  if (inv.professional?.condicion_iva === "responsable_inscripto") return { error: "Por ahora la app emite solo factura C. Para responsables inscriptos, emitila a mano." };
  if (!(Number(inv.total) > 0)) return { error: "La factura no tiene importe." };

  // Receptor: la obra social con su CUIT, o el paciente con su DNI
  let docTipo = 99, docNro = "0", condIva = COND_IVA_RECEPTOR.consumidor_final;
  if (inv.kind === "obra_social") {
    const cuit = cleanCuit(inv.obra_social?.cuit ?? "");
    if (cuit.length !== 11) return { error: "Falta el CUIT de la obra social. Cargalo en Configuración, Coberturas." };
    docTipo = 80;
    docNro = cuit;
    condIva = COND_IVA_RECEPTOR[inv.obra_social?.condicion_iva ?? ""] ?? COND_IVA_RECEPTOR.exento;
  } else if (inv.patient?.dni && /^\d{7,8}$/.test(inv.patient.dni.replace(/\D/g, ""))) {
    docTipo = 96;
    docNro = inv.patient.dni.replace(/\D/g, "");
  }

  // ARCA acepta para servicios una fecha de hasta 10 días antes o después de hoy
  const today = issueDate ?? todayAR();
  const diff = Math.abs(differenceInDays(parseISO(today), parseISO(todayAR())));
  if (diff > 10) return { error: "La fecha de emisión puede ser hasta 10 días antes o después de hoy." };
  try {
    const { env, cuit, pv, ticket } = await arcaConnection(supabase, inv.professional_id);
    const number = (await lastNumber(env, ticket, cuit, pv, TIPO_COMPROBANTE.C)) + 1;
    const r = await requestCae(env, ticket, cuit, {
      pv,
      tipo: TIPO_COMPROBANTE.C,
      number,
      date: today,
      docTipo,
      docNro,
      condIvaReceptor: condIva,
      total: Number(inv.total),
      serviceFrom: inv.period_from ?? today,
      serviceTo: inv.period_to ?? today,
      payBy: today,
    });
    const { error } = await supabase
      .from("invoices")
      .update({ status: "emitida", tipo_comprobante: "C", punto_venta: pv, arca_number: number, issue_date: today, cae: r.cae, cae_vencimiento: r.caeExpires })
      .eq("id", id);
    // Si no se pudo guardar, el número y el CAE quedan en el historial para cargarlos a mano
    await logEvent(id, "estado", `Emitida en ARCA${env === "homologacion" ? " (pruebas)" : ""}: comprobante C ${pv}-${number}, CAE ${r.cae}${r.observations.length ? `. Observaciones: ${r.observations.join(" · ")}` : ""}`);
    if (error) return { error: `ARCA emitió la factura C ${pv}-${number} con CAE ${r.cae}, pero no se pudo guardar: ${error.message}` };
    refresh();
    return { message: `Emitida: factura C ${String(pv).padStart(5, "0")}-${String(number).padStart(8, "0")}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
