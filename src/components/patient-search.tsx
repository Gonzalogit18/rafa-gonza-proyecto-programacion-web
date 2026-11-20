"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { suggestPatients, type PatientSuggestion } from "@/app/(app)/search-actions";
import { Avatar } from "./avatar";
import { cn } from "./ui";

// Buscador de pacientes con sugerencias mientras se escribe.
// Enter sin elegir una sugerencia filtra el fichero de pacientes.
export function PatientSearch({ defaultValue = "", placeholder, className, inputClassName, extraParams }: {
  defaultValue?: string;
  placeholder: string;
  className?: string;
  inputClassName?: string;
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<PatientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  // Pide sugerencias con una pequeña pausa, y descarta respuestas viejas
  useEffect(() => {
    const id = ++last.current;
    const t = setTimeout(() => {
      if (!q.trim()) return start(() => setItems([]));
      start(async () => {
        const r = await suggestPatients(q);
        if (id === last.current) {
          setItems(r);
          setActive(-1);
        }
      });
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // Se cierra al tocar afuera (en Safari, tocar un botón no le pasa el foco)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (p: PatientSuggestion) => {
    setOpen(false);
    router.push(`/pacientes/${p.id}`);
  };
  const submit = () => {
    if (active >= 0 && items[active]) return go(items[active]);
    setOpen(false);
    const params = new URLSearchParams({ ...extraParams, ...(q.trim() && { q: q.trim() }) });
    router.push(`/pacientes${params.size ? `?${params}` : ""}`);
  };

  const show = open && q.trim().length > 0;
  return (
    <div ref={box} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          role="combobox"
          aria-expanded={show}
          aria-controls="patient-suggestions"
          aria-label="Buscar paciente"
          autoComplete="off"
          placeholder={placeholder}
          className={cn(
            "min-h-11 w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm placeholder:text-slate-500 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20",
            inputClassName,
          )}
        />
      </form>
      {show && (
        <div id="patient-suggestions" role="listbox" className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 border-b-2 border-b-[#D8D5CD] bg-white py-1">
          {items.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-slate-500">Sin coincidencias</p>
          ) : (
            items.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active ? "bg-slate-100" : "hover:bg-slate-50")}
              >
                <Avatar name={p.name} size={28} />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
                {p.hint && <span className="shrink-0 text-xs text-slate-500">{p.hint}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
