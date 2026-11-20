"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { buttonClass, cn } from "@/components/ui";

export type MoreItem = { label: string; icon?: ReactNode; href?: string; onClick?: () => void; download?: boolean };

// Acciones que se usan cada tanto: quedan detrás de un botón para que la pantalla esté limpia
// compact: en pantallas medianas muestra solo los tres puntos, para que el encabezado entre en un renglón
export function MoreMenu({ items, className, compact }: { items: MoreItem[]; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const itemClass = "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-100";
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button type="button" onClick={() => {
        // Se abre hacia el lado donde entra: en el celular el botón suele quedar a la izquierda
        const r = ref.current?.getBoundingClientRect();
        if (r) setAlignLeft(r.right < Math.min(288, window.innerWidth - 32) + 16);
        setOpen((o) => !o);
      }} aria-expanded={open} aria-haspopup="menu" aria-label="Más opciones" title="Más opciones" className={cn(buttonClass("secondary"), "w-full")}>
        <MoreHorizontal size={18} /> <span className={cn(compact && "hidden 2xl:inline")}>Más</span>
      </button>
      {open && (
        <div role="menu" className={cn("absolute z-30 mt-1.5", alignLeft ? "left-0" : "right-0", " w-72 max-w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_8px_24px_rgba(26,36,38,0.12)]")}>
          {items.map((it) =>
            it.href ? (
              it.download ? (
                <a key={it.label} role="menuitem" href={it.href} className={itemClass} onClick={() => setOpen(false)}>{it.icon}{it.label}</a>
              ) : (
                <Link key={it.label} role="menuitem" href={it.href} className={itemClass} onClick={() => setOpen(false)}>{it.icon}{it.label}</Link>
              )
            ) : (
              <button key={it.label} role="menuitem" type="button" className={itemClass} onClick={() => { setOpen(false); it.onClick?.(); }}>{it.icon}{it.label}</button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
