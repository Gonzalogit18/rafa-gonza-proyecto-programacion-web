"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { Ban, CalendarCheck, Check, ClipboardList, Copy, FileText, Plus, Search, Upload, X } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { FilePicker, fileHref, uploadDocument } from "@/components/file-upload";
import { Badge, Button, Field, Input, Select, Textarea, buttonClass, cn } from "@/components/ui";
import {
  BOARD_COLUMNS,
  CHANNEL_LABEL,
  KIND_LABEL,
  boardColumn,
  dueDate,
  fmtDate,
  fullName,
  invoiceAgeDays,
  isOverdue,
  monthLabel,
  money,
  todayAR,
  type BoardColumn,
} from "@/lib/format";
import { matchesSearch } from "@/lib/search";
import type { Invoice, InvoiceStatus, Organization, PresentationChannel, Professional } from "@/lib/types";
import { addInvoiceNote, checkPayment, createPaymentLink, emitInArca, markPaid, markPresented, registerEmission, revertStatus, saveAttendanceFile, saveDraft, voidInvoice } from "./actions";
import { MoreMenu } from "@/components/more-menu";

export function InvoiceBoard({
  invoices,
  professionals,
  org,
  initialQuery,
  initialOpen,
  canEdit,
  mercadoPago,
  arcaReady,
}: {
  invoices: Invoice[];
  professionals: Professional[];
  org: Organization;
  initialQuery: string;
  initialOpen: string | null;
  canEdit: boolean;
  mercadoPago: boolean;
  arcaReady: string[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [pro, setPro] = useState(professionals[0]?.id ?? "clinica");
  const hasClinic = invoices.some((i) => !i.professional_id);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [dragOver, setDragOver] = useState<BoardColumn | null>(null);
  // En el celular se ve una columna por vez
  const [mobileCol, setMobileCol] = useState<BoardColumn>("preparada");
  const [, start] = useTransition();

  const filtered = useMemo(
    () =>
      invoices.filter(
        (i) =>
          (pro === "clinica" ? null : pro) === i.professional_id &&
          matchesSearch([i.patient?.last_name, i.patient?.first_name, i.patient?.dni, i.patient?.os_affiliate_number, i.obra_social?.name, i.arca_number, i.treatment?.practice_name], query),
      ),
    [invoices, query, pro],
  );

  const columns = useMemo(() => {
    const m = new Map<BoardColumn, Invoice[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
    filtered.forEach((i) => m.get(boardColumn(i))!.push(i));
    // Lo más urgente arriba: lo más viejo para emitir y presentar, lo presentado hace más tiempo; lo cobrado, lo último
    const older = (x: string | null, y: string | null) => (x ?? "").localeCompare(y ?? "");
    m.get("preparada")!.sort((a, b) => older(a.period, b.period) || older(a.created_at, b.created_at));
    m.get("emitida")!.sort((a, b) => older(a.issue_date, b.issue_date));
    m.get("presentada")!.sort((a, b) => older(a.presented_at, b.presented_at));
    m.get("vencida")!.sort((a, b) => older(a.presented_at, b.presented_at));
    m.get("cobrada")!.sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
    return m;
  }, [filtered]);

  const open = invoices.find((i) => i.id === openId) ?? null;
  const pendingTotal = filtered.filter((i) => i.status === "presentada" || i.status === "emitida").reduce((s, i) => s + Number(i.total), 0);
  const overdue = filtered.filter((i) => isOverdue(i));

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Facturación y cobros</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pendiente de cobro: <b className="text-slate-800">{money(Math.round(pendingTotal))}</b>
            {overdue.length > 0 && (
              <span className="ml-2 text-rose-600">
                · <b>{overdue.length}</b> vencidas por {money(Math.round(overdue.reduce((s, i) => s + Number(i.total), 0)))}
              </span>
            )}
          </p>
        </div>
        {canEdit && (
        <div className="flex flex-wrap gap-2">
          <MoreMenu
            items={[
              { label: "Factura manual", icon: <Plus size={16} />, href: "/facturacion/nueva" },
              { label: "Facturas anuladas", icon: <Ban size={16} />, href: "/facturacion/anuladas" },
            ]}
          />
          <Link href="/facturacion/preparar" className={buttonClass()}>
            <ClipboardList size={16} /> Preparar facturas
          </Link>
        </div>
        )}
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-full flex-1 sm:min-w-64">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-9 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Limpiar">
              <X size={16} />
            </button>
          )}
        </div>
        {professionals.length + Number(hasClinic) > 1 && (
          <div className="w-full sm:w-56">
            <Select aria-label="Profesional" value={pro} onChange={(e) => setPro(e.target.value)}>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              {hasClinic && <option value="clinica">A nombre de la clínica</option>}
            </Select>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 lg:hidden">
        {BOARD_COLUMNS.map((c) => (
          <button
            key={c.id}
            onClick={() => setMobileCol(c.id)}
            className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1", mobileCol === c.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200")}
          >
            <span className={cn("h-2 w-2 rounded-full", c.dot)} /> {c.title} <span className="tabular-nums opacity-70">{columns.get(c.id)!.length}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-4 pb-4 lg:gap-3">
        {BOARD_COLUMNS.map((col) => {
          const list = columns.get(col.id)!;
          const sum = list.reduce((s, i) => s + Number(i.total), 0);
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                if (col.id === "cobrada") {
                  e.preventDefault();
                  setDragOver(col.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                const inv = invoices.find((i) => i.id === id);
                if (canEdit && inv && col.id === "cobrada" && inv.status !== "cobrada") start(async () => { await markPaid(id); });
              }}
              className={cn("w-full flex-col rounded-2xl border-2 p-3 transition lg:flex lg:w-auto lg:min-w-44 lg:flex-1 lg:basis-0", mobileCol === col.id ? "flex" : "hidden", col.color, dragOver === col.id && "scale-[1.01] ring-4 ring-emerald-400/40")}
            >
              <header className="mb-3 px-1">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <span className={cn("h-2.5 w-2.5 rounded-full", col.dot, col.id === "vencida" && list.length > 0 && "animate-alarm")} />
                    {col.title}
                  </h2>
                  <span className="rounded-full bg-white/80 px-2 text-xs font-semibold text-slate-600">{list.length}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="text-xs tabular-nums text-slate-500">{money(Math.round(sum))}</p>
                  {col.id === "cobrada" && (
                    <Link href={`/facturacion/cobradas?prof=${pro}`} className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                      Ver todas
                    </Link>
                  )}
                </div>
              </header>
              <div className="flex flex-col gap-2 lg:max-h-[65vh] lg:overflow-y-auto lg:pr-1">
                {list.map((inv) => <InvoiceCard key={inv.id} inv={inv} draggable={canEdit} onOpen={() => setOpenId(inv.id)} />)}
                {list.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Sin facturas</p>}
              </div>
            </section>
          );
        })}
      </div>

      {open && <InvoiceDetail key={open.id} inv={open} org={org} canEdit={canEdit} mercadoPago={mercadoPago} arcaReady={arcaReady} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function InvoiceCard({ inv, draggable, onOpen }: { inv: Invoice; draggable: boolean; onOpen: () => void }) {
  const days = invoiceAgeDays(inv);
  const overdue = isOverdue(inv);
  // En celular, deslizar el tablero arrancando sobre una factura no debe abrirla:
  // solo se abre con un toque sin mover el dedo.
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", inv.id)}
      onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY, moved: false }; }}
      onPointerMove={(e) => {
        const t = touch.current;
        if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) t.moved = true;
      }}
      onPointerCancel={() => { if (touch.current) touch.current.moved = true; }}
      onClick={(e) => {
        const t = touch.current;
        touch.current = null;
        if (t && (t.moved || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8)) return;
        onOpen();
      }}
      className={cn(
        "rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]",
        overdue ? "border-rose-300" : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-2 lg:flex-col lg:gap-0.5 2xl:flex-row 2xl:gap-2">
        <p className="line-clamp-2 min-w-0 break-words font-medium leading-snug text-slate-900">{fullName(inv.patient)}</p>
        <span className="shrink-0 text-sm font-semibold">{money(Number(inv.total))}</span>
      </div>
      <p className="truncate text-xs text-slate-500">
        {inv.part === "copago" ? "Copago" : inv.obra_social?.name ?? "Particular"} {inv.treatment && `· ${inv.treatment.practice_name}`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {inv.period && <Badge className="bg-slate-100 capitalize text-slate-600">{monthLabel(inv.period)}</Badge>}
        {inv.arca_number && <span className="tabular-nums text-slate-400">N° {inv.arca_number}</span>}
        <span className={cn("ml-auto", overdue ? "font-semibold text-rose-600" : "text-slate-400")}>
          {inv.status === "cobrada"
            ? `Cobrada ${inv.paid_at ? fmtDate(inv.paid_at, "dd/MM") : ""}`
            : inv.status === "presentada"
              ? `${days} días presentada`
              : inv.status === "emitida"
                ? `emitida hace ${days} días`
                : ""}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- Ficha de la factura
const STEPS: InvoiceStatus[] = ["preparada", "emitida", "presentada", "cobrada"];
const STEP_LABEL: Record<string, string> = { preparada: "Preparada", emitida: "Emitida en ARCA", presentada: "Presentada", cobrada: "Cobrada" };
const IVA_LABEL: Record<string, string> = {
  monotributo: "Responsable Monotributo",
  responsable_inscripto: "IVA Responsable Inscripto",
  exento: "IVA Sujeto Exento",
  consumidor_final: "Consumidor Final",
};

// Lo que se puede corregir antes de emitir; se ve en la factura mientras se escribe
type Draft = { issue_date: string; period_from: string; period_to: string; items: { id: string; description: string; quantity: string; unit_price: string }[] };
const draftOf = (inv: Invoice): Draft => ({
  issue_date: todayAR(),
  period_from: inv.period_from ?? "",
  period_to: inv.period_to ?? "",
  items: (inv.items ?? []).map((it) => ({ id: it.id ?? "", description: it.description, quantity: String(Number(it.quantity)), unit_price: String(Number(it.unit_price)) })),
});
const applyDraft = (inv: Invoice, d: Draft | null): Invoice =>
  d
    ? {
        ...inv,
        issue_date: d.issue_date,
        period_from: d.period_from,
        period_to: d.period_to,
        items: d.items.map((it) => ({ id: it.id, code: null, description: it.description, quantity: Number(it.quantity) || 0, unit_price: Number(it.unit_price) || 0 })),
        total: d.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0),
      }
    : inv;

export function InvoiceDetail({ inv, org, canEdit, mercadoPago = false, arcaReady = [], onClose }: { inv: Invoice; org: Organization; canEdit: boolean; mercadoPago?: boolean; arcaReady?: string[]; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { askText } = useDialog();
  const editable = canEdit && inv.status === "preparada";
  const [draft, setDraft] = useState<Draft | null>(() => (editable ? draftOf(inv) : null));
  // Lo que paga el paciente (particular, reintegro, copago) no se presenta a ninguna obra social
  const patientPays = inv.kind !== "obra_social";
  const steps = patientPays ? STEPS.filter((s) => s !== "presentada") : STEPS;
  const stepIdx = steps.indexOf(inv.status);
  const emitted = !!(inv.arca_number || inv.cae);
  const stepDate: Record<string, string | null> = { preparada: inv.created_at, emitida: inv.issue_date, presentada: inv.presented_at, cobrada: inv.paid_at };
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
    });
  const back = stepIdx > 0 ? steps[stepIdx - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-grow-in relative grid h-full w-full max-w-6xl overflow-y-auto bg-slate-100 shadow-2xl sm:h-auto sm:max-h-[96vh] sm:rounded-2xl lg:h-[96vh] lg:grid-cols-[1fr_400px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-slate-500 shadow hover:text-slate-900" aria-label="Cerrar">
          <X size={18} />
        </button>

        {/* La factura */}
        <div id="factura-doc" className="order-2 scroll-mt-2 p-3 lg:overflow-x-hidden sm:p-8 lg:order-none lg:overflow-y-auto">
          <InvoiceDocument inv={applyDraft(inv, draft)} org={org} />
        </div>

        {/* Pasos y acciones */}
        <aside className="order-1 space-y-5 border-slate-200 bg-white p-4 sm:p-5 lg:order-none lg:overflow-y-auto lg:border-l">
          {/* Lo hecho lleva check y fecha; el paso que sigue, su número */}
          <ol className="space-y-2 pr-8">
            {steps.map((s, i) => {
              const done = i <= stepIdx;
              const next = i === stepIdx + 1;
              return (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-teal-600 text-white" : next ? "bg-white text-teal-800 ring-2 ring-teal-500" : "bg-slate-100 text-slate-400")}>
                    {done ? <Check size={13} /> : i + 1}
                  </span>
                  <span className={done ? "text-slate-800" : next ? "font-semibold" : "text-slate-400"}>{STEP_LABEL[s]}</span>
                  {done && stepDate[s] && <span className="ml-auto text-xs tabular-nums text-slate-500">{fmtDate(stepDate[s]!, "dd/MM/yy")}</span>}
                </li>
              );
            })}
          </ol>
          {/* En el celular la factura queda abajo de los datos: un botón lleva hasta ella */}
          <button
            type="button"
            onClick={() => document.getElementById("factura-doc")?.scrollIntoView({ behavior: "smooth" })}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-700 lg:hidden"
          >
            <FileText size={16} /> Ver la factura
          </button>

          {inv.status === "presentada" && (
            <p className={cn("rounded-lg px-3 py-2 text-sm", isOverdue(inv) ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600")}>
              {isOverdue(inv) ? `${invoiceAgeDays(inv)} días presentada sin cobrar. Venció el ` : "Vence el "}{fmtDate(dueDate(inv)!)}
            </p>
          )}

          {editable && draft && (
            <EmitPanel
              inv={inv}
              org={org}
              draft={draft}
              setDraft={setDraft}
              arcaConnected={!!inv.professional_id && arcaReady.includes(inv.professional_id)}
              pending={pending}
              run={run}
            />
          )}
          {canEdit && inv.status === "emitida" && !patientPays && <PresentForm inv={inv} pending={pending} run={run} />}
          {canEdit && (inv.status === "presentada" || (inv.status === "emitida" && patientPays)) && (
            <Button disabled={pending} className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => run(() => markPaid(inv.id))}>
              Marcar cobrada hoy
            </Button>
          )}
          {canEdit && mercadoPago && (inv.status === "emitida" || inv.status === "presentada" || inv.status === "cobrada") && (inv.kind !== "obra_social" || inv.part === "copago") && <MercadoPagoPanel inv={inv} />}
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

          {(inv.cae || inv.arca_pdf_path) && (
            <div className="flex flex-col gap-1.5 text-sm">
              {inv.cae && (
                <a href={`/facturacion/${inv.id}/factura`} target="_blank" className="flex items-center gap-1.5 font-medium text-teal-700 hover:underline">
                  <FileText size={15} /> Factura en PDF
                </a>
              )}
              {inv.arca_pdf_path && (
                <a href={fileHref(inv.arca_pdf_path)} target="_blank" className="flex items-center gap-1.5 font-medium text-teal-700 hover:underline">
                  <FileText size={15} /> PDF de ARCA
                </a>
              )}
            </div>
          )}

          {inv.kind === "obra_social" && inv.treatment_id && inv.status !== "cobrada" && <AttendanceSheet inv={inv} org={org} canEdit={canEdit} pending={pending} run={run} />}

          <EventsLog inv={inv} pending={pending} run={run} canEdit={canEdit} />

          {canEdit && (
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
              <button
                className="text-slate-400 hover:text-rose-600"
                onClick={async () => {
                  const reason = await askText(emitted ? "Motivo de anulación. Como ya está emitida, hacé también la nota de crédito en ARCA." : "Motivo de anulación.");
                  if (reason) run(() => voidInvoice(inv.id, reason));
                }}
              >
                Anular
              </button>
              {back && !(back === "preparada" && emitted) && (
                <button className="text-slate-500 hover:text-slate-800" onClick={() => run(() => revertStatus(inv.id, back))}>
                  Volver a {STEP_LABEL[back].toLowerCase()}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// La factura como documento (mismo formato que la de ARCA)
function InvoiceDocument({ inv, org }: { inv: Invoice; org: Organization }) {
  const pro = inv.professional;
  const toOS = inv.kind === "obra_social";
  const issuerName = pro?.full_name ?? org.razon_social ?? org.name;
  return (
    <article className="relative mx-auto max-w-2xl overflow-hidden bg-white p-6 text-[13px] shadow-lg sm:p-8">
      {inv.status === "preparada" && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest text-slate-200/70 [transform:rotate(-20deg)]">
          Borrador
        </span>
      )}
      {inv.status === "cobrada" && (
        <span className="pointer-events-none absolute bottom-24 left-10 rotate-[-12deg] rounded-lg border-4 border-emerald-500 px-4 py-1 text-2xl font-black uppercase tracking-widest text-emerald-500/80">
          Cobrada
        </span>
      )}
      <p className="border border-b-0 border-slate-800 py-1 text-center text-xs font-bold tracking-widest">ORIGINAL</p>
      <header className="grid grid-cols-[1fr_auto_1fr] border border-slate-800">
        <div className="p-3">
          <p className="text-base font-bold uppercase">{issuerName}</p>
          <p className="mt-2 text-xs text-slate-600">{org.address}</p>
          <p className="text-xs text-slate-600">{IVA_LABEL[pro?.condicion_iva ?? org.condicion_iva ?? "monotributo"]}</p>
        </div>
        <div className="flex flex-col items-center border-x border-slate-800 px-3 pt-2">
          <span className="text-3xl font-black leading-none">{inv.tipo_comprobante ?? "C"}</span>
        </div>
        <div className="p-3">
          <p className="text-lg font-bold">FACTURA</p>
          <p className="text-xs">Punto de venta: <b>{String(inv.punto_venta ?? 1).padStart(5, "0")}</b> · N°: <b>{inv.arca_number ? String(inv.arca_number).padStart(8, "0") : "—"}</b></p>
          <p className="text-xs">Emisión: {inv.issue_date ? fmtDate(inv.issue_date) : "—"}</p>
          <p className="text-xs">CUIT: {pro?.cuit ?? org.cuit ?? <span className="text-amber-600">falta</span>}</p>
        </div>
      </header>
      <div className="flex flex-wrap justify-between border-x border-b border-slate-800 px-3 py-1.5 text-xs">
        <span>Período: {inv.period_from && inv.period_to ? `${fmtDate(inv.period_from)} al ${fmtDate(inv.period_to)}` : "—"}</span>
        <span>{inv.part === "copago" ? "Copago" : inv.part === "financiador" ? "Parte cobertura" : KIND_LABEL[inv.kind]}</span>
      </div>
      <section className="mt-2 grid gap-1 border border-slate-800 p-3 text-xs sm:grid-cols-2">
        <p>
          <span className="text-slate-500">CUIT/DNI: </span>
          <CopyText text={toOS ? inv.obra_social?.cuit ?? "" : inv.patient?.dni ?? ""} />
        </p>
        <p>
          <span className="text-slate-500">Razón social: </span>
          <b>{toOS ? inv.obra_social?.razon_social || inv.obra_social?.name : fullName(inv.patient)}</b>
        </p>
        <p><span className="text-slate-500">IVA: </span>{toOS ? IVA_LABEL[inv.obra_social?.condicion_iva ?? ""] ?? "—" : "Consumidor Final"}</p>
        {toOS && inv.obra_social?.address && <p><span className="text-slate-500">Domicilio: </span>{inv.obra_social.address}</p>}
      </section>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-left text-white">
              <th className="px-2 py-1.5">Producto / servicio</th>
              <th className="px-2 text-right">Cant.</th>
              <th className="hidden px-2 text-right sm:table-cell">P. unit.</th>
              <th className="px-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(inv.items ?? []).map((it, i) => (
              <tr key={i} className="border-b border-slate-200 align-top">
                <td className="whitespace-pre-wrap px-2 py-2"><CopyText text={it.description} block /></td>
                <td className="px-2 py-2 text-right">{Number(it.quantity)}</td>
                <td className="hidden px-2 py-2 text-right sm:table-cell">{money(Number(it.unit_price))}</td>
                <td className="px-2 py-2 text-right">{money(Number(it.quantity) * Number(it.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <div className="w-56 border border-slate-800 p-3 text-right">
          <p className="text-xs text-slate-500">Importe total</p>
          <p className="text-2xl font-bold">{money(Number(inv.total))}</p>
        </div>
      </div>
      <footer className="mt-4 flex justify-between border-t border-slate-200 pt-2 text-xs text-slate-500">
        <span>{inv.cae ? `CAE ${inv.cae}${inv.cae_vencimiento ? ` · vto. ${fmtDate(inv.cae_vencimiento)}` : ""}` : ""}</span>
        {pro?.matricula && <span>{pro.full_name} · {pro.matricula}</span>}
      </footer>
    </article>
  );
}

function CopyText({ text, block }: { text: string; block?: boolean }) {
  const [ok, setOk] = useState(false);
  if (!text) return <span className="text-amber-600">falta cargar</span>;
  return (
    <button
      type="button"
      title="Copiar"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className={cn("group rounded text-left hover:bg-teal-50", block && "block w-full")}
    >
      {text} <span className="text-teal-600 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100">{ok ? <Check size={11} className="inline" /> : <Copy size={11} className="inline" />}</span>
    </button>
  );
}

type Run = (fn: () => Promise<{ error?: string }>) => void;

// Cobro al paciente: link de Mercado Pago y consulta de si ya pagó
const MP_LINK = "Link de pago de Mercado Pago: ";
function MercadoPagoPanel({ inv }: { inv: Invoice }) {
  const last = [...(inv.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((e) => e.text.startsWith(MP_LINK));
  const [link, setLink] = useState(last ? last.text.slice(MP_LINK.length) : null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const paid = inv.events?.find((e) => e.text.includes("por Mercado Pago, operación"));
  if (inv.status === "cobrada") return paid ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{paid.text}</p> : null;
  const go = (fn: () => Promise<{ error?: string; message?: string }>, onOk?: (m: string) => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.error) setMsg({ text: r.error, bad: true });
      else if (onOk) onOk(r.message ?? "");
      else setMsg({ text: r.message ?? "" });
    });

  return (
    <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
      <h3 className="text-sm font-semibold">Cobrar con Mercado Pago</h3>
      {link ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copiado" : "Copiar link"}
            </Button>
            <a href={link} target="_blank" className={buttonClass("secondary")}>Abrir</a>
          </div>
          <Button className="w-full bg-sky-600 hover:bg-sky-700" disabled={pending} onClick={() => go(() => checkPayment(inv.id))}>Revisar pago</Button>
        </>
      ) : (
        <Button disabled={pending} className="w-full bg-sky-600 hover:bg-sky-700" onClick={() => go(() => createPaymentLink(inv.id), setLink)}>
          Crear link de pago
        </Button>
      )}
      {msg && <p className={cn("text-sm", msg.bad ? "text-rose-700" : "text-slate-700")}>{msg.text}</p>}
    </section>
  );
}

// Emitir: los datos que van a ARCA (se ven en la factura mientras se escriben),
// el botón para emitir con ARCA y, como alternativa, subir el PDF si se hizo en la página de ARCA
function EmitPanel({
  inv,
  org,
  draft,
  setDraft,
  arcaConnected,
  pending,
  run,
}: {
  inv: Invoice;
  org: Organization;
  draft: Draft;
  setDraft: (d: Draft) => void;
  arcaConnected: boolean;
  pending: boolean;
  run: Run;
}) {
  const { ask } = useDialog();
  const [manual, setManual] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const toOS = inv.kind === "obra_social";
  const receptorDoc = toOS ? inv.obra_social?.cuit : inv.patient?.dni;
  const total = draft.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const setItem = (i: number, patch: Partial<Draft["items"][number]>) => setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const save = () =>
    saveDraft(inv.id, {
      period_from: draft.period_from,
      period_to: draft.period_to,
      items: draft.items.map((it) => ({ id: it.id, description: it.description, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
    });

  const emit = async () => {
    if (!arcaConnected) return setNotConnected(true);
    if (!(await ask(`¿Emitir la factura por ${money(total)} en ARCA? Una vez emitida no se puede cambiar: un error se corrige con una nota de crédito.`, "Emitir"))) return;
    setEmitting(true);
    run(async () => {
      const r = await save();
      const out = r.error ? r : await emitInArca(inv.id, draft.issue_date);
      setEmitting(false);
      return out;
    });
  };

  return (
    <section className="space-y-4">
      <div className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold">Datos de la factura</h3>
        <Field label="Fecha de emisión"><Input type="date" value={draft.issue_date} onChange={(e) => setDraft({ ...draft, issue_date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Período desde"><Input type="date" value={draft.period_from} onChange={(e) => setDraft({ ...draft, period_from: e.target.value })} /></Field>
          <Field label="Período hasta"><Input type="date" value={draft.period_to} onChange={(e) => setDraft({ ...draft, period_to: e.target.value })} /></Field>
        </div>
        {draft.items.map((it, i) => (
          <div key={it.id || i} className="space-y-2 rounded-lg bg-slate-50 p-2.5">
            <Textarea aria-label="Descripción" rows={2} className="min-h-0 bg-white text-xs" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cantidad"><Input type="number" min={1} step="1" className="bg-white" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></Field>
              <Field label="Precio unitario"><Input type="number" min={0} step="0.01" className="bg-white" value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></Field>
            </div>
          </div>
        ))}
        <p className="flex justify-between text-sm"><span className="text-slate-500">Total</span><b className="tabular-nums">{money(total)}</b></p>
        {!receptorDoc && toOS && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Falta el CUIT de {inv.obra_social?.name ?? "la obra social"}. <Link href="/configuracion?tab=coberturas" className="font-medium underline">Cargalo en Configuración</Link>.
          </p>
        )}
      </div>

      <Button className={cn("w-full", !arcaConnected && "opacity-60")} disabled={pending} onClick={emit} aria-disabled={!arcaConnected}>
        {emitting ? "Emitiendo…" : "Emitir con ARCA"}
      </Button>
      {!arcaConnected && notConnected && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {inv.professional_id ? "Este profesional todavía no conectó su cuenta de ARCA." : "Las facturas a nombre de la clínica se emiten en la página de ARCA."}{" "}
          {inv.professional_id && <Link href="/configuracion?tab=arca" className="font-medium underline">Conectar en Configuración</Link>}
        </p>
      )}

      {manual ? (
        <form
          action={(fd) =>
            run(async () => {
              const s = await save();
              if (s.error) return s;
              const file = fd.get("file") as File | null;
              if (!file || file.size === 0) return { error: "Subí el PDF que te dio ARCA." };
              const path = await uploadDocument(org.id, "facturas", file);
              return registerEmission(inv.id, { arca_number: Number(fd.get("arca_number")), punto_venta: Number(fd.get("punto_venta")), issue_date: draft.issue_date, arca_pdf_path: path });
            })
          }
          className="space-y-3 rounded-xl border border-slate-200 p-4"
        >
          <h3 className="text-sm font-semibold">La emití en la página de ARCA</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Punto de venta"><Input name="punto_venta" type="number" min={1} required defaultValue={inv.punto_venta ?? org.punto_venta ?? 1} /></Field>
            <Field label="N° de factura"><Input name="arca_number" type="number" min={1} required /></Field>
          </div>
          <FilePicker label="Subir el PDF de ARCA" />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setManual(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending} className="flex-1">Guardar como emitida</Button>
          </div>
        </form>
      ) : (
        <button onClick={() => setManual(true)} className={buttonClass("secondary", "w-full")}>
          <Upload size={15} /> La emití en la página de ARCA: subir el PDF
        </button>
      )}
    </section>
  );
}

// Planilla de asistencia: sale con las fechas de las sesiones, el paciente la firma y se presenta con la factura
function AttendanceSheet({ inv, org, canEdit, pending, run }: { inv: Invoice; org: Organization; canEdit: boolean; pending: boolean; run: Run }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm">
      <h3 className="font-semibold">Planilla de asistencia</h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <a href={`/facturacion/${inv.id}/planilla`} target="_blank" className="flex items-center gap-1.5 font-medium text-teal-700 hover:underline">
          <CalendarCheck size={15} /> Imprimir para firmar
        </a>
        {inv.attendance_file_path && (
          <a href={fileHref(inv.attendance_file_path)} target="_blank" className="flex items-center gap-1.5 font-medium text-teal-700 hover:underline">
            <Check size={15} /> Ver la firmada
          </a>
        )}
        {canEdit && (
          <>
            <button disabled={pending} onClick={() => ref.current?.click()} className="flex items-center gap-1.5 font-medium text-teal-700 hover:underline">
              <Upload size={15} /> {inv.attendance_file_path ? "Reemplazar firmada" : "Subir firmada"}
            </button>
            <input
              ref={ref}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) run(async () => saveAttendanceFile(inv.id, await uploadDocument(org.id, "planillas", file)));
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}

function PresentForm({ inv, pending, run }: { inv: Invoice; pending: boolean; run: Run }) {
  const os = inv.obra_social;
  return (
    <form
      action={(fd) => run(() => markPresented(inv.id, String(fd.get("date")), fd.get("channel") as PresentationChannel, String(fd.get("note") || "")))}
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"
    >
      <h3 className="text-sm font-semibold">Presentar</h3>
      {os?.presentation_email && <p className="text-xs text-slate-600">{os.presentation_email}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fecha"><Input name="date" type="date" required defaultValue={todayAR()} /></Field>
        <Field label="Cómo">
          <Select name="channel" defaultValue={os?.presentation_channel ?? "mail"}>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Detalle"><Input name="note" /></Field>
      <Button type="submit" disabled={pending} className="w-full">Guardar como presentada</Button>
    </form>
  );
}

function EventsLog({ inv, pending, run, canEdit }: { inv: Invoice; pending: boolean; run: Run; canEdit: boolean }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"nota" | "reclamo">("reclamo");
  const events = [...(inv.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Historial y reclamos</h3>
      {canEdit && <div className="mb-3 space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="min-h-0" aria-label="Nota o reclamo" />
        <div className="flex gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as "nota")}>
          <option value="reclamo">Reclamo</option>
          <option value="nota">Nota</option>
        </Select>
        <Button
          variant="secondary"
          disabled={pending || !text.trim()}
          onClick={() =>
            run(async () => {
              const r = await addInvoiceNote(inv.id, kind, text);
              if (!r.error) setText("");
              return r;
            })
          }
        >
          Agregar
        </Button>
        </div>
      </div>}
      <ol className="space-y-1.5 text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-24 shrink-0 text-xs text-slate-400">{fmtDate(e.created_at, "dd/MM/yy HH:mm")}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {e.kind === "reclamo" && <Badge className="mr-1 bg-rose-100 text-rose-700">Reclamo</Badge>}
              {e.kind === "nota" && <Badge className="mr-1 bg-slate-100 text-slate-600">Nota</Badge>}
              {e.text.startsWith(MP_LINK) ? "Link de pago de Mercado Pago creado" : e.text}
              {e.author && <span className="text-xs text-slate-400"> · {e.author.full_name}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}


