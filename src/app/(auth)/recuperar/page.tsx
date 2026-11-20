"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { requestPasswordReset } from "../actions";

export default function RecuperarPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Recuperar contraseña</h1>
        <p className="mt-1 text-sm text-slate-500">Te mandamos un link por mail para elegir una nueva.</p>
      </div>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      {state?.info && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{state.info}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando…" : "Enviar link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-teal-700 hover:underline">Volver al inicio de sesión</Link>
      </p>
    </form>
  );
}
