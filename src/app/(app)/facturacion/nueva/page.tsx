import { PageHeader } from "@/components/ui";
import { TARIFF_LABEL } from "@/lib/billing-rules";
import { todayAR } from "@/lib/format";
import { requireRole } from "@/lib/session";
import type { ObraSocial, Patient, Tariff } from "@/lib/types";
import { NewInvoiceForm, type TariffOption } from "./form";

export default async function NuevaFacturaPage() {
  const { supabase, myProfessionals } = await requireRole("admin", "secretaria", "profesional");
  const [{ data: patients }, { data: os }, { data: tariffRows }, { data: treatments }] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name, dni, obra_social_id, main_professional_id").is("archived_at", null).order("last_name"),
    supabase.from("obras_sociales").select("*").is("archived_at", null).order("name"),
    supabase.from("tariffs").select("*").lte("valid_from", todayAR()).order("valid_from", { ascending: false }),
    supabase.from("treatments").select("patient_id, financiador_id").not("financiador_id", "is", null),
  ]);
  const obras = (os ?? []) as ObraSocial[];

  // De cada tarifa, el valor vigente hoy
  const seen = new Set<string>();
  const tariffs: TariffOption[] = [];
  for (const t of (tariffRows ?? []) as Tariff[]) {
    const key = `${t.tariff}|${t.financiador_id ?? ""}|${t.practice_code ?? ""}|${t.custom_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fin = obras.find((o) => o.id === t.financiador_id)?.name;
    const name = t.custom_name ?? t.practice_name ?? fin ?? TARIFF_LABEL[t.tariff];
    tariffs.push({ id: t.id, label: t.practice_code ? `${name} (${t.practice_code})` : name, code: t.practice_code, value: Number(t.value), financiadorId: t.financiador_id });
  }
  tariffs.sort((a, b) => a.label.localeCompare(b.label));

  // Coberturas de cada paciente: la de su ficha y las de sus tratamientos
  const coverages: Record<string, string[]> = {};
  const add = (pid: string, oid: string | null) => {
    if (!oid) return;
    coverages[pid] ??= [];
    if (!coverages[pid].includes(oid)) coverages[pid].push(oid);
  };
  for (const p of patients ?? []) add(p.id, p.obra_social_id);
  for (const t of treatments ?? []) add(t.patient_id, t.financiador_id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Factura manual" />
      <NewInvoiceForm patients={(patients ?? []) as Patient[]} obrasSociales={obras} professionals={myProfessionals} tariffs={tariffs} patientCoverages={coverages} />
    </div>
  );
}
