// Tipos que reflejan las tablas de supabase/schema.sql
import type { FinanciadorType, Reason, TariffKey, Via } from "./billing-rules";

export type { FinanciadorType, Reason, TariffKey, Via };

export type Role = "admin" | "secretaria" | "profesional";
export type CondicionIva = "monotributo" | "responsable_inscripto" | "exento";

export interface Organization {
  id: string;
  name: string;
  razon_social: string | null;
  cuit: string | null;
  condicion_iva: CondicionIva | null;
  punto_venta: number | null;
  ingresos_brutos: string | null;
  inicio_actividades: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  plan: "base" | "medium" | "platinum";
}

export interface Profile {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  role: Role;
  active: boolean;
  avatar_path: string | null;
}

export interface Professional {
  id: string;
  profile_id: string | null;
  full_name: string;
  specialty: string | null;
  matricula: string | null;
  color: string;
  cuit: string | null;
  condicion_iva: CondicionIva | null;
  punto_venta: number | null;
  work_days: number[];
  work_start: string;
  work_end: string;
  slot_minutes: number;
  active: boolean;
}

export interface Invitation {
  code: string;
  role: Role;
  professional_id: string | null;
  email: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

export type PresentationChannel = "mail" | "papel" | "portal" | "otro";

export interface ObraSocial {
  id: string;
  type: FinanciadorType;
  default_via: Via;
  name: string;
  razon_social: string | null;
  cuit: string | null;
  condicion_iva: string | null;
  address: string | null;
  codigo: string | null;
  presentation_channel: PresentationChannel;
  presentation_email: string | null;
  contact: string | null;
  plazo_presentacion_dias: number | null;
  plazo_pago_dias: number | null;
  requirements: string | null;
  archived_at: string | null;
}

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  dni: string | null;
  cuil: string | null;
  birth_date: string | null;
  sex: "F" | "M" | "X" | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tutor_name: string | null;
  tutor_dni: string | null;
  tutor_phone: string | null;
  obra_social_id: string | null;
  os_plan: string | null;
  os_affiliate_number: string | null;
  credential_file_path: string | null;
  has_cud: boolean;
  cud_number: string | null;
  cud_diagnosis: string | null;
  cud_issued: string | null;
  cud_expiry: string | null;
  cud_file_path: string | null;
  diagnosis: string | null;
  consult_reason: string | null;
  background: string | null;
  main_professional_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  obra_social?: Pick<ObraSocial, "id" | "name" | "type"> | null;
}

export type ClinicalKind = "consulta" | "evolucion" | "estudio" | "receta" | "nota" | "otro";

export interface ClinicalEntry {
  id: string;
  patient_id: string;
  author_id: string | null;
  entry_date: string;
  kind: ClinicalKind;
  title: string;
  content: string;
  voided_at: string | null;
  void_reason: string | null;
  appointment_id: string | null;
  treatment_id: string | null;
  created_at: string;
  author?: Pick<Profile, "full_name"> | null;
}

export interface Treatment {
  id: string;
  patient_id: string;
  professional_id: string | null;
  practice_name: string;
  practice_code: string | null;
  has_order: boolean;
  order_doctor: string | null;
  order_doctor_matricula: string | null;
  order_diagnosis: string | null;
  order_sessions: number | null;
  order_date: string | null;
  order_file_path: string | null;
  reason: Reason;
  financiador_id: string | null;
  via: Via | null;
  auth_number: string | null;
  sessions_authorized: number | null;
  sessions_per_month: number | null;
  period_from: string | null;
  period_to: string | null;
  auth_file_path: string | null;
  copago_amount: number | null;
  art_siniestro: string | null;
  art_empleador: string | null;
  manual_value: number | null;
  custom_tariff: string | null;
  reason_other: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  patient?: (Pick<Patient, "id" | "first_name" | "last_name"> & Partial<Pick<Patient, "dni" | "os_plan" | "os_affiliate_number">>) | null;
  financiador?: Pick<ObraSocial, "id" | "name" | "type" | "default_via"> | null;
}

export interface TariffReference {
  id: string;
  tariff: TariffKey;
  value: number;
  valid_from: string;
  source: string;
  source_url: string | null;
  checked_at: string;
}

export interface Tariff {
  id: string;
  tariff: TariffKey;
  custom_name: string | null;
  financiador_id: string | null;
  practice_code: string | null;
  practice_name: string | null;
  value: number;
  valid_from: string;
  notes: string | null;
}

export type AppointmentStatus = "confirmado" | "atendido" | "ausente" | "cancelado";

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  treatment_id: string | null;
  package_id: string | null;
  session_number: number | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  is_overbook: boolean;
  in_conflict: boolean;
  series_id: string | null;
  notes: string | null;
  patient?: Pick<Patient, "id" | "first_name" | "last_name" | "phone"> | null;
  package?: { name: string; total_sessions: number } | null;
  treatment?: Pick<Treatment, "id" | "practice_name"> | null;
}

export type InvoiceKind = "obra_social" | "reintegro" | "particular";
export type InvoiceStatus = "preparada" | "emitida" | "presentada" | "cobrada" | "anulada";

export interface InvoiceItem {
  id?: string;
  description: string;
  code: string | null;
  quantity: number;
  unit_price: number;
}

export interface InvoiceEvent {
  id: string;
  kind: "estado" | "nota" | "reclamo";
  text: string;
  created_at: string;
  author?: Pick<Profile, "full_name"> | null;
}

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  patient_id: string | null;
  obra_social_id: string | null;
  treatment_id: string | null;
  professional_id: string | null;
  period: string | null;
  period_from: string | null;
  period_to: string | null;
  status: InvoiceStatus;
  part: "total" | "financiador" | "copago";
  rule_case: number | null;
  total: number;
  notes: string | null;
  tipo_comprobante: string | null;
  punto_venta: number | null;
  arca_number: number | null;
  issue_date: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  arca_pdf_path: string | null;
  attendance_file_path?: string | null;
  presented_at: string | null;
  presented_channel: PresentationChannel | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  patient?: Pick<Patient, "id" | "first_name" | "last_name" | "dni" | "os_affiliate_number"> | null;
  obra_social?: Pick<ObraSocial, "id" | "name" | "razon_social" | "cuit" | "condicion_iva" | "address" | "plazo_pago_dias" | "presentation_channel" | "presentation_email"> | null;
  treatment?: Pick<Treatment, "id" | "practice_name" | "auth_number"> | null;
  professional?: Pick<Professional, "id" | "full_name" | "cuit" | "condicion_iva" | "matricula" | "specialty"> | null;
  items?: InvoiceItem[];
  events?: InvoiceEvent[];
}
