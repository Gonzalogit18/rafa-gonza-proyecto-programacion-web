import { addDays, differenceInDays, differenceInYears, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { TZDate } from "@date-fns/tz";
import type { Invoice, InvoiceKind, InvoiceStatus, Role } from "./types";

// Todo horario se muestra en hora argentina, sin importar dónde corra el servidor.
export const TZ = "America/Argentina/Buenos_Aires";
export const nowAR = () => TZDate.tz(TZ);
export const toAR = (d: string | Date) => new TZDate(typeof d === "string" ? new Date(d) : d, TZ);
// "2026-10-06" + "14:30" (hora argentina) -> ISO UTC para guardar
export const arToISO = (date: string, time: string) => new Date(`${date}T${time.slice(0, 5)}:00-03:00`).toISOString();
export const todayAR = () => format(nowAR(), "yyyy-MM-dd");
export const fmtTime = (iso: string) => format(toAR(iso), "HH:mm");

export const money = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);

// "2026-10-06" = fecha sola (se muestra tal cual); "2026-10-06T14:00:00Z" = instante (se pasa a hora argentina)
export const fmtDate = (d: string | Date, pattern = "dd/MM/yyyy") =>
  format(typeof d === "string" ? (d.length > 10 ? toAR(d) : parseISO(d)) : d, pattern, { locale: es });

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const CLINICAL_KIND_LABEL = { consulta: "Consulta", evolucion: "Evolución", estudio: "Estudio", receta: "Receta o indicación", nota: "Nota", otro: "Otro" } as const;

export const monthLabel = (period: string) => fmtDate(`${period}-01`, "MMMM yyyy");

export const age = (birth: string | null) => (birth ? differenceInYears(new Date(), parseISO(birth)) : null);

export const fullName = (p?: { first_name: string; last_name: string } | null) =>
  p ? `${p.last_name}, ${p.first_name}` : "—";

export const invoiceNumber = (inv: Pick<Invoice, "arca_number" | "punto_venta">) =>
  inv.arca_number
    ? `${String(inv.punto_venta ?? 1).padStart(5, "0")}-${String(inv.arca_number).padStart(8, "0")}`
    : "sin número";

export const KIND_LABEL: Record<InvoiceKind, string> = {
  obra_social: "Obra social",
  reintegro: "Reintegro",
  particular: "Particular",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administración",
  secretaria: "Asistente", // en la base el rol se sigue llamando "secretaria"
  profesional: "Profesional",
};

export const CHANNEL_LABEL = { mail: "Mail", papel: "Papel", portal: "Portal web", otro: "Otro" } as const;

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  preparada: "Preparada",
  emitida: "Emitida en ARCA",
  presentada: "Presentada",
  cobrada: "Cobrada",
  anulada: "Anulada",
};

// ---------------------------------------------------------------------
// Tablero de cobros: una columna por etapa del circuito. Las presentadas
// pasan a "alarma" cuando superan el plazo de pago de la obra social.
// ---------------------------------------------------------------------
export type BoardColumn = "preparada" | "emitida" | "presentada" | "vencida" | "cobrada";

export const BOARD_COLUMNS: { id: BoardColumn; title: string; hint: string; color: string; dot: string }[] = [
  { id: "preparada", title: "Para emitir", hint: "", color: "bg-slate-50 border-slate-200", dot: "bg-slate-400" },
  { id: "emitida", title: "Sin presentar", hint: "", color: "bg-sky-50 border-sky-200", dot: "bg-sky-500" },
  { id: "presentada", title: "Presentadas", hint: "", color: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  { id: "vencida", title: "Vencidas", hint: "", color: "bg-rose-50 border-rose-300", dot: "bg-rose-600" },
  { id: "cobrada", title: "Cobradas", hint: "", color: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
];

export const DEFAULT_PAY_DAYS = 60;

// Días desde que se presentó (o se emitió / preparó, si todavía no se presentó)
export function invoiceAgeDays(inv: Pick<Invoice, "presented_at" | "issue_date" | "created_at">) {
  const ref = inv.presented_at ?? inv.issue_date ?? inv.created_at.slice(0, 10);
  return differenceInDays(new Date(), parseISO(ref));
}

export function isOverdue(inv: Pick<Invoice, "status" | "presented_at" | "issue_date" | "created_at" | "obra_social">) {
  if (inv.status !== "presentada") return false;
  return invoiceAgeDays(inv) > (inv.obra_social?.plazo_pago_dias ?? DEFAULT_PAY_DAYS);
}

// Fecha en que vence una factura presentada, según el plazo de pago de su cobertura
export function dueDate(inv: Pick<Invoice, "presented_at" | "obra_social">) {
  if (!inv.presented_at) return null;
  return format(addDays(parseISO(inv.presented_at), inv.obra_social?.plazo_pago_dias ?? DEFAULT_PAY_DAYS), "yyyy-MM-dd");
}

export function boardColumn(inv: Invoice): BoardColumn {
  if (inv.status === "cobrada") return "cobrada";
  if (isOverdue(inv)) return "vencida";
  if (inv.status === "presentada") return "presentada";
  if (inv.status === "emitida") return "emitida";
  return "preparada";
}

export const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Texto estándar del renglón de la factura (como lo escriben hoy en ARCA)
export function invoiceLineText(input: {
  practice: string;
  patient: { first_name: string; last_name: string; dni?: string | null };
  affiliate?: string | null;
  authNumber?: string | null;
  period: string; // yyyy-MM
  // Reintegro: la obra social pide diagnóstico y fechas para no rechazarla
  reintegro?: { diagnosis?: string | null; dates: string[]; financiador?: string | null };
  copago?: boolean;
}) {
  const name = `${input.patient.last_name} ${input.patient.first_name}`.toLowerCase();
  const parts = [`${input.copago ? "copago " : ""}sesiones ${input.practice.toLowerCase()} paciente ${name}`];
  if (input.patient.dni) parts.push(`dni ${input.patient.dni}`);
  if (input.affiliate) parts.push(`afiliado ${input.affiliate}`);
  if (input.authNumber) parts.push(`autorización ${input.authNumber}`);
  parts.push(`correspondiente ${monthLabel(input.period)}`);
  if (input.reintegro) {
    if (input.reintegro.financiador) parts.push(`para reintegro de ${input.reintegro.financiador}`);
    if (input.reintegro.diagnosis) parts.push(`diagnóstico ${input.reintegro.diagnosis.toLowerCase()}`);
    parts.push(`fechas ${input.reintegro.dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(", ")}`);
  }
  return parts.join(" ");
}

export const FINANCIADOR_TYPE_LABEL = {
  obra_social: "Obra social",
  prepaga: "Prepaga",
  pami: "PAMI",
  ioma: "IOMA",
  incluir_salud: "Incluir Salud",
  programa_provincial: "Programa provincial",
  art: "ART",
  seguro: "Seguro",
  otra: "Otra",
} as const;

export const VIA_LABEL = {
  convenio: "Convenio directo",
  colegio: "Por el Colegio",
  reintegro: "Sin convenio, reintegro",
  superintendencia: "Superintendencia de Salud",
  convenio_art: "Convenio directo con ART",
  modulo_cud: "Módulo de discapacidad por CUD",
} as const;

export const REASON_LABEL = {
  comun: "Tratamiento común",
  accidente_trabajo: "Accidente de trabajo",
  accidente_transito: "Accidente de tránsito",
  neurologico: "Neurológico",
  respiratorio: "Respiratorio",
  pediatrico: "Pediátrico",
  otra: "Otra",
} as const;
