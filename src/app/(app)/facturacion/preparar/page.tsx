import { PageHeader } from "@/components/ui";
import { fetchBillingRows } from "@/lib/billing";
import { todayAR } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { PrepareList } from "./prepare-list";

// Todas las sesiones atendidas que todavía no tienen factura, de cualquier mes (con tratamiento o consultas sueltas)
export default async function PrepararPage({ searchParams }: PageProps<"/facturacion/preparar">) {
  const { marcar } = (await searchParams) as { marcar?: string };
  const { supabase } = await requireRole("admin", "secretaria", "profesional");
  const { rows, untreated } = await fetchBillingRows(supabase, {});
  const byMonth = <T extends { period: string; patient: { last_name: string } }>(a: T, b: T) =>
    a.period.localeCompare(b.period) || a.patient.last_name.localeCompare(b.patient.last_name);
  const pending = rows.filter((r) => r.invoices.length === 0).sort(byMonth);
  const loose = untreated.filter((u) => !u.invoiced).sort(byMonth);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Preparar facturas" />
      <PrepareList rows={pending} untreated={loose} thisMonth={todayAR().slice(0, 7)} marked={marcar ?? null} />
    </div>
  );
}
