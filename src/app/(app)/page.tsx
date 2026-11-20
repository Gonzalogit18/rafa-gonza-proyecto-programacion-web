import { addDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { ProfessionalPicker } from "@/components/professional-picker";
import { Badge, Button, Card, PageHeader, cn } from "@/components/ui";
import { fetchBillingRows } from "@/lib/billing";
import { arToISO, cap, fmtTime, fullName, isOverdue, money, nowAR, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { Appointment, Invoice } from "@/lib/types";
import { QuickEntry } from "./_home/quick-entry";
import { loadDemoData } from "./demo-actions";
import { STATUS_STYLE } from "./agenda/status";

const greeting = (hour: number) => (hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches");

export default async function InicioPage({ searchParams }: PageProps<"/">) {
  const { supabase, profile, myProfessionals, canBill, canSeeClinical, myProfessional, isAdmin } = await getSession();
  const sp = (await searchParams) as { "sin-permiso"?: string; prof?: string };
  const today = todayAR();
  const tomorrow = format(addDays(nowAR(), 1), "yyyy-MM-dd");
  const firstName = profile.full_name.split(" ")[0];
  // Quien maneja varios profesionales ve uno por vez, y primero el suyo
  const selected = myProfessionals.find((p) => p.id === sp.prof) ?? myProfessionals[0] ?? null;
  const isOwn = !!selected && selected.id === myProfessional?.id;

  const [{ data: todayAppts }, { data: patients }, billing] = await Promise.all([
    selected
      ? supabase
          .from("appointments")
          .select("*, patient:patients(id, first_name, last_name, archived_at), treatment:treatments(id, practice_name)")
          .eq("professional_id", selected.id)
          .gte("starts_at", arToISO(today, "00:00"))
          .lt("starts_at", arToISO(tomorrow, "00:00"))
          .neq("status", "cancelado")
          .order("starts_at")
      : Promise.resolve({ data: [] }),
    supabase.from("patients").select("id, first_name, last_name").is("archived_at", null).order("last_name"),
    canBill ? billingSummary(selected?.id) : Promise.resolve(null),
  ]);
  const appts = (todayAppts ?? []) as (Appointment & { patient: { archived_at: string | null } | null })[];

  if (process.env.ENABLE_DEMO === "true" && isAdmin && !(patients ?? []).length) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-2xl font-semibold">{greeting(nowAR().getHours())}, {firstName}</h1>
        <form action={loadDemoData} className="mt-6">
          <Button type="submit">Cargar datos de ejemplo</Button>
        </form>
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-[1160px] space-y-5">
      <PageHeader
        title={`${greeting(nowAR().getHours())}, ${firstName}`}
        subtitle={cap(format(nowAR(), "EEEE d 'de' MMMM", { locale: es }))}
        actions={selected && <ProfessionalPicker professionals={myProfessionals} value={selected.id} />}
      />
      {sp["sin-permiso"] && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">No tenés acceso a esa sección.</p>}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader title="Turnos de hoy" />
            {appts.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">{isOwn ? "No tenés turnos para hoy" : "No hay turnos para hoy"}</p>
            ) : (
              <div className="divide-y divide-[#F0EEE9]">
                {appts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 px-5 py-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="w-11 text-sm tabular-nums text-slate-500">{fmtTime(a.starts_at)}</span>
                      <span className="truncate font-medium">{fullName(a.patient)}</span>
                      <span className="hidden truncate text-sm text-slate-500 sm:inline">{a.treatment?.practice_name}</span>
                    </span>
                    <Badge className={a.in_conflict ? "bg-rose-100 text-rose-700" : a.is_overbook ? "bg-violet-100 text-violet-800" : STATUS_STYLE[a.status].badge}>
                      {a.in_conflict ? "Choque" : a.is_overbook ? "Sobreturno" : STATUS_STYLE[a.status].label}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {/* Solo el médico de la cuenta escribe, en su propia agenda: el registro queda firmado por quien atendió */}
          {canSeeClinical && isOwn && <QuickEntry key={selected.id} professionalId={selected.id} todays={appts.filter((a) => !a.patient?.archived_at)} patients={patients ?? []} />}
        </div>

        {billing && (
          <Card className="overflow-hidden">
            <CardHeader title="Facturación" />
            <div className="divide-y divide-[#F0EEE9]">
              {billing.rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="flex items-center gap-3">
                    <span className={cn("flex h-[26px] min-w-[30px] items-center justify-center rounded-md px-1.5 text-[13px] font-semibold tabular-nums", r.badge)}>{r.count}</span>
                    <span className={r.danger ? "text-rose-700" : "text-slate-700"}>{r.label}</span>
                  </span>
                  <span className={cn("tabular-nums", r.danger ? "font-medium text-rose-700" : "text-slate-900")}>{r.amount}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// Lo que falta facturar, emitir, presentar y cobrar del profesional elegido
async function billingSummary(professionalId?: string) {
  const { supabase } = await getSession();
  const [invs, rowsBilling] = professionalId
    ? await Promise.all([
        supabase
          .from("invoices")
          .select("id, status, total, presented_at, issue_date, created_at, obra_social:obras_sociales(name, plazo_pago_dias)")
          .eq("professional_id", professionalId)
          .in("status", ["preparada", "emitida", "presentada"])
          .then((r) => r.data),
        fetchBillingRows(supabase, {}),
      ])
    : [[], { rows: [], untreated: [] }];
  const invoices = (invs ?? []) as unknown as Invoice[];
  const overdue = invoices.filter((i) => isOverdue(i));
  const toEmit = invoices.filter((i) => i.status === "preparada");
  const toPresent = invoices.filter((i) => i.status === "emitida");
  const waiting = invoices.filter((i) => i.status === "presentada" && !isOverdue(i));
  // Sesiones atendidas que todavía no tienen factura, de cualquier mes: lo mismo que muestra Preparar facturas
  const notInvoiced = rowsBilling.rows.filter((r) => r.invoices.length === 0 && r.treatment.professional_id === professionalId);
  // Más las consultas sin tratamiento (su monto, con la tarifa propuesta si la hay)
  const looseNotInvoiced = rowsBilling.untreated.filter((u) => !u.invoiced && u.professionalId === professionalId);
  const sessions = notInvoiced.reduce((s, r) => s + r.dates.length, 0) + looseNotInvoiced.reduce((s, u) => s + u.dates.length, 0);
  const notInvoicedAmount = [...notInvoiced, ...looseNotInvoiced.map((u) => ({ total: (u.suggested ?? 0) * u.dates.length }))];
  const sum = (l: { total: number }[]) => money(Math.round(l.reduce((s, i) => s + Number(i.total), 0)));

  return {
    rows: [
      { label: "Sesiones sin facturar", count: sessions, amount: sum(notInvoicedAmount), badge: "bg-slate-100 text-slate-600" },
      { label: "Para emitir", count: toEmit.length, amount: sum(toEmit), badge: "bg-sky-100 text-sky-800" },
      { label: "Sin presentar", count: toPresent.length, amount: sum(toPresent), badge: "bg-amber-100 text-amber-800" },
      { label: "Presentadas vigentes", count: waiting.length, amount: sum(waiting), badge: "bg-teal-100 text-teal-800" },
      { label: "Vencidas", count: overdue.length, amount: sum(overdue), badge: "bg-rose-100 text-rose-700", danger: overdue.length > 0 },
    ],
  };
}

function CardHeader({ title }: { title: string }) {
  return <h2 className="border-b border-[#EDEBE6] px-5 py-4 text-[15px] font-semibold">{title}</h2>;
}
