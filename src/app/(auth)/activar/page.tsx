import Link from "next/link";
import { Button } from "@/components/ui";
import { activateLink } from "../actions";

// El link se usa recién al tocar el botón: WhatsApp y los mails abren los links para armar la vista previa
export default async function ActivarPage({ searchParams }: PageProps<"/activar">) {
  const { token_hash, vencido } = (await searchParams) as { token_hash?: string; vencido?: string };
  if (!token_hash || vencido)
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold text-slate-900">Este link ya no sirve</h1>
        <p className="text-sm text-slate-500">Ya se usó o venció. Pedí uno nuevo.</p>
        <p className="text-sm">
          <Link href="/login" className="text-teal-700 hover:underline">Ir al inicio de sesión</Link>
        </p>
      </div>
    );
  return (
    <form action={activateLink} className="space-y-5">
      <input type="hidden" name="token_hash" value={token_hash} />
      <h1 className="text-2xl font-semibold text-slate-900">Te damos la bienvenida a MedApp</h1>
      <Button type="submit" className="w-full">Crear mi contraseña</Button>
    </form>
  );
}
