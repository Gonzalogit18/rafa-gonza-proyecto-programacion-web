// Archivos para abrir en Excel: separador ";" y BOM para que respete los acentos
const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  // Una celda que empieza con estos signos Excel la toma como fórmula
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvResponse(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const body = [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
