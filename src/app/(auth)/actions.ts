"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; info?: string } | undefined;

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")).trim(),
    password: String(formData.get("password")),
  });
  if (error) return { error: "Email o contraseña incorrectos." };
  redirect("/");
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  await supabase.auth.resetPasswordForEmail(String(formData.get("email")).trim(), {
    redirectTo: `${origin}/auth/confirm?next=/nueva-contrasena`,
  });
  // Misma respuesta exista o no la cuenta (no revelar qué mails están registrados)
  return { info: "Si el mail tiene una cuenta, te llegó un link para elegir una contraseña nueva." };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password"));
  if (password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  if (password !== String(formData.get("confirm"))) return { error: "Las contraseñas no coinciden." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "No se pudo cambiar la contraseña. Pedí un link nuevo." };
  redirect("/");
}

export async function activateLink(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: String(formData.get("token_hash")) });
  redirect(error ? "/activar?vencido=1" : "/nueva-contrasena");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
