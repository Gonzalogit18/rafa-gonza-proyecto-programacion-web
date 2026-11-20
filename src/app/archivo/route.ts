import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

// Abre un archivo privado: genera un link temporal (1 minuto) solo si es de la clínica del usuario
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const { supabase, org } = await getSession();
  if (!path.startsWith(`${org.id}/`) || path.includes("..")) {
    return new Response("No autorizado", { status: 403 });
  }
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
  if (error || !data) return new Response("Archivo no encontrado", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
