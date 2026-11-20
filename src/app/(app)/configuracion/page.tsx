import { Avatar } from "@/components/avatar";
import { Badge, Button, Card, Field, Input, LinkTabs, PageHeader, Select } from "@/components/ui";
import { ARCA_STATUS_SELECT, toArcaStatus } from "@/lib/arca-session";
import { ROLE_LABEL } from "@/lib/format";
import { requireRole } from "@/lib/session";
import type { ObraSocial, Professional, Profile, Tariff, TariffReference } from "@/lib/types";
import { saveOrganization } from "./actions";
import { ArcaCard } from "./arca-ui";
import { CoberturasList, ProfessionalEditor, SecretaryAssignments } from "./config-ui";
import { TariffsBoard } from "./tariffs-board";

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const { org, isAdmin } = await requireRole("admin", "secretaria");
  const sp = (await searchParams) as { tab?: string };
  const TABS = isAdmin
    ? [
        { id: "profesionales", label: "Profesionales" },
        { id: "coberturas", label: "Coberturas" },
        { id: "tarifas", label: "Tarifas" },
        { id: "arca", label: "ARCA" },
        { id: "usuarios", label: "Usuarios" },
        { id: "clinica", label: "Clínica" },
      ]
    : [
        { id: "coberturas", label: "Coberturas" },
        { id: "tarifas", label: "Tarifas" },
      ];
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : TABS[0].id;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Configuración" />
      {TABS.length > 1 && <LinkTabs tabs={TABS} current={tab} href={(id) => `/configuracion?tab=${id}`} />}

      {tab === "profesionales" && isAdmin && <ProfessionalsTab />}
      {tab === "coberturas" && <CoberturasTab />}
      {tab === "tarifas" && <TariffsTab />}
      {tab === "arca" && isAdmin && <ArcaTab />}
      {tab === "usuarios" && isAdmin && <UsersTab />}
      {tab === "clinica" && isAdmin && (
        <Card className="p-6">
          <form action={saveOrganization} className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre"><Input name="name" defaultValue={org.name} required /></Field>
            <Field label="Razón social"><Input name="razon_social" defaultValue={org.razon_social ?? ""} /></Field>
            <Field label="CUIT"><Input name="cuit" defaultValue={org.cuit ?? ""} /></Field>
            <Field label="Condición IVA">
              <Select name="condicion_iva" defaultValue={org.condicion_iva ?? "monotributo"}>
                <option value="monotributo">Monotributo</option>
                <option value="responsable_inscripto">Responsable inscripto</option>
                <option value="exento">Exento</option>
              </Select>
            </Field>
            <Field label="Punto de venta"><Input name="punto_venta" type="number" min={1} defaultValue={org.punto_venta ?? 1} /></Field>
            <Field label="Ingresos brutos"><Input name="ingresos_brutos" defaultValue={org.ingresos_brutos ?? ""} /></Field>
            <Field label="Inicio de actividades"><Input name="inicio_actividades" type="date" defaultValue={org.inicio_actividades ?? ""} /></Field>
            <Field label="Domicilio"><Input name="address" defaultValue={org.address ?? ""} /></Field>
            <Field label="Teléfono"><Input name="phone" defaultValue={org.phone ?? ""} /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={org.email ?? ""} /></Field>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit">Guardar</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

async function ProfessionalsTab() {
  const { supabase } = await requireRole("admin");
  const { data } = await supabase.from("professionals").select("*").eq("active", true).order("full_name");
  return <div className="space-y-2">{((data ?? []) as Professional[]).map((p) => <ProfessionalEditor key={p.id} p={p} />)}</div>;
}

// Conexión de cada profesional con ARCA, para emitir sus facturas desde la app
async function ArcaTab() {
  const { supabase } = await requireRole("admin");
  const [{ data: pros }, { data: creds }] = await Promise.all([
    supabase.from("professionals").select("id, full_name, cuit").eq("active", true).order("full_name"),
    supabase.from("arca_credentials").select(ARCA_STATUS_SELECT),
  ]);
  return (
    <div className="space-y-3">
      {(pros ?? []).map((p) => (
        <ArcaCard key={p.id} pro={p} status={toArcaStatus((creds ?? []).find((c) => c.professional_id === p.id))} />
      ))}
    </div>
  );
}

async function CoberturasTab() {
  const { supabase } = await requireRole("admin", "secretaria");
  const { data } = await supabase.from("obras_sociales").select("*").order("name");
  return <CoberturasList list={(data ?? []) as ObraSocial[]} />;
}

async function TariffsTab() {
  const { supabase, isAdmin } = await requireRole("admin", "secretaria");
  const [{ data: tariffs }, { data: fin }, { data: refs }] = await Promise.all([
    supabase.from("tariffs").select("*").order("tariff").order("valid_from", { ascending: false }),
    supabase.from("obras_sociales").select("id, name, type, default_via").is("archived_at", null).order("name"),
    supabase.from("tariff_reference").select("*"),
  ]);
  return <TariffsBoard tariffs={(tariffs ?? []) as Tariff[]} financiadores={fin ?? []} references={(refs ?? []) as TariffReference[]} canEdit={isAdmin} />;
}

// Usuarios: solo consulta. Las cuentas y los roles los maneja el equipo de MedApp.
// Acá la administración decide qué médicos maneja cada secretaria.
async function UsersTab() {
  const { supabase } = await requireRole("admin");
  const [{ data: team }, { data: pros }, { data: asg }] = await Promise.all([
    supabase.from("profiles").select("*").eq("active", true).order("full_name"),
    supabase.from("professionals").select("*").eq("active", true).order("full_name"),
    supabase.from("secretary_assignments").select("secretary_id, professional_id"),
  ]);
  const users = (team ?? []) as Profile[];
  const secretaries = users.filter((u) => u.role === "secretaria");
  return (
    <div className="space-y-6">
      <Card className="divide-y divide-slate-100">
        {users.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar path={m.avatar_path} name={m.full_name} size={30} />
              <span className="min-w-0 truncate">
                <span className="font-medium">{m.full_name}</span>
                <span className="text-slate-500"> · {m.email}</span>
              </span>
            </span>
            <Badge className="bg-slate-100 text-slate-600">{ROLE_LABEL[m.role]}</Badge>
          </div>
        ))}
      </Card>
      {secretaries.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold">Profesionales de cada asistente</h2>
          {secretaries.map((s) => (
            <SecretaryAssignments
              key={s.id}
              secretary={s}
              professionals={(pros ?? []) as Professional[]}
              assigned={(asg ?? []).filter((a) => a.secretary_id === s.id).map((a) => a.professional_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
