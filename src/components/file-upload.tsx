"use client";

import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Sube un archivo al bucket privado "documents" bajo la carpeta de la organización.
// Devuelve la ruta guardada (se le pasa al server action que corresponda).
export async function uploadDocument(orgId: string, folder: string, file: File) {
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const path = `${orgId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

export function FilePicker({ name = "file", label = "Adjuntar PDF o imagen" }: { name?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        name={name}
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-teal-400 hover:bg-teal-50"
      >
        <Paperclip size={16} /> {fileName ?? label}
      </button>
    </div>
  );
}

export const fileHref = (path: string) => `/archivo?path=${encodeURIComponent(path)}`;
