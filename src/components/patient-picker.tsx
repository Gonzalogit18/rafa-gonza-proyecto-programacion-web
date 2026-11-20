"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fullName } from "@/lib/format";
import { matchesSearch } from "@/lib/search";

type Item = { id: string; first_name: string; last_name: string; hint?: string };

// Buscador de pacientes: se escribe el nombre y se elige de la lista
export function PatientPicker({
  patients,
  value,
  onChange,
  disabled,
  placeholder = "Buscar paciente…",
}: {
  patients: Item[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = patients.find((p) => p.id === value);
  const shown = useMemo(() => {
    return patients.filter((p) => matchesSearch([p.last_name, p.first_name], q)).slice(0, 40);
  }, [patients, q]);

  // Se cierra al tocar afuera: en Safari, tocar un botón no le pasa el foco y la lista se cerraba antes de elegir
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (selected)
    return (
      <div onClick={(e) => e.preventDefault()} className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <span className="truncate font-medium">{fullName(selected)}</span>
        {!disabled && (
          <button type="button" onClick={() => onChange("")} className="text-slate-400 hover:text-slate-700" aria-label="Cambiar paciente">
            <X size={15} />
          </button>
        )}
      </div>
    );

  return (
    <div ref={box} className="relative" onBlur={(e) => e.relatedTarget && !box.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Sin resultados</p>}
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(e) => {
                // Dentro de un <label>, el click se reenviaría al botón de quitar paciente
                e.preventDefault();
                onChange(p.id);
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50"
            >
              <span className="truncate">{fullName(p)}</span>
              {p.hint && <span className="shrink-0 text-xs text-slate-400">{p.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
