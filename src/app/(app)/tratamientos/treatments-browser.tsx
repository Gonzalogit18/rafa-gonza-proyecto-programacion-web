"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/modal";
import { Card, EmptyState } from "@/components/ui";
import { fmtDate, fullName } from "@/lib/format";
import { matchesSearch } from "@/lib/search";
import type { TreatmentWithUsage } from "@/lib/treatments";
import { TreatmentCard, type TreatmentOpts } from "./treatment-ui";
import { TreatmentDetail } from "./treatment-detail";

// Buscador + vista de tarjetas (activos) o lista compacta (archivados)
export function TreatmentsBrowser({ list, opts, compact }: { list: TreatmentWithUsage[]; opts: TreatmentOpts; compact: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<TreatmentWithUsage | null>(null);
  const shown = useMemo(
    () => list.filter((x) => matchesSearch([x.patient?.last_name, x.patient?.first_name, x.practice_name, x.financiador?.name, x.auth_number], q)),
    [list, q],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No hay tratamientos" />
      ) : compact ? (
        <Card className="divide-y divide-slate-100">
          {shown.slice(0, 200).map((t) => (
            <button key={t.id} onClick={() => setOpen(t)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
              <span className="truncate">
                <span className="font-medium">{fullName(t.patient)}</span>
                <span className="text-slate-500"> · {t.practice_name} · {t.financiador?.name ?? "Particular"}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{t.archived_at ? `Archivado ${fmtDate(t.archived_at)}` : ""}</span>
            </button>
          ))}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => <TreatmentCard key={t.id} t={t} opts={opts} showPatient canEdit />)}
        </div>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${fullName(open.patient)} · ${open.practice_name}`} size="xl">
          <TreatmentDetail t={open} professional={opts.professionals.find((p) => p.id === open.professional_id)?.full_name} canEdit onClose={() => setOpen(null)} />
        </Modal>
      )}
    </div>
  );
}
