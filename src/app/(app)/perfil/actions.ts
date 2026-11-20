"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { saveUpload } from "@/lib/storage";

export async function savePhoto(formData: FormData): Promise<{ error?: string }> {
  const { supabase, org, profile } = await getSession();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí una foto." };
  if (!file.type.startsWith("image/")) return { error: "El archivo tiene que ser una imagen." };
  try {
    const path = await saveUpload(supabase, org.id, "fotos", file);
    const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", profile.id);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir la foto" };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function removePhoto(): Promise<{ error?: string }> {
  const { supabase, profile } = await getSession();
  const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", profile.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function changePassword(input: { current: string; next: string; confirm: string }): Promise<{ error?: string }> {
  const { supabase, user } = await getSession();
  if (input.next.length < 8) return { error: "La contraseña nueva tiene que tener al menos 8 caracteres." };
  if (input.next !== input.confirm) return { error: "Las contraseñas nuevas no coinciden." };
  const { error: wrong } = await supabase.auth.signInWithPassword({ email: user.email!, password: input.current });
  if (wrong) return { error: "La contraseña actual no es correcta." };
  const { error } = await supabase.auth.updateUser({ password: input.next });
  if (error) return { error: "No se pudo cambiar la contraseña." };
  return {};
}
