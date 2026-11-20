const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Sin distinguir tildes ni mayúsculas, y cada palabra buscada puede estar en cualquier campo y en cualquier orden
export function matchesSearch(fields: (string | number | null | undefined)[], query: string) {
  const text = norm(fields.filter((f) => f != null).join(" "));
  return norm(query).split(/[\s,]+/).filter(Boolean).every((word) => text.includes(word));
}
