"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Select, buttonClass, cn } from "@/components/ui";
import { money as moneyCents } from "@/lib/format";

// En el balance, sin centavos
const money = (n: number) => moneyCents(Math.round(n));

export interface BalanceData {
  year: number;
  month: number | null;
  prof: string | null;
  allowAll: boolean;
  professionals: { id: string; name: string }[];
  kpis: { facturado: number; cobrado: number; pendiente: number; vencido: number; vencidas: number; facturas: number; diasCobro: number | null };
  byMonth: { name: string; cobrado: number; pendiente: number; facturas: number }[];
  aging: { label: string; total: number; count: number }[];
  byFin: { name: string; facturado: number; cobrado: number; pendiente: number; vencido: number; diasCobro: number | null }[];
  byPro: { name: string; color: string; facturado: number; cobrado: number; facturas: number }[];
}

// Paleta validada (daltonismo y contraste): cobrado y por cobrar; vencido es el color de alerta y siempre va con su texto
const C = { cobrado: "#009E8F", pendiente: "#C27C00", vencido: "#B42318", track: "#EFEDE8", axis: "#5F6866" };
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} k` : `$${n}`);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function BalanceDashboard({ data }: { data: BalanceData }) {
  const router = useRouter();
  const { year, month, kpis } = data;
  const href = (o: { y?: number; m?: number | null; p?: string | null }) => {
    const y = o.y ?? year;
    const m = o.m === undefined ? month : o.m;
    const p = o.p === undefined ? data.prof : o.p;
    return `/balance?anio=${y}${m ? `&mes=${m}` : ""}${p ? `&prof=${p}` : ""}`;
  };
  const vencido = data.byFin.reduce((s, f) => s + f.vencido, 0);
  const parts = [
    { label: "Cobrado", value: kpis.cobrado, color: C.cobrado },
    { label: "Por cobrar, en plazo", value: Math.max(0, kpis.pendiente - vencido), color: C.pendiente },
    { label: "Vencido", value: vencido, color: C.vencido },
  ];
  // Las coberturas más grandes; el resto junto en "Otras"
  const top = data.byFin.slice(0, 6);
  const rest = data.byFin.slice(6);
  const fins = rest.length
    ? [...top, { name: "Otras", facturado: rest.reduce((s, f) => s + f.facturado, 0), cobrado: rest.reduce((s, f) => s + f.cobrado, 0), pendiente: rest.reduce((s, f) => s + f.pendiente, 0) }]
    : top;
  const maxFin = Math.max(1, ...fins.map((f) => f.facturado));
  const maxAging = Math.max(1, ...data.aging.map((a) => a.total));

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Balance</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Link href={href({ y: year - 1 })} className={buttonClass("secondary", "w-11 px-0")} aria-label="Año anterior"><ChevronLeft size={18} strokeWidth={1.75} /></Link>
            <span className="w-12 text-center text-sm font-semibold tabular-nums">{year}</span>
            <Link href={href({ y: year + 1 })} className={buttonClass("secondary", "w-11 px-0")} aria-label="Año siguiente"><ChevronRight size={18} strokeWidth={1.75} /></Link>
          </div>
          <div className="w-36">
            <Select aria-label="Mes" value={month ?? ""} onChange={(e) => router.push(href({ m: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">Todo el año</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </div>
          {data.professionals.length > 1 && (
            <div className="w-52">
              <Select aria-label="Profesional" value={data.prof ?? ""} onChange={(e) => router.push(href({ p: e.target.value || null }))}>
                {data.allowAll && <option value="">Toda la clínica</option>}
                {data.professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <Kpi label="Facturado" value={money(kpis.facturado)} sub={`${kpis.facturas} ${kpis.facturas === 1 ? "factura" : "facturas"}`} />
        <Kpi label="Cobrado" value={money(kpis.cobrado)} sub={`${pct(kpis.cobrado, kpis.facturado)}% de lo facturado`} />
        <Kpi label="Por cobrar" value={money(kpis.pendiente)} sub={vencido > 0 ? `${money(vencido)} vencido` : "Nada vencido"} alert={vencido > 0} />
      </div>

      {/* Lo facturado, partido según dónde está la plata */}
      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Qué pasó con lo facturado</h2>
        <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md" style={{ background: C.track }}>
          {kpis.facturado > 0 &&
            parts.filter((p) => p.value > 0).map((p) => (
              <div key={p.label} title={`${p.label}: ${money(p.value)} (${pct(p.value, kpis.facturado)}%)`} style={{ width: `${(p.value / kpis.facturado) * 100}%`, background: p.color }} />
            ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {parts.map((p) => (
            <p key={p.label} className="flex items-baseline gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-sm" style={{ background: p.color }} />
              <span className="text-slate-600">{p.label}</span>
              <span className="ml-auto font-medium tabular-nums text-slate-900 sm:ml-0">{money(p.value)}</span>
              <span className="text-xs tabular-nums text-slate-500">{pct(p.value, kpis.facturado)}%</span>
            </p>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Por mes · {year}</h2>
          <span className="flex gap-4 text-[13px] text-slate-600">
            <Dot color={C.cobrado} label="Cobrado" />
            <Dot color={C.pendiente} label="Por cobrar" />
          </span>
        </div>
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={data.byMonth} barCategoryGap="30%" onClick={(e) => e?.activeTooltipIndex != null && router.push(href({ m: Number(e.activeTooltipIndex) + 1 }))}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} />
              <YAxis tickFormatter={short} tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} width={60} />
              <Tooltip content={<MonthTooltip />} cursor={{ fill: "#F1F0EC" }} />
              <Bar dataKey="cobrado" stackId="a" fill={C.cobrado} stroke="#fff" strokeWidth={2} isAnimationActive={false} className="cursor-pointer" />
              <Bar dataKey="pendiente" stackId="a" fill={C.pendiente} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Por cobertura</h2>
            <span className="flex gap-4 text-[13px] text-slate-600">
              <Dot color={C.cobrado} label="Cobrado" />
              <Dot color={C.pendiente} label="Por cobrar" />
            </span>
          </div>
          <ul className="space-y-3">
            {fins.map((f) => (
              <li key={f.name} className="text-sm" title={`${f.name}: ${money(f.facturado)} facturado, ${money(f.cobrado)} cobrado, ${money(f.pendiente)} por cobrar`}>
                <p className="mb-1 flex justify-between gap-3">
                  <span className="truncate text-slate-700">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">{money(f.facturado)}</span>
                </p>
                <div className="flex h-2.5 gap-[2px]" style={{ width: `${(f.facturado / maxFin) * 100}%` }}>
                  {f.cobrado > 0 && <span className="rounded-l-sm" style={{ flex: f.cobrado, background: C.cobrado }} />}
                  {f.pendiente > 0 && <span className="rounded-r-sm" style={{ flex: f.pendiente, background: C.pendiente }} />}
                </div>
              </li>
            ))}
            {fins.length === 0 && <li className="text-sm text-slate-500">Sin facturas en el período.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Por cobrar, según cuánto hace que se presentó</h2>
          <p className="mb-4 text-[13px] text-slate-500">Todo lo que falta cobrar hoy</p>
          <ul className="space-y-3">
            {data.aging.map((a, i) => {
              const last = i === data.aging.length - 1;
              return (
                <li key={a.label} className="text-sm">
                  <p className="mb-1 flex justify-between gap-3">
                    <span className="text-slate-700">{a.label}</span>
                    <span className="tabular-nums text-slate-900">
                      {money(a.total)} <span className="text-xs text-slate-500">({a.count})</span>
                    </span>
                  </p>
                  <div className="h-2.5 rounded-sm" style={{ background: C.track }}>
                    <div className="h-2.5 rounded-sm" style={{ width: `${(a.total / maxAging) * 100}%`, background: last && a.total > 0 ? C.vencido : C.pendiente }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <h2 className="px-5 py-4 text-[15px] font-semibold">Detalle por cobertura</h2>
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">Cobertura</th>
              <th className="px-3 py-2 text-right font-medium">Facturado</th>
              <th className="px-3 py-2 text-right font-medium">Cobrado</th>
              <th className="px-3 py-2 text-right font-medium">Por cobrar</th>
              <th className="px-5 py-2 text-right font-medium">Tarda en pagar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9]">
            {data.byFin.map((f) => (
              <tr key={f.name}>
                <td className="px-5 py-2.5">{f.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(f.facturado)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(f.cobrado)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {f.pendiente > 0 ? money(f.pendiente) : "—"}
                  {f.vencido > 0 && <span className="block text-xs text-rose-700">{money(f.vencido)} vencido</span>}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{f.diasCobro === null ? "—" : `${f.diasCobro} días`}</td>
              </tr>
            ))}
            {data.byFin.length === 0 && <tr><td colSpan={5} className="px-5 py-4 text-slate-500">Sin facturas en el período.</td></tr>}
          </tbody>
        </table>
      </Card>

      {!data.prof && data.byPro.length > 1 && (
        <Card className="overflow-x-auto">
          <h2 className="px-5 py-4 text-[15px] font-semibold">Por profesional</h2>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Profesional</th>
                <th className="px-3 py-2 text-right font-medium">Facturado</th>
                <th className="px-5 py-2 text-right font-medium">Cobrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {data.byPro.map((p) => (
                <tr key={p.name}>
                  <td className="px-5 py-2.5">{p.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(p.facturado)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{money(p.cobrado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-slate-600">{label}</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-slate-900">{value}</p>
      <p className={cn("mt-2 text-[13px]", alert ? "font-medium text-rose-700" : "text-slate-500")}>{sub}</p>
    </Card>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function MonthTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const cobrado = payload.find((p) => p.dataKey === "cobrado")?.value ?? 0;
  const pendiente = payload.find((p) => p.dataKey === "pendiente")?.value ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{label}</p>
      <p className="flex justify-between gap-6 text-slate-600"><span>Facturado</span><span className="tabular-nums">{money(cobrado + pendiente)}</span></p>
      <p className="flex justify-between gap-6 text-slate-600"><span>Cobrado</span><span className="tabular-nums">{money(cobrado)}</span></p>
      <p className="flex justify-between gap-6 text-slate-600"><span>Por cobrar</span><span className="tabular-nums">{money(pendiente)}</span></p>
    </div>
  );
}
