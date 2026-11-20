"use client";

import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { useDialog } from "@/components/dialog";
import { Button, Card, Field, Input } from "@/components/ui";
import { changePassword, removePhoto, savePhoto } from "./actions";

export function PhotoForm({ path, name }: { path: string | null; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { ask } = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-wrap items-center gap-5 p-5">
      <Avatar path={path} name={name} size={88} />
      <div className="space-y-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.set("photo", file);
            start(async () => {
              setError(null);
              const r = await savePhoto(fd);
              if (r.error) setError(r.error);
            });
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => input.current?.click()}>{pending ? "Guardando…" : path ? "Cambiar foto" : "Subir foto"}</Button>
          {path && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (await ask("¿Sacar tu foto de perfil?", "Sacar")) start(async () => void (await removePhoto()));
              }}
            >
              Sacar foto
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Card>
  );
}

export function PasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Cambiar contraseña</h2>
      <form
        ref={form}
        action={(fd) =>
          start(async () => {
            setMsg(null);
            const r = await changePassword({ current: String(fd.get("current")), next: String(fd.get("next")), confirm: String(fd.get("confirm")) });
            if (r.error) setMsg({ ok: false, text: r.error });
            else {
              form.current?.reset();
              setMsg({ ok: true, text: "Contraseña cambiada." });
            }
          })
        }
        className="grid gap-3 sm:grid-cols-3"
      >
        <Field label="Contraseña actual"><Input name="current" type="password" required autoComplete="current-password" /></Field>
        <Field label="Contraseña nueva"><Input name="next" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <Field label="Repetir contraseña"><Input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <div className="flex items-center justify-between gap-3 sm:col-span-3">
          <span className={msg?.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg?.text}</span>
          <Button type="submit" disabled={pending}>Guardar</Button>
        </div>
      </form>
    </Card>
  );
}
