import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { MoreMenu } from "@/components/more-menu";
import { PatientSearch } from "@/components/patient-search";
import { Card, PageHeader, buttonClass, cn } from "@/components/ui";
import { fetchAll } from "@/lib/fetch-all";
import { format, parseISO, subYears } from "date-fns";
import { arToISO, fmtDate, todayAR } from "@/lib/format";
import { matchesSearch } from "@/lib/search";
import { getSession } from "@/lib/session";
import type { Patient } from "@/lib/types";


export default async function PacientesPage({ searchParams }: PageProps<"/pacientes">) {
  const { q, archivados } = (await searchParams) as { q?: string; archivados?: string };
  const { supabase, isAdmin } = await getSession();
  const showArchived = archivados === "1";

  const rows = await fetchAll<Patient>((from, to) => {
    const query = supabase.from("patients").select("*, obra_social:obras_sociales(id, name)");
    return (showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null)).order("last_name").order("first_name").range(from, to);
  });
  const all = rows.filter((p) => matchesSearch([p.last_name, p.first_name, p.dni, p.os_affiliate_number], q ?? ""));

  const patients = all;

  // Último turno de cada paciente (los de los últimos 12 meses)
  const today = todayAR();
  const since = arToISO(format(subYears(parseISO(today), 1), "yyyy-MM-dd"), "00:00");
  const recent = await fetchAll<{ patient_id: string; starts_at: string }>((from, to) =>
    supabase.from("appointments").select("patient_id, starts_at").neq("status", "cancelado").gte("starts_at", since).lte("starts_at", arToISO(today, "23:59")).order("starts_at", { ascending: false }).range(from, to),
  );
  const lastVisit = new Map<string, string>();
  recent.forEach((a) => !lastVisit.has(a.patient_id) && lastVisit.set(a.patient_id, a.starts_at));

  return (
    <div className="mx-auto max-w-[1160px]">
      <PageHeader
        title={showArchived ? "Pacientes archivados" : "Fichero de pacientes"}
        subtitle={`${all.length} pacientes ${showArchived ? "archivados" : "activos"}`}
        actions={
          <>
            <MoreMenu
              items={[
                showArchived ? { label: "Ver pacientes activos", href: "/pacientes" } : { label: "Ver pacientes archivados", href: "/pacientes?archivados=1" },
                ...(isAdmin ? [{ label: "Importar desde Excel", href: "/pacientes/importar" }] : []),
              ]}
            />
            <Link href="/pacientes/nuevo" className={buttonClass()}>
              <Plus size={18} strokeWidth={1.75} /> Nuevo paciente
            </Link>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <PatientSearch key={q ?? ""} defaultValue={q ?? ""} placeholder="Buscar por apellido, nombre, DNI o N° de afiliado" inputClassName="bg-white" extraParams={showArchived ? { archivados: "1" } : undefined} />
        </div>

        {patients.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium text-slate-900">{showArchived ? "No hay pacientes archivados" : "No hay pacientes para mostrar"}</p>
            {!showArchived && <Link href="/pacientes/nuevo" className={buttonClass("secondary", "mt-4")}>Cargar un paciente</Link>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Paciente</th>
                  <th className="px-3 py-2.5 font-medium">Cobertura</th>
                  <th className="hidden px-3 py-2.5 font-medium sm:table-cell">{showArchived ? "Archivado" : "Último turno"}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                      <tr key={p.id} className="relative border-b border-[#F0EEE9] hover:bg-slate-50">
                        <td className="py-3 pl-4 pr-2 sm:px-5">
                          <Link href={`/pacientes/${p.id}`} className="flex items-center gap-3 font-medium text-slate-900 after:absolute after:inset-0">
                            <span className="min-w-0 text-[15px]">{p.last_name}, {p.first_name}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-3 sm:px-3">
                          <span className="flex flex-wrap gap-1.5">
                            {p.has_cud && <Chip className="bg-violet-100 text-violet-800">CUD</Chip>}
                            {p.obra_social ? (
                              <Chip className="bg-sky-100 text-sky-800">{p.obra_social.name}{p.os_plan ? ` ${p.os_plan}` : ""}</Chip>
                            ) : (
                              <Chip className="bg-amber-100 text-amber-800">Particular</Chip>
                            )}
                          </span>
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                          {showArchived ? (p.archived_at ? fmtDate(p.archived_at) : "") : lastVisit.has(p.id) ? fmtDate(lastVisit.get(p.id)!, "d MMM yyyy") : <span className="text-slate-500">Sin turnos</span>}
                        </td>
                        <td className="pr-3 text-right text-slate-500 sm:pr-5"><ChevronRight size={18} strokeWidth={1.75} className="ml-auto" /></td>
                      </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium", className)}>{children}</span>;
}
