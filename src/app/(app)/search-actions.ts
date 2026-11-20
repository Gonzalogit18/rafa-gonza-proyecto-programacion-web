"use server";

import { fetchAll } from "@/lib/fetch-all";
import { matchesSearch } from "@/lib/search";
import { getSession } from "@/lib/session";

export type PatientSuggestion = { id: string; name: string; hint: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Sugerencias del buscador de pacientes: primero los que empiezan con lo escrito
export async function suggestPatients(query: string): Promise<PatientSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const { supabase } = await getSession();
  const rows = await fetchAll<{ id: string; first_name: string; last_name: string; dni: string | null; os_affiliate_number: string | null; obra_social: { name: string } | null }>(
    (from, to) =>
      supabase
        .from("patients")
        .select("id, first_name, last_name, dni, os_affiliate_number, obra_social:obras_sociales(name)")
        .is("archived_at", null)
        .order("last_name")
        .order("first_name")
        .range(from, to),
  );
  const first = norm(q).split(/[\s,]+/)[0];
  const starts = (p: { first_name: string; last_name: string }) => norm(`${p.last_name} ${p.first_name}`).split(/\s+/).some((w) => w.startsWith(first));
  return rows
    .filter((p) => matchesSearch([p.last_name, p.first_name, p.dni, p.os_affiliate_number], q))
    .sort((a, b) => Number(starts(b)) - Number(starts(a)))
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: `${p.last_name}, ${p.first_name}`, hint: p.obra_social?.name ?? (p.dni ? `DNI ${p.dni}` : null) }));
}
