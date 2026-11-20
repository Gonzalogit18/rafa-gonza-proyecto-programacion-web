import { Card, PageHeader } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import { ARCA_STATUS_SELECT, toArcaStatus } from "@/lib/arca-session";
import { getSession } from "@/lib/session";
import { ArcaCard } from "../configuracion/arca-ui";
import { PasswordForm, PhotoForm } from "./profile-forms";

export default async function PerfilPage() {
  const { supabase, profile, org, myProfessional } = await getSession();
  const arca = myProfessional && profile.role === "profesional"
    ? (await supabase.from("arca_credentials").select(ARCA_STATUS_SELECT).eq("professional_id", myProfessional.id).maybeSingle()).data
    : undefined;
  const rows = [
    ["Nombre", profile.full_name],
    ["Mail", profile.email],
    ["Rol", ROLE_LABEL[profile.role]],
    ["Clínica", org.name],
    ["Especialidad", myProfessional?.specialty],
    ["Matrícula", myProfessional?.matricula],
  ].filter(([, v]) => v);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Mi perfil" />
      <PhotoForm path={profile.avatar_path} name={profile.full_name} />
      <Card className="p-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-400">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {arca !== undefined && myProfessional && (
        <div className="space-y-2">
          <h2 className="font-semibold">Facturación electrónica en ARCA</h2>
          <ArcaCard pro={myProfessional} status={toArcaStatus(arca)} />
        </div>
      )}
      <PasswordForm />
    </div>
  );
}
