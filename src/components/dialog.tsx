"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Textarea } from "./ui";

type Request = { message: string; kind: "ask" | "text" | "notice"; confirmLabel?: string; resolve: (v: string | boolean | null) => void };
type Dialog = {
  ask: (message: string, confirmLabel?: string) => Promise<boolean>;
  askText: (message: string) => Promise<string | null>;
  notify: (message: string) => Promise<void>;
};

const Ctx = createContext<Dialog | null>(null);

export const useDialog = () => {
  const d = useContext(Ctx);
  if (!d) throw new Error("Falta DialogProvider");
  return d;
};

// Confirmaciones dentro de la página, en lugar de los avisos del navegador
export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const open = useCallback(
    (r: Omit<Request, "resolve">) =>
      new Promise<string | boolean | null>((resolve) => {
        // Fuera de la transición: dentro de la acción de un formulario, React no mostraría el aviso hasta que la acción termine
        setTimeout(() => {
          setText("");
          setReq({ ...r, resolve });
        });
      }),
    [],
  );
  const api = useMemo<Dialog>(
    () => ({
      ask: async (message, confirmLabel) => (await open({ message, kind: "ask", confirmLabel })) === true,
      askText: async (message) => {
        const r = await open({ message, kind: "text" });
        return typeof r === "string" ? r : null;
      },
      notify: async (message) => {
        await open({ message, kind: "notice" });
      },
    }),
    [open],
  );

  const close = (value: string | boolean | null) => {
    req?.resolve(value);
    setReq(null);
  };

  useEffect(() => {
    if (!req) return;
    if (req.kind !== "text") confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        req.resolve(null);
        setReq(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {req && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div className="animate-fade-in absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => close(null)} />
          <div className="animate-pop-in relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="whitespace-pre-line text-base font-medium text-slate-900">{req.message}</p>
            {req.kind === "text" && <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-3" />}
            <div className="mt-5 flex justify-end gap-2">
              {req.kind !== "notice" && <Button variant="secondary" onClick={() => close(null)}>Cancelar</Button>}
              <Button
                ref={confirmBtn}
                disabled={req.kind === "text" && !text.trim()}
                onClick={() => close(req.kind === "text" ? text.trim() : true)}
              >
                {req.kind === "notice" ? "Entendido" : req.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
