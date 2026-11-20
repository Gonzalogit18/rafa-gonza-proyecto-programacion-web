import clsx from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, Ref } from "react";

export { clsx as cn };

type Variant = "primary" | "secondary" | "ghost" | "danger";

// Botones como teclas: borde de 1 px y un borde inferior de 2 px más oscuro, que se hunde al tocar
const VARIANTS: Record<Variant, string> = {
  primary: "border border-teal-700 border-b-2 border-b-teal-900 bg-teal-600 text-white hover:bg-teal-700",
  secondary: "border border-slate-300 border-b-2 border-b-[#CCC8BF] bg-white text-slate-900 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "border border-rose-700 border-b-2 border-b-rose-800 bg-rose-600 text-white hover:bg-rose-700",
};
const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition active:translate-y-px active:border-b focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      className={clsx(
        BUTTON_BASE,
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export const buttonClass = (variant: Variant = "primary", extra?: string) =>
  clsx(BUTTON_BASE, VARIANTS[variant], extra);

const fieldClass =
  "w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldClass, "min-h-24", className)} {...props} />;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-xl border border-slate-200 border-b-2 border-b-[#D8D5CD] bg-white", className)}>{children}</div>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

// Pestañas como links (la pestaña activa vive en la URL)
export function LinkTabs({ tabs, current, href }: { tabs: { id: string; label: string; count?: number }[]; current: string; href: (id: string) => string }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={href(t.id)}
          className={clsx(
            "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
            current === t.id ? "border-teal-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
