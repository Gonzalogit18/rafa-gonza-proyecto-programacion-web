"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, ClipboardCheck, FileText, Home, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Users, X } from "lucide-react";
import { Avatar } from "./avatar";
import { cn } from "./ui";
import { logout } from "@/app/(auth)/actions";
import { ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";

const ALL: Role[] = ["admin", "secretaria", "profesional"];
type Item = { href: string; label: string; icon: typeof Home; roles: Role[] };
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Principal",
    items: [
      { href: "/", label: "Inicio", icon: Home, roles: ALL },
      { href: "/agenda", label: "Agenda", icon: CalendarDays, roles: ALL },
      { href: "/pacientes", label: "Pacientes", icon: Users, roles: ALL },
      { href: "/tratamientos", label: "Tratamientos", icon: ClipboardCheck, roles: ALL },
    ],
  },
  {
    title: "Gestión",
    items: [
      { href: "/facturacion", label: "Facturación", icon: FileText, roles: ALL },
      { href: "/balance", label: "Balance", icon: BarChart3, roles: ALL },
      { href: "/configuracion", label: "Configuración", icon: Settings, roles: ["admin", "secretaria"] },
    ],
  },
];

const KEY = "medapp-sidebar-collapsed";

export function Sidebar({ orgName, userName, role, avatarPath }: { orgName: string; userName: string; role: Role; avatarPath: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const brand = (mini: boolean) => (
    <div className={cn("mb-6 flex items-center gap-2.5", mini && "justify-center")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F6F6F3] text-base font-bold text-teal-600">M</span>
      {!mini && (
        <div className="min-w-0 leading-tight">
          <p className="font-semibold text-white">MedApp</p>
          <p className="truncate text-xs text-[var(--sidebar-muted)]">{orgName}</p>
        </div>
      )}
    </div>
  );

  const nav = (mini: boolean) => (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden whitespace-nowrap [scrollbar-width:none]">
      {GROUPS.map((g) => {
        const items = g.items.filter((n) => n.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={g.title} className="flex flex-col gap-1">
            {items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                title={mini ? label : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium transition",
                  mini ? "justify-center px-0" : "px-3",
                  isActive(href) ? "bg-[var(--sidebar-active)] text-white" : "text-[var(--sidebar-text)] hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" /> {!mini && label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );

  // La persona: al tocarla abre su perfil; al lado, cerrar sesión
  const footer = (mini: boolean) => (
    <div className={cn("mt-4 flex items-center gap-2 border-t border-[var(--sidebar-divider)] pt-4", mini && "flex-col")}>
      <Link href="/perfil" title="Mi perfil" onClick={() => setOpen(false)} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg", mini && "justify-center")}>
        <Avatar path={avatarPath} name={userName} size={36} />
        {!mini && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-white">{userName}</p>
            <p className="truncate text-xs text-[var(--sidebar-muted)]">{ROLE_LABEL[role]}</p>
          </div>
        )}
      </Link>
      <form action={logout}>
        <button aria-label="Cerrar sesión" title="Cerrar sesión" className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--sidebar-text)] hover:bg-white/5 hover:text-white">
          <LogOut size={18} strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Celular y tablet */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-[var(--sidebar)] px-4 py-1.5 lg:hidden print:hidden">
        <div className="flex items-center gap-2 font-semibold text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F6F6F3] text-sm font-bold text-teal-600">M</span> MedApp
        </div>
        <button onClick={() => setOpen(true)} aria-label="Menú" className="flex h-11 w-11 items-center justify-center text-white">
          <Menu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="animate-pop-in absolute inset-y-0 left-0 flex w-[248px] flex-col bg-[var(--sidebar)] px-3.5 py-5">
            <button className="absolute right-3 top-4 text-[var(--sidebar-text)]" onClick={() => setOpen(false)} aria-label="Cerrar">
              <X size={20} />
            </button>
            {brand(false)}
            {nav(false)}
            {footer(false)}
          </aside>
        </div>
      )}
      {/* Escritorio: se puede achicar a solo íconos */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden whitespace-nowrap bg-[var(--sidebar)] py-5 transition-[width] duration-200 lg:flex print:hidden",
          collapsed ? "w-[72px] px-2.5" : "w-[248px] px-3.5",
        )}
      >
        {brand(collapsed)}
        {nav(collapsed)}
        <button
          onClick={toggle}
          title={collapsed ? "Mostrar menú" : "Ocultar menú"}
          className={cn("mt-3 flex min-h-11 items-center gap-3 rounded-lg text-sm text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-white", collapsed ? "justify-center" : "px-3")}
        >
          {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} /> : <PanelLeftClose size={18} strokeWidth={1.75} />} {!collapsed && "Ocultar menú"}
        </button>
        {footer(collapsed)}
      </aside>
    </>
  );
}
