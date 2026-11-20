import type { AppointmentStatus } from "@/lib/types";

// El color del turno depende de su estado (no del profesional). Bloques planos, con borde completo
export const STATUS_STYLE: Record<AppointmentStatus, { label: string; badge: string; block: string }> = {
  confirmado: { label: "Confirmado", badge: "bg-sky-100 text-sky-800", block: "bg-sky-100 border-sky-200 text-sky-800" },
  atendido: { label: "Atendido", badge: "bg-teal-100 text-teal-800", block: "bg-teal-100 border-[#AFCFC7] text-teal-800" },
  ausente: { label: "Ausente", badge: "bg-amber-100 text-amber-800", block: "bg-amber-100 border-amber-200 text-amber-800" },
  cancelado: { label: "Cancelado", badge: "bg-slate-100 text-slate-500", block: "bg-white border-dashed border-[#B5B1A8] text-slate-500 [&_p:first-child]:line-through" },
};

export const STATUS_ORDER: AppointmentStatus[] = ["confirmado", "atendido", "ausente", "cancelado"];

// Sobreturno: borde sólido y rayas violetas, para no confundirse con el punteado de Cancelado.
export const OVERBOOK_BLOCK = "border-violet-400 bg-[repeating-linear-gradient(135deg,#E9E1F7_0,#E9E1F7_4px,#FFFFFF_4px,#FFFFFF_8px)] text-violet-800";
