import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Organization, Professional, Profile, Role } from "./types";

// Usuario + perfil + organización + agendas que puede gestionar (cacheado por request).
//   admin: todas · profesional: la suya · secretaria: las asignadas por la administración
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, organization:organizations(*)")
    .eq("id", user.id)
    .single();
  if (!profile || !profile.active) redirect("/login?error=perfil");

  const { organization, ...rest } = profile as Profile & { organization: Organization };
  const p = rest as Profile;

  const { data: pros } = await supabase.from("professionals").select("*").eq("active", true).order("full_name");
  const all = (pros ?? []) as Professional[];
  let myProfessionals: Professional[];
  if (p.role === "admin") myProfessionals = all;
  else if (p.role === "profesional") myProfessionals = all.filter((x) => x.profile_id === user.id);
  else {
    const { data: asg } = await supabase.from("secretary_assignments").select("professional_id").eq("secretary_id", user.id);
    const ids = new Set((asg ?? []).map((a) => a.professional_id));
    myProfessionals = all.filter((x) => ids.has(x.id));
  }

  // Si además atiende, lo suyo aparece siempre primero
  myProfessionals.sort((a, b) => Number(b.profile_id === user.id) - Number(a.profile_id === user.id));

  return {
    supabase,
    user,
    profile: p,
    org: organization,
    myProfessional: all.find((x) => x.profile_id === user.id) ?? null,
    myProfessionals,
    isAdmin: p.role === "admin",
    // Cada uno factura lo suyo: administración todo, la asistente lo de sus médicos, el profesional lo propio
    canBill: p.role !== "profesional" || all.some((x) => x.profile_id === user.id),
    canSeeClinical: p.role !== "secretaria",
  };
});

// Corta la página si el rol no corresponde
export async function requireRole(...roles: Role[]) {
  const s = await getSession();
  if (!roles.includes(s.profile.role)) redirect("/?sin-permiso=1");
  return s;
}
