import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { fmtDate, fullName, monthLabel, money } from "@/lib/format";
import { INVOICE_SELECT, historyQuery, type HistoryRow } from "@/lib/invoice-history";
import { getSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";
import { InvoiceOverlay } from "./invoice-overlay";

const PAGE = 50;

// Todas las facturas cobradas: buscador por fecha de cobro y por obra social
export default async function CobradasPage({ searchParams }: PageProps<"/facturacion/cobradas">) {
  const sp = (await searchParams) as { desde?: string; hasta?: string; q?: string; pagina?: string; ver?: string; prof?: string };
  const { supabase, org, canBill, myProfessionals } = await getSession();
  const prof = sp.prof === "clinica" || myProfessionals.some((p) => p.id === sp.prof) ? sp.prof! : myProfessionals[0]?.id ?? "clinica";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { query } = await historyQuery(supabase, { ...sp, prof });
  const { data, count } = await query.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as HistoryRow[];
  const total = count ?? 0;
  const params = new URLSearchParams(Object.entries({ prof, desde: sp.desde, hasta: sp.hasta, q: sp.q }).filter(([, v]) => v) as [string, string][]);
  const exportParams = params.toString();
  if (page > 1) params.set("pagina", String(page));
  const listHref = `/facturacion/cobradas?${params}`;
  const openHref = (id: string) => `${listHref}${params.size ? "&" : ""}ver=${id}`;
  const { data: opened } = sp.ver ? await supabase.from("invoices").select(INVOICE_SELECT).eq("id", sp.ver).maybeSingle() : { data: null };
  const pageHref = (n: number) => {
    const u = new URLSearchParams(params);
    u.set("pagina", String(n));
    return `/facturacion/cobradas?${u}`;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/facturacion" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> Facturación</Link>
      <PageHeader
        title="Facturas cobradas"
        actions={
          <a href={`/facturacion/exportar?${exportParams}`} className={buttonClass("secondary")}>
            <Download size={16} /> Descargar Excel
          </a>
        }
      />

      <Card className="mb-4 p-4">
        <form className="grid items-end gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1.4fr_auto]">
          <Field label="Profesional">
            <Select name="prof" defaultValue={prof}>
              {myProfessionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              <option value="clinica">A nombre de la clínica</option>
            </Select>
          </Field>
          <Field label="Cobrada desde"><Input type="date" name="desde" defaultValue={sp.desde} /></Field>
          <Field label="Hasta"><Input type="date" name="hasta" defaultValue={sp.hasta} /></Field>
          <Field label="Obra social"><Input name="q" defaultValue={sp.q} placeholder="Escribí el nombre" /></Field>
          <Button type="submit">Buscar</Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No hay facturas cobradas con esos filtros" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Cobrada</th>
                <th className="px-4 py-2">Paciente</th>
                <th className="hidden px-4 py-2 sm:table-cell">Cobertura</th>
                <th className="hidden px-4 py-2 sm:table-cell">Período</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap"><Link href={openHref(r.id)} scroll={false} className="hover:text-teal-700">{r.paid_at ? fmtDate(r.paid_at) : "—"}</Link></td>
                  <td className="px-4 py-2 font-medium"><Link href={openHref(r.id)} scroll={false} className="hover:text-teal-700">{fullName(r.patient)}</Link></td>
                  <td className="hidden px-4 py-2 text-slate-600 sm:table-cell">{r.part === "copago" ? "Copago" : r.obra_social?.name ?? "Particular"}</td>
                  <td className="hidden px-4 py-2 capitalize text-slate-600 sm:table-cell">{r.period ? monthLabel(r.period) : "—"}</td>
                  <td className="px-4 py-2 text-right font-medium">{money(Number(r.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {opened && <InvoiceOverlay inv={opened as unknown as Invoice} org={org} canEdit={canBill} backHref={listHref} />}

      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>{total} facturas</span>
          <div className="flex gap-3">
            {page > 1 && <Link href={pageHref(page - 1)} className="text-teal-700 hover:underline">Anteriores</Link>}
            {page * PAGE < total && <Link href={pageHref(page + 1)} className="text-teal-700 hover:underline">Ver más</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
