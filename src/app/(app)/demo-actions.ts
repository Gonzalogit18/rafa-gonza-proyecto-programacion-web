"use server";

import { addDays, addMonths, format, getDay, startOfMonth, subDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { applyRules, pickTariff, type FinanciadorType, type TariffKey, type TariffRow, type Via } from "@/lib/billing-rules";
import { arToISO, invoiceLineText, nowAR } from "@/lib/format";
import { requireRole } from "@/lib/session";

// Datos de ejemplo (todos ficticios) para probar la app. Solo con ENABLE_DEMO=true.
export async function loadDemoData() {
  if (process.env.ENABLE_DEMO !== "true") throw new Error("Datos de ejemplo deshabilitados");
  const { supabase, org, myProfessional } = await requireRole("admin");
  const orgId = org.id;
  const now = nowAR();
  const ok = <T,>(r: { data: T; error: { message: string } | null }, what: string): Exclude<T, null> => {
    if (r.error || !r.data) throw new Error(`${what}: ${r.error?.message ?? "sin datos"}`);
    return r.data as Exclude<T, null>;
  };

  await supabase.from("organizations").update({ condicion_iva: "monotributo", punto_venta: 2, address: "Calle 57 1234, Necochea" }).eq("id", orgId);

  // Profesionales: la administradora + dos más (cada uno factura con su CUIT)
  let meId = myProfessional?.id;
  if (!meId) meId = ok(await supabase.from("professionals").insert({ organization_id: orgId, full_name: "Profesional Demo" }).select("id").single(), "Profesional").id;
  await supabase
    .from("professionals")
    .update({ color: "#0d9488", specialty: "Kinesiología", cuit: "27-11111111-1", condicion_iva: "monotributo", punto_venta: 2, work_days: [0, 1, 2, 3, 4, 5, 6], work_start: "08:00", work_end: "20:00", slot_minutes: 40 })
    .eq("id", meId);
  // Los profesionales los da de alta el equipo de MedApp (scripts/create-demo-users.mjs); acá solo se completan sus datos
  const DEMO_PROS = [
    { full_name: "Mateo Fernández", specialty: "Kinesiología", matricula: "MP 5501", cuit: "20-22222222-2", condicion_iva: "monotributo", punto_venta: 1, work_days: [1, 2, 3, 4, 5], work_start: "08:00", work_end: "14:00", slot_minutes: 40 },
    { full_name: "Sofía Romero", specialty: "Kinesiología respiratoria", matricula: "MP 6612", cuit: "27-33333333-3", condicion_iva: "monotributo", punto_venta: 1, work_days: [1, 3, 5], work_start: "14:00", work_end: "20:00", slot_minutes: 40 },
  ];
  const { data: existing } = await supabase.from("professionals").select("id, full_name");
  const others = DEMO_PROS.map((d) => existing?.find((e) => e.full_name === d.full_name));
  if (others.some((o) => !o)) throw new Error("Faltan los profesionales de demo: correr primero node scripts/create-demo-users.mjs");
  for (const [k, d] of DEMO_PROS.entries()) await supabase.from("professionals").update(d).eq("id", others[k]!.id);
  const pros = [meId, ...others.map((o) => o!.id)];

  // Coberturas
  const fin = ok(
    await supabase
      .from("obras_sociales")
      .insert(
        [
          { type: "obra_social", name: "OSFATLYF", razon_social: "Obra Social de la Federación Argentina de Trabajadores de Luz y Fuerza", cuit: "30-66322124-4", condicion_iva: "responsable_inscripto", default_via: "colegio", presentation_channel: "mail", presentation_email: "integracion@osfatlyf.org", plazo_pago_dias: 60, requirements: "Planilla firmada. Informe evolutivo con la 1° factura." },
          { type: "obra_social", name: "Sanidad", razon_social: "Obra Social del Personal de la Sanidad Argentina", cuit: "30-67923210-6", condicion_iva: "exento", default_via: "colegio", presentation_channel: "mail", plazo_pago_dias: 60, requirements: "DNI y N° de afiliado en la factura." },
          { type: "obra_social", name: "Jerárquicos", razon_social: "O.S.T.S.A.M.P.J.B.O.N.", cuit: "33-71018560-9", condicion_iva: "exento", default_via: "convenio", presentation_channel: "mail", plazo_presentacion_dias: 30, plazo_pago_dias: 45 },
          { type: "pami", name: "PAMI", razon_social: "INSSJP", cuit: "30-54666670-7", condicion_iva: "exento", default_via: "convenio", presentation_channel: "portal", plazo_pago_dias: 90 },
          { type: "ioma", name: "IOMA", razon_social: "Instituto de Obra Médico Asistencial", cuit: "30-62652478-9", condicion_iva: "exento", default_via: "convenio", presentation_channel: "papel", plazo_pago_dias: 120 },
          { type: "prepaga", name: "OSDE", razon_social: "OSDE", cuit: "30-54674195-8", condicion_iva: "responsable_inscripto", default_via: "reintegro", presentation_channel: "mail", plazo_pago_dias: 30 },
          { type: "art", name: "Prevención ART", razon_social: "Prevención ART S.A.", cuit: "30-68436191-7", condicion_iva: "responsable_inscripto", default_via: "convenio", presentation_channel: "portal", plazo_pago_dias: 60 },
        ].map((o) => ({ ...o, organization_id: orgId })),
        { defaultToNull: false },
      )
      .select("id, name"),
    "Coberturas",
  );
  const F = (name: string) => fin.find((f) => f.name === name)!.id;

  // Tarifas con vigencia: un año de historia con aumentos (el nomenclador de discapacidad sube en octubre)
  const monthsAgo = (m: number) => format(startOfMonth(addMonths(now, -m)), "yyyy-MM-dd");
  const BASE: { tariff: TariffKey; financiador_id: string | null; value: number }[] = [
    { tariff: "colegio", financiador_id: null, value: 20900 },
    { tariff: "discapacidad_nacional", financiador_id: null, value: 19500 },
    { tariff: "discapacidad_ioma", financiador_id: null, value: 18200 },
    { tariff: "ioma", financiador_id: null, value: 15400 },
    { tariff: "pami", financiador_id: null, value: 12800 },
    { tariff: "convenio", financiador_id: F("Jerárquicos"), value: 17722.15 },
    { tariff: "art", financiador_id: F("Prevención ART"), value: 24000 },
    { tariff: "particular", financiador_id: null, value: 25000 },
  ];
  const tariffRows: (TariffRow & { notes?: string })[] = BASE.flatMap((b) => [
    { ...b, practice_code: null, value: Math.round(b.value * 0.72), valid_from: monthsAgo(12) },
    { ...b, practice_code: null, value: Math.round(b.value * 0.86), valid_from: monthsAgo(6) },
    { ...b, practice_code: null, value: b.value, valid_from: monthsAgo(3) },
  ]);
  tariffRows.push({ tariff: "discapacidad_nacional", financiador_id: null, practice_code: null, value: 19870.5, valid_from: monthsAgo(0), notes: "+1,90%" });
  ok(
    await supabase.from("tariffs").insert(tariffRows.map((t) => ({ notes: null, ...t, organization_id: orgId })), { defaultToNull: false }).select("id"),
    "Tarifas",
  );

  // Pacientes con distintos casos
  const CASES: { first: string; last: string; fin: string | null; cud?: boolean; order?: boolean; reason?: string; copago?: number; practice: string; daily?: boolean }[] = [
    { first: "Marta", last: "Acevedo", fin: "OSFATLYF", cud: true, practice: "Kinesiología respiratoria", daily: true },
    { first: "Julio", last: "Bianchi", fin: "Sanidad", practice: "Kinesiología motora" },
    { first: "Lucía", last: "Cáceres", fin: "Jerárquicos", practice: "Kinesiología motora" },
    { first: "Ramón", last: "Domínguez", fin: "PAMI", practice: "Kinesiología motora" },
    { first: "Sofía", last: "Espósito", fin: "IOMA", cud: true, practice: "Kinesiología motora", daily: true },
    { first: "Diego", last: "Ferrari", fin: "IOMA", practice: "Kinesiología motora" },
    { first: "Elena", last: "Giménez", fin: null, practice: "Kinesiología motora" },
    { first: "Pablo", last: "Herrera", fin: "OSDE", practice: "Kinesiología motora" },
    { first: "Camila", last: "Ibáñez", fin: "Sanidad", order: false, practice: "Kinesiología motora" },
    { first: "Héctor", last: "Juárez", fin: "Prevención ART", reason: "accidente_trabajo", practice: "Rehabilitación post accidente" },
    { first: "Julieta", last: "Ledesma", fin: "OSFATLYF", copago: 2500, practice: "Kinesiología motora" },
    { first: "Nicolás", last: "Molina", fin: "PAMI", cud: true, practice: "Kinesiología respiratoria" },
  ];
  const EXTRA = ["Navarro Florencia", "Ojeda Tomás", "Paz Agustina", "Quiroga Roberto", "Rossi Carolina", "Sosa Alberto"];

  const patients = ok(
    await supabase
      .from("patients")
      .insert(
        [
          ...CASES.map((c, i) => ({ first_name: c.first, last_name: c.last, fin: c.fin, cud: c.cud, i })),
          ...EXTRA.map((n, j) => ({ first_name: n.split(" ")[1], last_name: n.split(" ")[0], fin: "Sanidad", cud: false, i: 12 + j })),
        ].map(({ first_name, last_name, fin: f, cud, i }) => {
          const dni = String(14000000 + i * 1234567).slice(0, 8);
          return {
            organization_id: orgId,
            first_name,
            last_name,
            dni,
            cuil: `20${dni}${i % 10}`,
            birth_date: format(subDays(new Date(1950, 0, 1), -(i * 800)), "yyyy-MM-dd"),
            phone: `2262 ${400000 + i * 3711}`,
            address: `Calle ${50 + i} ${1000 + i * 37}, Necochea`,
            obra_social_id: f ? F(f) : null,
            os_affiliate_number: f && f !== "Prevención ART" ? `${16 + i}-${50000 + i * 917}-0/00` : null,
            has_cud: !!cud,
            cud_number: cud ? `ARG-${100000 + i}` : null,
            cud_expiry: cud ? format(addMonths(now, 8), "yyyy-MM-dd") : null,
            diagnosis: ["ACV con secuela motora", "EPOC", "Lumbalgia crónica", "Parkinson", "Post operatorio de rodilla"][i % 5],
            main_professional_id: pros[i % 3],
          };
        }),
        { defaultToNull: false },
      )
      .select("id, first_name, last_name"),
    "Pacientes",
  );

  // Tratamientos + turnos (cada uno con su profesional y horario fijo: no se pisan)
  const monthStart = startOfMonth(addMonths(now, -2));
  const until = addDays(now, 14);
  const today = format(now, "yyyy-MM-dd");
  const appts: Record<string, unknown>[] = [];
  const created: { i: number; treatmentId: string; patientId: string; pro: string }[] = [];
  for (const [i, c] of CASES.entries()) {
    const p = patients[i];
    const proIdx = i % 3;
    const t = ok(
      await supabase
        .from("treatments")
        .insert({
          organization_id: orgId,
          patient_id: p.id,
          professional_id: pros[proIdx],
          practice_name: c.practice,
          practice_code: c.practice.includes("respiratoria") ? "550203" : "25.01.02",
          has_order: c.order !== false,
          order_doctor: c.order === false ? null : "Dr. Juan Pérez",
          order_doctor_matricula: c.order === false ? null : "MP 12345",
          order_diagnosis: "Rehabilitación",
          order_sessions: c.daily ? null : 30,
          order_date: format(monthStart, "yyyy-MM-dd"),
          reason: c.reason ?? "comun",
          financiador_id: c.fin ? F(c.fin) : null,
          auth_number: c.fin && c.fin !== "OSDE" ? `${16 + i}-${10050000 + i * 37}` : null,
          sessions_authorized: c.daily ? 120 : null,
          sessions_per_month: c.daily ? 30 : null,
          period_from: format(monthStart, "yyyy-MM-dd"),
          period_to: format(i === 2 ? addDays(now, 10) : addMonths(now, 4), "yyyy-MM-dd"),
          copago_amount: c.copago ?? null,
          art_siniestro: c.reason === "accidente_trabajo" ? "SIN-2026-0042" : null,
          art_empleador: c.reason === "accidente_trabajo" ? "Cooperativa Eléctrica" : null,
        })
        .select("id")
        .single(),
      "Tratamiento",
    );

    created.push({ i, treatmentId: t.id, patientId: p.id, pro: pros[proIdx] });
    const hour = 8 + Math.floor(i / 3) + (proIdx === 2 ? 6 : 0);
    const proDays = proIdx === 0 ? [0, 1, 2, 3, 4, 5, 6] : proIdx === 1 ? [1, 2, 3, 4, 5] : [1, 3, 5];
    const myDays = c.daily ? proDays : proDays.filter((_, k) => k % 2 === i % 2);
    for (let d = monthStart; d <= until; d = addDays(d, 1)) {
      if (!myDays.includes(getDay(d))) continue;
      const day = format(d, "yyyy-MM-dd");
      const start = arToISO(day, `${String(hour).padStart(2, "0")}:00`);
      appts.push({
        organization_id: orgId,
        patient_id: p.id,
        professional_id: pros[proIdx],
        treatment_id: t.id,
        starts_at: start,
        ends_at: new Date(new Date(start).getTime() + 40 * 60000).toISOString(),
        status: day < today ? ((d.getDate() + i) % 17 === 0 ? "ausente" : "atendido") : (d.getDate() + i) % 9 === 0 ? "cancelado" : "confirmado",
      });
    }
  }
  for (let k = 0; k < appts.length; k += 500) {
    const { error } = await supabase.from("appointments").insert(appts.slice(k, k + 500), { defaultToNull: false });
    if (error) throw new Error(`Turnos: ${error.message}`);
  }

  // Un año de facturas en todos los estados (para el tablero y el balance)
  const PAY_DAYS: Record<string, number> = { OSFATLYF: 60, Sanidad: 60, Jerárquicos: 45, PAMI: 90, IOMA: 120, OSDE: 30, "Prevención ART": 60 };
  const finRows = fin as { id: string; name: string }[];
  const invoices: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const numbers = new Map<string, number>();
  const nextNumber = (pro: string) => {
    const n = (numbers.get(pro) ?? 600) + 1;
    numbers.set(pro, n);
    return n;
  };
  for (let m = 11; m >= 1; m--) {
    const start = startOfMonth(addMonths(now, -m));
    const period = format(start, "yyyy-MM");
    const mid = format(addDays(start, 14), "yyyy-MM-dd");
    const lastDay = format(addDays(startOfMonth(addMonths(start, 1)), -1), "yyyy-MM-dd");
    for (const { i, treatmentId, patientId, pro } of created) {
      const c = CASES[i];
      if (m === 1 && i > 2) continue; // de septiembre solo algunas preparadas; el resto queda para "Preparar facturas"
      const finRow = c.fin ? finRows.find((x) => x.name === c.fin)! : null;
      const rule = applyRules({
        hasOrder: c.order !== false,
        reason: (c.reason ?? "comun") as "comun",
        financiador: c.fin ? { id: F(c.fin), type: ({ PAMI: "pami", IOMA: "ioma", OSDE: "prepaga", "Prevención ART": "art" } as Record<string, FinanciadorType>)[c.fin] ?? "obra_social", default_via: (c.fin === "Jerárquicos" || c.fin === "PAMI" || c.fin === "IOMA" || c.fin === "Prevención ART" ? "convenio" : c.fin === "OSDE" ? "reintegro" : "colegio") as Via } : null,
        via: null,
        cudVigente: !!c.cud,
        copagoAmount: c.copago ?? null,
        affiliateNumber: "x",
        siniestro: "x",
      });
      const unit = pickTariff(tariffRows, { tariff: rule.tariff, financiadorId: rule.tariffFinanciadorId, practiceCode: null, date: mid })?.value ?? 20000;
      const qty = c.daily ? 22 + ((i + m) % 7) : 7 + ((i + m) % 4);
      const toFin = rule.billTo === "financiador";
      const payDays = (c.fin && PAY_DAYS[c.fin]) || 60;

      // Estado según antigüedad
      const issue = addDays(startOfMonth(addMonths(start, 1)), 4 + (i % 5));
      const presented = addDays(issue, 2);
      let status: "preparada" | "emitida" | "presentada" | "cobrada" = "cobrada";
      let paid: Date | null = addDays(presented, payDays + ((i * 7 + m * 3) % 21) - 10);
      if (!toFin) paid = issue; // particulares pagan en el momento
      else if (m === 1) status = "preparada";
      else if (m === 2) status = i % 3 === 0 ? "emitida" : "presentada";
      else if ((i === 3 && m >= 4 && m <= 6) || (i === 5 && (m === 4 || m === 5)) || (i === 1 && m === 4) || (i === 4 && m === 4) || (i === 11 && m === 3) || (i === 0 && m === 3)) status = "presentada"; // nunca pagaron: vencidas
      else if (m === 3 && i % 2 === 1) status = "presentada";
      if (status === "cobrada" && paid && paid > now) status = "presentada";

      const parts: { part: "total" | "financiador" | "copago"; unit: number; toFin: boolean }[] = rule.copago
        ? [{ part: "financiador", unit: unit - (c.copago ?? 0), toFin: true }, { part: "copago", unit: c.copago ?? 0, toFin: false }]
        : [{ part: "total", unit, toFin }];
      for (const pt of parts) {
        const id = crypto.randomUUID();
        const st = pt.toFin ? status : m === 1 ? "preparada" : "cobrada";
        invoices.push({
          id,
          organization_id: orgId,
          kind: pt.toFin ? "obra_social" : rule.kind === "reintegro" ? "reintegro" : "particular",
          patient_id: patientId,
          obra_social_id: finRow?.id ?? null,
          treatment_id: treatmentId,
          professional_id: pro,
          period,
          period_from: format(start, "yyyy-MM-dd"),
          period_to: lastDay,
          status: st,
          part: pt.part,
          rule_case: rule.rule,
          total: pt.unit * qty,
          tipo_comprobante: "C",
          punto_venta: 2,
          arca_number: st === "preparada" ? null : nextNumber(pro),
          issue_date: st === "preparada" ? null : format(issue, "yyyy-MM-dd"),
          cae: st === "preparada" ? null : `8640629${String(7000000 + invoices.length)}`,
          presented_at: st === "presentada" || st === "cobrada" ? format(pt.toFin ? presented : issue, "yyyy-MM-dd") : null,
          presented_channel: st === "presentada" || st === "cobrada" ? "mail" : null,
          paid_at: st === "cobrada" && paid ? format(pt.toFin ? paid : issue, "yyyy-MM-dd") : null,
        });
        items.push({
          invoice_id: id,
          description: invoiceLineText({ practice: c.practice, patient: { first_name: c.first, last_name: c.last }, period, copago: pt.part === "copago" }),
          code: c.practice.includes("respiratoria") ? "550203" : "25.01.02",
          quantity: qty,
          unit_price: pt.unit,
        });
        if (st === "presentada" && m >= 4)
          events.push({ organization_id: orgId, invoice_id: id, kind: "reclamo", text: "Se reclamó el pago: dicen que está en Central." });
      }
    }
  }
  for (const [rows, table] of [[invoices, "invoices"], [items, "invoice_items"], [events, "invoice_events"]] as const) {
    const { error } = await supabase.from(table).insert(rows, { defaultToNull: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  await supabase.from("clinical_entries").insert(
    patients.slice(0, 12).flatMap((p, i) => [
      { organization_id: orgId, patient_id: p.id, professional_id: pros[i % 3], entry_date: format(monthStart, "yyyy-MM-dd"), kind: "consulta", title: "Evaluación inicial", content: "Evaluación de ingreso. Plan de tratamiento y objetivos." },
      { organization_id: orgId, patient_id: p.id, professional_id: pros[i % 3], entry_date: format(subDays(now, 3), "yyyy-MM-dd"), kind: "evolucion", title: "Evolución", content: "Buena tolerancia. Mejora progresiva." },
    ]),
  );


  revalidatePath("/", "layout");
}
