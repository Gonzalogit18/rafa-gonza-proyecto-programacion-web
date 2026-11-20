import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { fmtDate, fullName, monthLabel, money } from "@/lib/format";
import { getSession } from "@/lib/session";
import { fetchVoided } from "@/lib/voided";

// Facturas anuladas del último año. Las que no se rehicieron quedan arriba: si no, esa plata no se cobra.
export default async function AnuladasPage() {
  const { supabase } = await getSession();
  const list = await fetchVoided(supabase);
  const sorted = [...list.filter((v) => !v.redone), ...list.filter((v) => v.redone)];
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/facturacion" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> Facturación</Link>
      <PageHeader title="Facturas anuladas" />
      {sorted.length === 0 ? (
        <EmptyState title="No hay facturas anuladas en el último año" />
      ) : (
        <Card className="divide-y divide-slate-100">
          {sorted.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <b>{fullName(v.patient)}</b> · {money(Number(v.total))}
                <span className="block text-xs text-slate-500">
                  {v.obra_social?.name ?? "Particular"}
                  {v.period && <span className="capitalize"> · {monthLabel(v.period)}</span>} · Anulada el {fmtDate(v.voided_at)}
                  {v.void_reason && `: ${v.void_reason}`}
                </span>
              </span>
              {v.redone ? (
                <Badge className="bg-slate-100 text-slate-600">Ya se rehizo</Badge>
              ) : v.period && v.treatment_id ? (
                <Link href={`/facturacion/preparar?marcar=${encodeURIComponent(`${v.treatment_id}|${v.period}`)}`} className={buttonClass("secondary")}>Preparar de nuevo</Link>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
