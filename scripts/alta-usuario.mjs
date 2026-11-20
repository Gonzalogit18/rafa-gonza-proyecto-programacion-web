// Alta de usuarios de una clínica (lo hace el equipo de MedApp, no la clínica).
//
// Uso:
//   node scripts/alta-usuario.mjs --clinica "Consultorio Demo" --email x@y.com --nombre "Ana Pérez" \
//        --rol admin|secretaria|profesional [--agenda] [--especialidad "..."] [--matricula "..."]
//
//   --agenda       solo para admin: además de administrar, atiende y tiene agenda propia
//   --clinica      si no existe, se crea
//   --clave        opcional. Sin ella se crea una al azar que nadie conoce y el usuario elige la suya con scripts/link-contrasena.mjs
//
// Para asignar profesionales a una secretaria se usa Configuración → Usuarios (lo hace la administración).
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(process.env.ENV_FILE ?? ".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
for (const k of ["clinica", "email", "nombre", "rol"]) if (!args[k]) throw new Error(`Falta --${k}`);
if (!["admin", "secretaria", "profesional"].includes(args.rol)) throw new Error("--rol tiene que ser admin, secretaria o profesional");

const q = (s) => s.replace(/'/g, "''");
const sql = (query) => {
  const out = execSync(`npx supabase db query --linked -o json "${query.replace(/"/g, '\\"')}"`, { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).rows;
};

let [org] = sql(`select id from public.organizations where name = '${q(args.clinica)}'`);
if (!org) {
  [org] = sql(`insert into public.organizations (name) values ('${q(args.clinica)}') returning id`);
  console.log(`Clínica creada: ${args.clinica}`);
}
const withAgenda = args.rol === "profesional" || !!args.agenda;
const [inv] = sql(
  `insert into public.invitations (organization_id, role, with_agenda, email) values ('${org.id}', '${args.rol}', ${args.rol === "admin" && withAgenda}, '${q(args.email)}') returning code`,
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error } = await supabase.auth.signUp({
  email: args.email,
  password: args.clave ?? randomBytes(24).toString("base64url"),
  options: { data: { full_name: args.nombre, invite_code: inv.code } },
});
if (error) throw new Error(error.message);
if (withAgenda && (args.especialidad || args.matricula)) {
  sql(
    `update public.professionals set specialty = ${args.especialidad ? `'${q(args.especialidad)}'` : "specialty"}, matricula = ${args.matricula ? `'${q(args.matricula)}'` : "matricula"} where profile_id = (select id from public.profiles where email = '${q(args.email)}')`,
  );
}
console.log(`✔ ${args.email} · ${args.rol}${withAgenda ? " · con agenda" : ""} · ${args.clinica}`);
