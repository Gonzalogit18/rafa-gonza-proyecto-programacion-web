import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { fileHref } from "@/components/file-upload";
import { Badge, Card, EmptyState, LinkTabs, buttonClass, cn } from "@/components/ui";
import { fetchBillingRows } from "@/lib/billing";
import { CLINICAL_KIND_LABEL, STATUS_LABEL, age, fmtDate, fmtTime, invoiceNumber, money, monthLabel, todayAR } from "@/lib/format";
import { getSession } from "@/lib/session";
import { fetchCustomTariffs, fetchTreatments } from "@/lib/treatments";
import type { Appointment, ClinicalEntry, Patient, Professional } from "@/lib/types";
import { STATUS_STYLE } from "../../agenda/status";
import { NewTreatmentButton, TreatmentCard } from "../../tratamientos/treatment-ui";
import { ArchivePatientButton } from "./archive-button";
import { ClinicalEntryForm, VoidEntryButton } from "./clinical";

const KIND_STYLE: Record<string, string> = {
  consulta: "bg-teal-100 text-teal-700",
  evolucion: "bg-sky-100 text-sky-700",
  estudio: "bg-violet-100 text-violet-700",
  receta: "bg-amber-100 text-amber-700",
  nota: "bg-slate-100 text-slate-700",
  otro: "bg-slate-100 text-slate-700",
};

const INVOICE_STATUS_STYLE: Record<string, string> = {
  preparada: "bg-slate-100 text-slate-700",
  emitida: "bg-sky-100 text-sky-700",
  presentada: "bg-amber-100 text-amber-700",
  cobrada: "bg-emerald-100 text-emerald-700",
};

export default async function PacientePage({ params, searchParams }: PageProps<"/pacientes/[id]">) {
  const { id } = await params;
  const { supabase, isAdmin, canSeeClinical, myProfessionals } = await getSession();
  const sp = (await searchParams) as { tab?: string };
  const tab = sp.tab ?? (canSeeClinical ? "historia" : "tratamientos");

  const [{ data: p }, { data: pros }] = await Promise.all([
    supabase.from("patients").select("*, obra_social:obras_sociales(id, name, type)").eq("id", id).single(),
    supabase.from("professionals").select("*").order("full_name"),
  ]);
  if (!p) notFound();
  const patient = p as Patient;
  const professionals = (pros ?? []) as Professional[];
  const proName = (pid: string | null) => professionals.find((x) => x.id === pid)?.full_name;
  const cudExpired = patient.has_cud && patient.cud_expiry && patient.cud_expiry < todayAR();

  const TABS = [
    canSeeClinical && { id: "historia", label: "Historia clínica" },
    { id: "tratamientos", label: "Tratamientos" },
    { id: "turnos", label: "Turnos" },
    isAdmin && { id: "facturacion", label: "Facturación" },
    { id: "informacion", label: "Información" },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="mx-auto max-w-6xl">
      {patient.archived_at && (
        <p className="mb-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700">
          Paciente archivado el {fmtDate(patient.archived_at)}. Toda su historia clínica, evoluciones, tratamientos y facturas siguen acá.
        </p>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              {patient.last_name}, {patient.first_name}
              {patient.has_cud && <Badge className={cudExpired ? "bg-rose-100 text-rose-700" : "bg-violet-100 text-violet-700"}>{cudExpired ? "CUD vencido" : "CUD"}</Badge>}
              {patient.archived_at && <Badge className="bg-slate-200 text-slate-700">Archivado</Badge>}
            </h1>
          </div>
          <ArchivePatientButton id={id} archived={!!patient.archived_at} />
        </div>
      </Card>

      <div className="mt-5">
        <LinkTabs tabs={TABS} current={tab} href={(t) => `/pacientes/${id}?tab=${t}`} />
        {tab === "historia" && canSeeClinical && <ClinicalTab patientId={id} archived={!!patient.archived_at} />}
        {tab === "tratamientos" && <TreatmentsTab patient={patient} professionals={myProfessionals} />}
        {tab === "turnos" && <AppointmentsTab patientId={id} proName={proName} />}
        {tab === "facturacion" && isAdmin && <BillingTab patientId={id} proName={proName} />}
        {tab === "informacion" && <InfoTab patient={patient} professional={proName(patient.main_professional_id)} />}
      </div>
    </div>
  );
}

function InfoTab({ patient, professional }: { patient: Patient; professional?: string }) {
  const id = patient.id;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`/pacientes/${id}/editar`} className={buttonClass("secondary")}>
          <Pencil size={15} /> Editar
        </Link>
      </div>
      <InfoSection title="Datos personales">
        <Item label="DNI" value={patient.dni} />
        <Item label="CUIL" value={patient.cuil} />
        <Item label="Nacimiento" value={patient.birth_date && `${fmtDate(patient.birth_date)} · ${age(patient.birth_date)} años`} />
        <Item label="Sexo" value={patient.sex} />
        <Item label="Teléfono" value={patient.phone} />
        <Item label="Email" value={patient.email} />
        <Item label="Domicilio" value={patient.address} />
      </InfoSection>
      {(patient.tutor_name || patient.tutor_dni || patient.tutor_phone) && (
        <InfoSection title="Tutor o responsable">
          <Item label="Nombre" value={patient.tutor_name} />
          <Item label="DNI" value={patient.tutor_dni} />
          <Item label="Teléfono" value={patient.tutor_phone} />
        </InfoSection>
      )}
      <InfoSection title="Cobertura">
        <Item label="Cobertura" value={patient.obra_social?.name ?? "Particular"} />
        <Item label="Plan" value={patient.os_plan} />
        <Item label="N° de afiliado" value={patient.os_affiliate_number} />
        {patient.credential_file_path && <DocLink path={patient.credential_file_path} label="Credencial" />}
      </InfoSection>
      {patient.has_cud && (
        <InfoSection title="CUD">
          <Item label="N° de CUD" value={patient.cud_number} />
          <Item label="Diagnóstico del CUD" value={patient.cud_diagnosis} />
          <Item label="Emisión" value={patient.cud_issued && fmtDate(patient.cud_issued)} />
          <Item label="Vencimiento" value={patient.cud_expiry && fmtDate(patient.cud_expiry)} />
          {patient.cud_file_path && <DocLink path={patient.cud_file_path} label="Copia del CUD" />}
        </InfoSection>
      )}
      <InfoSection title="Clínico">
        <Item label="Profesional de cabecera" value={professional} />
        {/* Motivo y diagnóstico ahora van en cada tratamiento; se muestran solo si quedaron cargados de antes */}
        {patient.consult_reason && <Item label="Motivo de consulta" value={patient.consult_reason} />}
        {patient.diagnosis && <Item label="Diagnóstico" value={patient.diagnosis} />}
        <Item label="Antecedentes" value={patient.background} />
        <Item label="Observaciones" value={patient.notes} />
      </InfoSection>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">{title}</h2>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">{children}</dl>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value || "—"}</dd>
    </div>
  );
}

function DocLink({ path, label }: { path: string; label: string }) {
  return (
    <a href={fileHref(path)} target="_blank" className="flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">
      <FileText size={14} /> {label}
    </a>
  );
}

async function ClinicalTab({ patientId, archived }: { patientId: string; archived: boolean }) {
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("clinical_entries")
    .select("*, author:profiles!clinical_entries_author_id_fkey(full_name)")
    .eq("patient_id", patientId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  const entries = (data ?? []) as ClinicalEntry[];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div>
        {entries.length === 0 && <EmptyState title="Sin registros" />}
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <Card className={cn("p-4", e.voided_at && "bg-slate-50")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={KIND_STYLE[e.kind]}>{CLINICAL_KIND_LABEL[e.kind]}</Badge>
                    <h3 className={cn("font-medium", e.voided_at && "text-slate-400 line-through")}>{e.title}</h3>
                    {e.voided_at && <Badge className="bg-rose-100 text-rose-700">Anulado</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {fmtDate(e.entry_date)} {fmtDate(e.created_at, "HH:mm")} {e.author && `· ${e.author.full_name}`}
                    {!e.voided_at && <VoidEntryButton id={e.id} patientId={patientId} />}
                  </div>
                </div>
                <p className={cn("mt-2 whitespace-pre-wrap text-sm", e.voided_at ? "text-slate-400 line-through" : "text-slate-700")}>{e.content}</p>
                {e.voided_at && <p className="mt-2 text-xs text-rose-700">Anulado: {e.void_reason}</p>}
              </Card>
            </li>
          ))}
        </ol>
      </div>
      {!archived && <ClinicalEntryForm patientId={patientId} />}
    </div>
  );
}

async function TreatmentsTab({ patient, professionals }: { patient: Patient; professionals: Professional[] }) {
  const canEdit = professionals.length > 0;
  const { supabase } = await getSession();
  const [list, { data: fin }, customTariffs] = await Promise.all([
    fetchTreatments(supabase, { patientId: patient.id, includeArchived: true }),
    supabase.from("obras_sociales").select("id, name, type, default_via").is("archived_at", null).order("name"),
    fetchCustomTariffs(supabase),
  ]);
  const opts = { patients: [patient], financiadores: fin ?? [], professionals, customTariffs };
  const active = list.filter((t) => !t.archived_at);
  const archived = list.filter((t) => t.archived_at);
  return (
    <div className="space-y-4">
      {canEdit && <NewTreatmentButton opts={opts} patientId={patient.id} />}
      {active.length === 0 && <EmptyState title="Sin tratamientos activos" />}
      <div className="grid gap-3 md:grid-cols-2">
        {active.map((t) => <TreatmentCard key={t.id} t={t} opts={opts} canEdit={canEdit} />)}
      </div>
      {archived.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Archivados ({archived.length})</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {archived.map((t) => <TreatmentCard key={t.id} t={t} opts={opts} canEdit={canEdit} />)}
          </div>
        </details>
      )}
    </div>
  );
}

async function AppointmentsTab({ patientId, proName }: { patientId: string; proName: (id: string | null) => string | undefined }) {
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("appointments")
    .select("*, treatment:treatments(id, practice_name)")
    .eq("patient_id", patientId)
    .order("starts_at", { ascending: false })
    .limit(200);
  const appointments = (data ?? []) as Appointment[];
  if (appointments.length === 0) return <EmptyState title="Sin turnos" />;
  return (
    <Card className="divide-y divide-slate-100">
      {appointments.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
          <span className="flex flex-wrap items-center gap-3">
            <span className="w-28 font-medium capitalize">{fmtDate(a.starts_at, "EEE dd/MM/yy")}</span>
            <span className="text-slate-500">{fmtTime(a.starts_at)}</span>
            <span className="text-slate-500">{proName(a.professional_id)}</span>
            {a.treatment && <span className="text-slate-400">· {a.treatment.practice_name}</span>}
          </span>
          <Badge className={STATUS_STYLE[a.status].badge}>{STATUS_STYLE[a.status].label}</Badge>
        </div>
      ))}
    </Card>
  );
}

// "Abro el paciente y ya sé si se presentaron las facturas"
async function BillingTab({ patientId, proName }: { patientId: string; proName: (id: string | null) => string | undefined }) {
  const { supabase } = await getSession();
  const { rows, untreated } = await fetchBillingRows(supabase, { patientId });
  const loose = untreated.filter((u) => !u.invoiced);
  const periods = [...new Set(rows.map((r) => r.period))];
  return (
    <div className="space-y-3">
      {loose.map((u) => (
        <div key={u.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <span className="capitalize">{monthLabel(u.period)}</span> · {u.dates.length === 1 ? "1 sesión sin tratamiento" : `${u.dates.length} sesiones sin tratamiento`}
            {proName(u.professionalId) && <span className="text-amber-800/80"> · {proName(u.professionalId)}</span>}:{" "}
            {u.dates.map((d, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <Link href={`/agenda?vista=dia&fecha=${d}`} className="underline underline-offset-2">{fmtDate(d)}</Link>
              </span>
            ))}
          </span>
          <Link href={`/facturacion/preparar?marcar=${encodeURIComponent(u.key)}`} className="font-medium underline underline-offset-2">Facturar</Link>
        </div>
      ))}
      {periods.length === 0 && <EmptyState title="Sin sesiones atendidas" />}
      {periods.map((period) => (
        <Card key={period} className="overflow-hidden">
          <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold capitalize">{monthLabel(period)}</h3>
          <div className="divide-y divide-slate-100">
            {rows.filter((r) => r.period === period).map((r) => (
              <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <b>{r.treatment.practice_name}</b>
                  <span className="text-slate-500"> · {proName(r.treatment.professional_id) ?? "Sin profesional"} · {r.treatment.financiador?.name ?? "Particular"} · {r.dates.length} {r.dates.length === 1 ? "sesión" : "sesiones"}</span>
                </span>
                {r.invoices.length ? (
                  <span className="flex flex-wrap gap-2">
                    {r.invoices.map((inv) => (
                      <Link key={inv.id} href={`/facturacion?ver=${inv.id}`} className="flex items-center gap-2">
                        {inv.arca_number && <span className="tabular-nums text-xs text-slate-500">{invoiceNumber(inv)}</span>}
                        <span>{money(Number(inv.total))}</span>
                        <Badge className={INVOICE_STATUS_STYLE[inv.status]}>{inv.part === "copago" ? "Copago · " : ""}{STATUS_LABEL[inv.status]}</Badge>
                      </Link>
                    ))}
                  </span>
                ) : (
                  <Link href={`/facturacion/preparar?marcar=${encodeURIComponent(r.key)}`} className="flex items-center gap-1 font-medium text-rose-600 hover:underline">
                    Sin facturar
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
