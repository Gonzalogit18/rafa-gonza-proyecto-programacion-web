// Crea usuarios de prueba (uno por rol) en la clínica de demo. SOLO base de PRUEBAS.
// Uso: crear la clínica y la cuenta de administración, correr este script y después cargar los datos de ejemplo desde el inicio.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sql = (q) => {
  const out = execSync(`npx supabase db query --linked -o json "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).rows;
};
const PASSWORD = "Demo1234!";
const [org] = sql("select id from public.organizations where name = 'Consultorio Demo'");
const pros = sql(`select id, full_name from public.professionals where organization_id = '${org.id}'`);
const proId = (name) => pros.find((p) => p.full_name === name)?.id ?? null;

const USERS = [
  { email: "secretaria@medapp.com.ar", name: "Laura Secretaria", role: "secretaria" },
  { email: "mateo@medapp.com.ar", name: "Mateo Fernández", role: "profesional", professional: "Mateo Fernández" },
  { email: "sofia@medapp.com.ar", name: "Sofía Romero", role: "profesional", professional: "Sofía Romero" },
];
for (const u of USERS) {
  const pid = u.professional ? proId(u.professional) : null;
  const [inv] = sql(
    `insert into public.invitations (organization_id, role, professional_id, email) values ('${org.id}', '${u.role}', ${pid ? `'${pid}'` : "null"}, '${u.email}') returning code`,
  );
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signUp({ email: u.email, password: PASSWORD, options: { data: { full_name: u.name, invite_code: inv.code } } });
  console.log(error ? `✘ ${u.email}: ${error.message}` : `✔ ${u.email} · ${u.role}`);
}
// La secretaria maneja las agendas de Agustina y Mateo, no la de Sofía
const [sec] = sql("select id from public.profiles where email = 'secretaria@medapp.com.ar'");
const now = sql(`select id, full_name from public.professionals where organization_id = '${org.id}'`);
const asg = now.filter((p) => p.full_name !== "Sofía Romero");
sql(`insert into public.secretary_assignments (organization_id, secretary_id, professional_id) values ${asg.map((p) => `('${org.id}', '${sec.id}', '${p.id}')`).join(", ")}`);
console.log(`✔ secretaria asignada a: ${asg.map((p) => p.full_name).join(", ")}`);
