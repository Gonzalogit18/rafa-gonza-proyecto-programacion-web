import { LinkTabs, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { fetchCustomTariffs, fetchTreatments, treatmentAlert } from "@/lib/treatments";
import { NewTreatmentButton } from "./treatment-ui";
import { TreatmentsBrowser } from "./treatments-browser";

export default async function TratamientosPage({ searchParams }: PageProps<"/tratamientos">) {
  const { filtro = "activos" } = (await searchParams) as { filtro?: string };
  const { supabase, myProfessionals } = await getSession();

  const [list, { data: patients }, { data: fin }] = await Promise.all([
    fetchTreatments(supabase, { includeArchived: filtro === "archivados" }),
    supabase.from("patients").select("id, first_name, last_name, obra_social_id, has_cud, cud_expiry, os_affiliate_number, main_professional_id").is("archived_at", null).order("last_name"),
    supabase.from("obras_sociales").select("id, name, type, default_via").is("archived_at", null).order("name"),
  ]);
  const opts = { patients: patients ?? [], financiadores: fin ?? [], professionals: myProfessionals, customTariffs: await fetchCustomTariffs(supabase) };
  const alerts = list.filter((t) => !t.archived_at && treatmentAlert(t));
  const shown = filtro === "archivados" ? list.filter((t) => t.archived_at) : filtro === "alertas" ? alerts : list;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Tratamientos" actions={myProfessionals.length > 0 ? <NewTreatmentButton opts={opts} /> : undefined} />
      <LinkTabs
        tabs={[
          { id: "activos", label: "Activos", count: list.filter((t) => !t.archived_at).length },
          { id: "alertas", label: "Con alertas", count: alerts.length },
          { id: "archivados", label: "Archivados" },
        ]}
        current={filtro}
        href={(id) => `/tratamientos?filtro=${id}`}
      />
      <TreatmentsBrowser list={shown} opts={opts} compact={filtro === "archivados"} />
    </div>
  );
}
