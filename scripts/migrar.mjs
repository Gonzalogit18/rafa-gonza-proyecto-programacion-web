// Aplica a una base los cambios pendientes de supabase/migrations, en orden y una sola vez.
// Uso: node scripts/migrar.mjs pruebas | produccion
// Las migraciones solo agregan: en producción se rechaza cualquier archivo que pueda borrar datos.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const REFS = { pruebas: "ljawbbqbvrpufevoguik", produccion: process.env.PROD_REF ?? "" };
const target = process.argv[2];
if (!REFS[target]) {
  console.error("Uso: node scripts/migrar.mjs pruebas | produccion (producción necesita PROD_REF)");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sql = (q) => {
  const out = run(`npx supabase db query --linked -o json "${q.replace(/"/g, '\\"')}"`);
  return JSON.parse(out.slice(out.indexOf("{"))).rows;
};
const DESTRUCTIVE = /\b(drop\s+table|drop\s+column|drop\s+schema|truncate|delete\s+from)\b/i;

run(`npx supabase link --project-ref ${REFS[target]}`);
try {
  sql("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  sql("alter table public.schema_migrations enable row level security");
  const applied = new Set(sql("select name from public.schema_migrations").map((r) => r.name));
  const pending = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
  if (pending.length === 0) console.log(`${target}: al día`);
  for (const f of pending) {
    const path = `supabase/migrations/${f}`;
    if (target === "produccion" && DESTRUCTIVE.test(readFileSync(path, "utf8"))) throw new Error(`${f} puede borrar datos: no se aplica en producción`);
    run(`npx supabase db query --linked -f ${path}`);
    sql(`insert into public.schema_migrations (name) values ('${f}')`);
    console.log(`✔ ${target}: ${f}`);
  }
} finally {
  // El proyecto queda vinculado siempre a la base de pruebas
  if (target !== "pruebas") run(`npx supabase link --project-ref ${REFS.pruebas}`);
}
