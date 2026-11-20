"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { importPatients } from "../actions";

const COLUMNS = ["apellido", "nombre", "dni", "cuil", "nacimiento", "telefono", "email", "domicilio", "cobertura", "plan", "afiliado", "cud", "cud_numero", "cud_vencimiento", "diagnostico", "motivo_consulta", "antecedentes", "profesional", "tutor", "tutor_telefono", "observaciones"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

// Parser CSV simple: soporta comillas, separador "," o ";" (Excel en español usa ";")
function parseCSV(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function ImportForm() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = async (file: File) => {
    setResult(null);
    const text = await file.text();
    const [header, ...body] = parseCSV(text.replace(/^﻿/, ""));
    const keys = header.map(norm);
    setRows(body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""]))));
  };

  const template = () => {
    const csv = "﻿" + COLUMNS.join(";") + "\nPérez;María;30111222;27301112224;15/03/1980;2262 555000;maria@mail.com;Calle 1 123;OSDE;210;61234567801;no;Lumbalgia;\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-pacientes.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <p className="text-sm text-slate-600">Completá la plantilla en Excel y guardala como <b>CSV</b>. Solo apellido y nombre son obligatorios.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={template}>
            <Download size={16} /> Descargar plantilla
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700">
            <Upload size={16} /> Elegir archivo CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm">
              <b>{rows.length}</b> filas encontradas. Revisá la vista previa:
            </p>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await importPatients(rows);
                  setResult(r.error ? `Error: ${r.error}` : `Se importaron ${r.inserted} pacientes${r.skipped ? ` (${r.skipped} filas salteadas por no tener apellido o nombre)` : ""}.`);
                  if (!r.error) setRows([]);
                })
              }
            >
              {pending ? "Importando…" : `Importar ${rows.length} pacientes`}
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>{COLUMNS.slice(0, 12).map((c) => <th key={c} className="px-2 py-2">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {COLUMNS.slice(0, 12).map((c) => <td key={c} className="px-2 py-1.5">{r[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {result && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {result} <Link href="/pacientes" className="font-medium underline">Ver fichero</Link>
        </p>
      )}
    </div>
  );
}
