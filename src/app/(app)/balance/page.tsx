import { differenceInDays, parseISO } from "date-fns";
import { DEFAULT_PAY_DAYS, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { Invoice, Professional } from "@/lib/types";
import { BalanceDashboard, type BalanceData } from "./dashboard";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type Row = Pick<Invoice, "id" | "kind" | "period" | "issue_date" | "presented_at" | "paid_at" | "status" | "total" | "professional_id"> & {
  obra_social: { name: string; plazo_pago_dias: number | null } | null;
};

export default async function BalancePage({ searchParams }: PageProps<"/balance">) {
  const { anio, mes, prof } = (await searchParams) as { anio?: string; mes?: string; prof?: string };
  const today = todayAR();
  const year = Number(anio ?? today.slice(0, 4));
  const month = mes ? Number(mes) : null;

  const { supabase, isAdmin, myProfessionals } = await getSession();
  // Administración ve la clínica entera; secretaría y profesionales, un médico por vez (los suyos)
  const selected = myProfessionals.find((p) => p.id === prof)?.id ?? (isAdmin ? null : myProfessionals[0]?.id ?? "none");
  // Últimos 12 meses hasta el año elegido (para el gráfico) + toda la deuda abierta (para la antigüedad)
  let q = supabase
    .from("invoices")
    .select("id, kind, period, issue_date, presented_at, paid_at, status, total, professional_id, obra_social:obras_sociales(name, plazo_pago_dias)")
    .in("status", ["emitida", "presentada", "cobrada"]);
  if (selected) q = q.eq("professional_id", selected);
  const [{ data }] = await Promise.all([q]);
  const all = (data ?? []) as unknown as Row[];

  const inYear = all.filter((i) => i.period?.startsWith(String(year)));
  const scope = month ? inYear.filter((i) => Number(i.period!.slice(5, 7)) === month) : inYear;
  const sum = (l: Row[]) => l.reduce((s, i) => s + Number(i.total), 0);
  const isPaid = (i: Row) => i.status === "cobrada";

  // Deuda abierta hoy (de cualquier período), por antigüedad desde que se presentó
  const open = all.filter((i) => !isPaid(i));
  const ageOf = (i: Row) => differenceInDays(parseISO(today), parseISO(i.presented_at ?? i.issue_date ?? today));
  const overdue = open.filter((i) => i.status === "presentada" && ageOf(i) > (i.obra_social?.plazo_pago_dias ?? DEFAULT_PAY_DAYS));

  const AGING = [
    { label: "Hasta 30 días", from: 0, to: 30 },
    { label: "31 a 60 días", from: 31, to: 60 },
    { label: "61 a 90 días", from: 61, to: 90 },
    { label: "Más de 90 días", from: 91, to: Infinity },
  ];
  const paidScope = scope.filter(isPaid);
  const collectDays = paidScope
    .filter((i) => i.paid_at && (i.presented_at ?? i.issue_date))
    .map((i) => differenceInDays(parseISO(i.paid_at!), parseISO((i.presented_at ?? i.issue_date)!)));

  const byFin = new Map<string, { facturado: number; cobrado: number; pendiente: number; vencido: number; dias: number[] }>();
  for (const i of scope) {
    const k = i.kind === "obra_social" ? i.obra_social?.name ?? "Sin cobertura" : "Particulares";
    const cur = byFin.get(k) ?? { facturado: 0, cobrado: 0, pendiente: 0, vencido: 0, dias: [] };
    cur.facturado += Number(i.total);
    if (isPaid(i)) cur.cobrado += Number(i.total);
    else cur.pendiente += Number(i.total);
    if (overdue.some((o) => o.id === i.id)) cur.vencido += Number(i.total);
    if (isPaid(i) && i.paid_at && (i.presented_at ?? i.issue_date)) cur.dias.push(differenceInDays(parseISO(i.paid_at), parseISO((i.presented_at ?? i.issue_date)!)));
    byFin.set(k, cur);
  }

  const professionals = myProfessionals as Professional[];
  const byPro = professionals
    .map((p) => {
      const l = scope.filter((i) => i.professional_id === p.id);
      return { name: p.full_name, color: p.color, facturado: sum(l), cobrado: sum(l.filter(isPaid)), facturas: l.length };
    })
    .filter((p) => p.facturas > 0)
    .sort((a, b) => b.facturado - a.facturado);

  const balance: BalanceData = {
    year,
    month,
    prof: selected,
    allowAll: isAdmin,
    professionals: professionals.map((p) => ({ id: p.id, name: p.full_name })),
    kpis: {
      facturado: sum(scope),
      cobrado: sum(paidScope),
      pendiente: sum(scope.filter((i) => !isPaid(i))),
      vencido: sum(overdue),
      vencidas: overdue.length,
      facturas: scope.length,
      diasCobro: collectDays.length ? Math.round(collectDays.reduce((a, b) => a + b, 0) / collectDays.length) : null,
    },
    byMonth: MONTHS.map((name, idx) => {
      const l = inYear.filter((i) => Number(i.period!.slice(5, 7)) === idx + 1);
      return { name, cobrado: sum(l.filter(isPaid)), pendiente: sum(l.filter((i) => !isPaid(i))), facturas: l.length };
    }),
    aging: AGING.map((a) => {
      const l = open.filter((i) => ageOf(i) >= a.from && ageOf(i) <= a.to);
      return { label: a.label, total: sum(l), count: l.length };
    }),
    byFin: [...byFin.entries()]
      .map(([name, { dias, ...v }]) => ({ name, ...v, diasCobro: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null }))
      .sort((a, b) => b.facturado - a.facturado),
    byPro,
  };

  return <BalanceDashboard data={balance} />;
}
