"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Button, Card, EmptyState, cn } from "@/components/ui";
import { TARIFF_LABEL } from "@/lib/billing-rules";
import type { BillingRow, UntreatedRow } from "@/lib/billing";
import { STATUS_LABEL, fullName, monthLabel, money } from "@/lib/format";
import { prepareInvoices, prepareUntreated } from "../actions";

type Loose = Record<string, { unit: string; toCoverage: boolean }>;

// Llegando desde una anulada se marca solo esa; si no, todo lo de meses ya terminados (el mes en curso queda sin marcar).
// Las consultas sin tratamiento llevan el precio por sesión a mano (se propone la tarifa de su cobertura).
export function PrepareList({ rows, untreated, thisMonth, marked }: { rows: BillingRow[]; untreated: UntreatedRow[]; thisMonth: string; marked: string | null }) {
  const ready = rows.filter((r) => r.invoices.length === 0 && r.unpriced.length === 0);
  const [loose, setLoose] = useState<Loose>(() =>
    Object.fromEntries(untreated.map((u) => [u.key, { unit: u.suggested != null ? String(u.suggested) : "", toCoverage: !!u.coverage }])),
  );
  const priceOf = (k: string) => Number((loose[k]?.unit ?? "").replace(",", ".")) || 0;
  const [selected, setSelected] = useState<Set<string>>(() => {
    const keys = [...ready, ...untreated.filter((u) => u.suggested != null)].map((r) => ({ key: r.key, period: r.period }));
    return new Set(marked ? keys.filter((r) => r.key === marked).map((r) => r.key) : keys.filter((r) => r.period < thisMonth).map((r) => r.key));
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (rows.length === 0 && untreated.length === 0) return <EmptyState title="No hay sesiones sin facturar" />;
  const periods = [...new Set([...rows, ...untreated].map((r) => r.period))].sort();

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const setLooseRow = (k: string, patch: Partial<Loose[string]>) => setLoose((l) => ({ ...l, [k]: { ...l[k], ...patch } }));
  const chosen = ready.filter((r) => selected.has(r.key));
  const chosenLoose = untreated.filter((u) => selected.has(u.key) && priceOf(u.key) > 0);
  const total = chosen.reduce((s, r) => s + r.total, 0) + chosenLoose.reduce((s, u) => s + priceOf(u.key) * u.dates.length, 0);
  const count = chosen.length + chosenLoose.length;

  const submit = () =>
    start(async () => {
      const results = [];
      if (chosen.length) results.push(await prepareInvoices(chosen.map((c) => c.key)));
      if (chosenLoose.length && !results.some((r) => r.error))
        results.push(await prepareUntreated(chosenLoose.map((u) => ({ key: u.key, unit: priceOf(u.key), toCoverage: loose[u.key].toCoverage }))));
      const failed = results.find((r) => r.error);
      setMsg(failed ? { ok: false, text: failed.error! } : { ok: true, text: results.map((r) => r.message).join(" ") || "Listo." });
    });

  return (
    <div className="space-y-4">
      {periods.map((period) => (
        <section key={period}>
          <h2 className="mb-2 text-sm font-semibold capitalize text-slate-700">
            {monthLabel(period)}
            {period === thisMonth && <span className="font-normal normal-case text-slate-500"> · mes en curso</span>}
          </h2>
          <Card className="divide-y divide-slate-100">
            {rows.filter((r) => r.period === period).map((r) => {
              const done = r.invoices.length > 0;
              const blocked = r.unpriced.length > 0;
              return (
                <label key={r.key} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !done && !blocked && "cursor-pointer hover:bg-slate-50")}>
                  <input type="checkbox" disabled={done || blocked} checked={!done && !blocked && selected.has(r.key)} onChange={() => toggle(r.key)} className="h-4 w-4 accent-teal-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <Link href={`/pacientes/${r.patient.id}?tab=facturacion`} className="hover:text-teal-700">{fullName(r.patient)}</Link>
                      <span className="font-normal text-slate-500"> · {r.treatment.practice_name}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      <Badge className={r.rule.billTo === "paciente" ? "bg-slate-100 text-slate-700" : "bg-sky-50 text-sky-700"}>
                        {r.rule.billTo === "paciente" ? (r.rule.kind === "reintegro" ? "Reintegro" : "Particular") : r.treatment.financiador?.name}
                      </Badge>
                      <Badge className="bg-slate-50 text-slate-600">{r.treatment.manual_value != null ? "Valor fijo" : r.treatment.custom_tariff ? r.treatment.custom_tariff : TARIFF_LABEL[r.rule.tariff]}</Badge>
                      {r.rule.copago && <Badge className="bg-violet-50 text-violet-700">Copago {money(r.copagoTotal)}</Badge>}
                      {r.rule.missing.map((m) => <Badge key={m} className="bg-amber-50 text-amber-700">Falta {m}</Badge>)}
                      {blocked && <Badge className="bg-rose-50 text-rose-700">Sin tarifa cargada</Badge>}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-slate-500">
                      {r.lines.map((l, i) => <span key={i} className="block">{l.quantity} × {money(l.unit)}</span>)}
                      {blocked && <span className="block">{r.dates.length} sesiones</span>}
                    </p>
                    <p className="font-semibold">{money(r.total)}</p>
                  </div>
                  {done && <Badge className="bg-emerald-100 text-emerald-700">{r.invoices.map((i) => STATUS_LABEL[i.status]).join(" + ")}</Badge>}
                </label>
              );
            })}

            {untreated.filter((u) => u.period === period).map((u) => {
              const st = loose[u.key];
              const unit = priceOf(u.key);
              return (
                <div key={u.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input type="checkbox" disabled={unit <= 0} checked={unit > 0 && selected.has(u.key)} onChange={() => toggle(u.key)} className="h-4 w-4 accent-teal-600" aria-label="Elegir" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <Link href={`/pacientes/${u.patient.id}?tab=facturacion`} className="hover:text-teal-700">{fullName(u.patient)}</Link>
                      <span className="font-normal text-slate-500"> · sin tratamiento</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      {u.coverage ? (
                        <select
                          value={st.toCoverage ? "cobertura" : "particular"}
                          onChange={(e) => setLooseRow(u.key, { toCoverage: e.target.value === "cobertura" })}
                          aria-label="A quién se factura"
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="cobertura">{u.coverage.name}</option>
                          <option value="particular">Particular</option>
                        </select>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-700">Particular</Badge>
                      )}
                      {unit <= 0 && <Badge className="bg-rose-50 text-rose-700">Poné el precio</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">{u.dates.length} ×</span>
                    <span className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                      <input
                        inputMode="decimal"
                        value={st.unit}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d.,]/g, "");
                          setLooseRow(u.key, { unit: v });
                          if (Number(v.replace(",", ".")) > 0) setSelected((s) => new Set(s).add(u.key));
                        }}
                        aria-label="Precio por sesión"
                        className="w-28 rounded-md border border-slate-300 py-1.5 pl-5 pr-2 text-right"
                      />
                    </span>
                    <span className="w-24 text-right font-semibold">{money(unit * u.dates.length)}</span>
                  </div>
                </div>
              );
            })}
          </Card>
        </section>
      ))}

      {msg && (
        <p className={msg.ok ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" : "rounded-lg bg-rose-50 p-3 text-sm text-rose-700"}>
          {msg.text} {msg.ok && <Link href="/facturacion" className="font-medium underline">Ver tablero</Link>}
        </p>
      )}

      {(ready.length > 0 || untreated.length > 0) && (
        <div className="flex items-center justify-end gap-4">
          <p className="text-sm text-slate-600">
            {count} · <b>{money(total)}</b>
          </p>
          <Button disabled={pending || count === 0} onClick={submit}>
            {pending ? "Preparando…" : "Preparar facturas"}
          </Button>
        </div>
      )}
    </div>
  );
}
