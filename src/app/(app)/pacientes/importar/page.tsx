import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/session";
import { ImportForm } from "./import-form";

export default async function ImportarPage() {
  await requireRole("admin", "secretaria");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Importar pacientes" />
      <ImportForm />
    </div>
  );
}
