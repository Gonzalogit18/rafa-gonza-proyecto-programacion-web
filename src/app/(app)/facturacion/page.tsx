import { format, parseISO, subMonths } from "date-fns";
import { arToISO, todayAR } from "@/lib/format";
import { INVOICE_SELECT } from "@/lib/invoice-history";
import { mercadoPagoEnabled } from "@/lib/mercadopago";
import { getSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";
import { InvoiceBoard } from "./board";

export default async function FacturacionPage({ searchParams }: PageProps<"/facturacion">) {
  const { q, ver } = (await searchParams) as { q?: string; ver?: string };
  const { supabase, org, myProfessionals, canBill } = await getSession();
  const select = INVOICE_SELECT;
  // En el tablero: lo que está en curso y lo cobrado en los últimos 3 meses. Lo anterior está en /facturacion/cobradas
  const since = format(subMonths(parseISO(todayAR()), 3), "yyyy-MM-dd");
  const [{ data: open }, { data: paid }, { data: linked }, { data: arca }] = await Promise.all([
    supabase.from("invoices").select(select).not("status", "in", "(anulada,cobrada)").order("created_at", { ascending: false }),
    supabase.from("invoices").select(select).eq("status", "cobrada").gte("paid_at", arToISO(since, "00:00")).order("paid_at", { ascending: false }),
    ver ? supabase.from("invoices").select(select).eq("id", ver) : Promise.resolve({ data: [] }),
    supabase.from("arca_credentials").select("professional_id").not("certificate", "is", null).not("punto_venta", "is", null),
  ]);
  const seen = new Set<string>();
  const data = [...(open ?? []), ...(paid ?? []), ...(linked ?? [])].filter((i) => {
    const id = (i as unknown as Invoice).id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return (
    <InvoiceBoard
      invoices={data as unknown as Invoice[]}
      professionals={myProfessionals}
      canEdit={canBill}
      org={org}
      initialQuery={q ?? ""}
      initialOpen={ver ?? null}
      mercadoPago={mercadoPagoEnabled()}
      arcaReady={(arca ?? []).map((a) => a.professional_id)}
    />
  );
}
