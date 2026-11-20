"use client";

import { useRouter } from "next/navigation";
import type { Invoice, Organization } from "@/lib/types";
import { InvoiceDetail } from "../board";

// La factura se abre encima de la lista y al cerrarla se vuelve a la misma búsqueda
export function InvoiceOverlay({ inv, org, canEdit, backHref }: { inv: Invoice; org: Organization; canEdit: boolean; backHref: string }) {
  const router = useRouter();
  return <InvoiceDetail inv={inv} org={org} canEdit={canEdit} onClose={() => router.push(backHref, { scroll: false })} />;
}
