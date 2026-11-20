"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { login } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Iniciar sesión</h1>
        
      </div>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Contraseña">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      {state?.error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
      <div className="text-center text-sm">
        <Link href="/recuperar" className="text-slate-500 hover:text-teal-700">
          Olvidé mi contraseña
        </Link>
      </div>
    </form>
  );
}
