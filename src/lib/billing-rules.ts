// Reglas de facturación de la clínica (ver docs/RELEVAMIENTO-CLINICA.md).
// Se evalúan EN ORDEN y gana la primera que se cumple. Sin dependencias: se testea con scripts/test-rules.ts.

export type FinanciadorType =
  | "obra_social"
  | "prepaga"
  | "pami"
  | "ioma"
  | "incluir_salud"
  | "programa_provincial"
  | "art"
  | "seguro"
  | "otra";

export type Via = "convenio" | "colegio" | "reintegro" | "superintendencia" | "convenio_art" | "modulo_cud";
export type Reason = "comun" | "accidente_trabajo" | "accidente_transito" | "neurologico" | "respiratorio" | "pediatrico" | "otra";

export type TariffKey =
  | "discapacidad_nacional"
  | "discapacidad_ioma"
  | "discapacidad_provincial"
  | "incluir_salud"
  | "colegio"
  | "convenio"
  | "pami"
  | "ioma"
  | "art"
  | "seguro"
  | "particular"
  | "superintendencia"
  | "propia";

export const TARIFF_LABEL: Record<TariffKey, string> = {
  discapacidad_nacional: "Nomenclador discapacidad nacional",
  discapacidad_ioma: "Nomenclador discapacidad IOMA",
  discapacidad_provincial: "Nomenclador discapacidad provincial",
  incluir_salud: "Incluir Salud",
  colegio: "Colegio de Kinesiología",
  convenio: "Convenio directo",
  pami: "PAMI",
  ioma: "IOMA",
  art: "ART",
  seguro: "Seguro",
  particular: "Particular",
  superintendencia: "Superintendencia de Salud",
  propia: "Tarifa propia",
};

// Tarifas que dependen de un financiador puntual (cada uno tiene su valor)
export const TARIFF_PER_FINANCIADOR: TariffKey[] = ["convenio", "art", "seguro"];

export interface RuleInput {
  hasOrder: boolean;
  reason: Reason;
  financiador: { id: string; type: FinanciadorType; default_via: Via } | null;
  via: Via | null; // la del tratamiento; si es null se usa la del financiador
  cudVigente: boolean;
  copagoAmount: number | null;
  affiliateNumber: string | null;
  siniestro: string | null;
}

export interface RuleResult {
  rule: number; // 1 a 15
  label: string;
  billTo: "financiador" | "paciente";
  kind: "obra_social" | "reintegro" | "particular";
  tariff: TariffKey;
  tariffFinanciadorId: string | null;
  copago: boolean;
  missing: string[]; // datos que faltan para poder facturar
}

const isOS = (t: FinanciadorType) => t === "obra_social" || t === "prepaga" || t === "otra";

export function applyRules(i: RuleInput): RuleResult {
  const f = i.financiador;
  const via = i.via ?? f?.default_via ?? null;
  const missing: string[] = [];
  const copago = (i.copagoAmount ?? 0) > 0;

  const toFinanciador = (rule: number, label: string, tariff: TariffKey, withCopago = true): RuleResult => {
    if (!i.affiliateNumber && f && f.type !== "art" && f.type !== "seguro") missing.push("N° de afiliado");
    return {
      rule,
      label,
      billTo: "financiador",
      kind: "obra_social",
      tariff,
      tariffFinanciadorId: TARIFF_PER_FINANCIADOR.includes(tariff) ? f?.id ?? null : null,
      copago: withCopago && copago,
      missing,
    };
  };
  const toPatient = (rule: number, label: string, kind: "particular" | "reintegro" = "particular"): RuleResult => ({
    rule,
    label,
    billTo: "paciente",
    kind,
    tariff: "particular",
    tariffFinanciadorId: null,
    copago: false,
    missing,
  });

  // 1. Sin orden médica → particular, siempre
  if (!i.hasOrder) return toPatient(1, "Sin orden médica: particular");

  // 2. Accidente de trabajo → ART, con N° de siniestro
  if (i.reason === "accidente_trabajo") {
    if (!f || f.type !== "art") missing.push("ART como cobertura");
    if (!i.siniestro) missing.push("N° de siniestro");
    return toFinanciador(2, "Accidente de trabajo: ART", "art", false);
  }

  // 3. Accidente de tránsito → seguro (o particular si no hay)
  if (i.reason === "accidente_transito") {
    if (f?.type === "seguro") return toFinanciador(3, "Accidente de tránsito: seguro", "seguro", false);
    return toPatient(3, "Accidente de tránsito sin seguro: particular");
  }

  if (i.cudVigente) {
    // 4. CUD + IOMA → nomenclador de discapacidad de IOMA
    if (f?.type === "ioma") return toFinanciador(4, "CUD + IOMA: nomenclador discapacidad IOMA", "discapacidad_ioma");
    // 5. CUD + obra social, prepaga o PAMI → nomenclador nacional de discapacidad
    if (f && (isOS(f.type) || f.type === "pami"))
      return toFinanciador(5, "CUD: nomenclador nacional de discapacidad", "discapacidad_nacional");
    // 6. CUD sin cobertura → Incluir Salud o programa provincial
    if (f?.type === "programa_provincial")
      return toFinanciador(6, "CUD: programa provincial", "discapacidad_provincial");
    if (f?.type === "incluir_salud") return toFinanciador(6, "CUD: Incluir Salud", "incluir_salud");
    if (!f) {
      missing.push("Incluir Salud o programa provincial como cobertura");
      return { ...toFinanciador(6, "CUD sin cobertura: Incluir Salud o programa provincial", "incluir_salud"), missing };
    }
  }

  if (f) {
    // 13 a 15. Vías pedidas por la clínica. Regla provisoria: hay que confirmar cómo se cobra cada una
    if (via === "superintendencia") return toFinanciador(13, "Por Superintendencia de Salud", "superintendencia");
    if (via === "convenio_art") return toFinanciador(14, "Convenio directo con ART", "art");
    if (via === "modulo_cud") {
      missing.push("CUD vigente");
      return toFinanciador(15, "Módulo de discapacidad por CUD", "discapacidad_nacional");
    }
    // 11 (antes que 7–10). Con cobertura pero sin convenio → particular, factura para reintegro
    if (via === "reintegro") return toPatient(11, "Sin convenio: particular con factura para reintegro", "reintegro");
    // 7. Obra social por el Colegio → valores del Colegio de Kinesiología
    if (isOS(f.type) && via === "colegio") return toFinanciador(7, "Obra social por el Colegio", "colegio");
    // 8. Obra social o prepaga con convenio directo → valor del convenio
    if (isOS(f.type) && via === "convenio") return toFinanciador(8, "Convenio directo", "convenio");
    // 9. PAMI → valores de PAMI
    if (f.type === "pami") return toFinanciador(9, "PAMI", "pami");
    // 10. IOMA → valores de IOMA comunes
    if (f.type === "ioma") return toFinanciador(10, "IOMA", "ioma");
    // Programas de discapacidad sin CUD vigente: no corresponde cubrir
    if (f.type === "incluir_salud" || f.type === "programa_provincial") {
      missing.push("CUD vigente");
      return toPatient(12, "Programa de discapacidad sin CUD vigente: particular");
    }
    if (f.type === "art" || f.type === "seguro") return toPatient(12, "ART o seguro sin accidente: particular");
  }

  // 12. Sin cobertura y sin CUD → particular
  return toPatient(12, "Sin cobertura: particular");
}

// ---------------------------------------------------------------------
// Tarifas con vigencia
// ---------------------------------------------------------------------
export interface TariffRow {
  tariff: TariffKey;
  custom_name?: string | null;
  financiador_id: string | null;
  practice_code: string | null;
  value: number;
  valid_from: string; // yyyy-MM-dd
}

/** Valor vigente a una fecha. Prefiere la tarifa con el mismo código de práctica; si no, la genérica. */
export function pickTariff(
  rows: TariffRow[],
  q: { tariff: TariffKey; financiadorId: string | null; practiceCode: string | null; date: string; customName?: string | null },
): TariffRow | null {
  const candidates = rows.filter(
    (r) =>
      (q.customName ? r.tariff === "propia" && r.custom_name === q.customName : r.tariff === q.tariff) &&
      r.valid_from <= q.date &&
      (q.customName || !TARIFF_PER_FINANCIADOR.includes(q.tariff) || r.financiador_id === q.financiadorId) &&
      (r.practice_code === null || r.practice_code === "" || r.practice_code === q.practiceCode),
  );
  const exact = candidates.filter((r) => r.practice_code && r.practice_code === q.practiceCode);
  const pool = exact.length ? exact : candidates;
  return pool.sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;
}

/** Arma los renglones de un mes: agrupa las sesiones por valor (si la tarifa cambió a mitad de mes salen dos renglones). */
export function priceSessions(
  dates: string[],
  valueFor: (date: string) => number | null,
): { lines: { from: string; to: string; quantity: number; unit: number }[]; total: number; unpriced: string[] } {
  const lines: { from: string; to: string; quantity: number; unit: number }[] = [];
  const unpriced: string[] = [];
  for (const d of [...dates].sort()) {
    const v = valueFor(d);
    if (v === null) {
      unpriced.push(d);
      continue;
    }
    const last = lines[lines.length - 1];
    if (last && last.unit === v) {
      last.quantity++;
      last.to = d;
    } else lines.push({ from: d, to: d, quantity: 1, unit: v });
  }
  return { lines, total: lines.reduce((s, l) => s + l.quantity * l.unit, 0), unpriced };
}
