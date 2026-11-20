"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { updatePassword } from "../actions";

export default function NuevaContrasenaPage() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Elegí una contraseña nueva</h1>
      <Field label="Contraseña nueva">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <Field label="Repetila">
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      {state?.error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Guardando…" : "Guardar contraseña"}
      </Button>
    </form>
  );
}
