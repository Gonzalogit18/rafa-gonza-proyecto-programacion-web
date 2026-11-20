import type { SupabaseClient } from "@supabase/supabase-js";

// Guarda un archivo de un formulario en el bucket privado de la clínica. Devuelve la ruta, o undefined si no se adjuntó nada.
export async function saveUpload(supabase: SupabaseClient, orgId: string, folder: string, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return undefined;
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const path = `${orgId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return path;
}
