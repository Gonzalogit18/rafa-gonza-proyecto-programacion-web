// Uso (solo pruebas): node scripts/session-cookie.mjs email password [codigo-invitacion]
// Inicia sesión (o crea la cuenta con el código) y escribe la cookie de sesión por stdout.
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const [email, password, code] = process.argv.slice(2);
const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => jar.set(name, value)) },
});
let { error } = await sb.auth.signInWithPassword({ email, password });
if (error && code) {
  const r = await sb.auth.signUp({ email, password, options: { data: { full_name: process.env.FULL_NAME ?? email.split("@")[0], invite_code: code, specialty: "Kinesiología", matricula: "MP 0000" } } });
  if (r.error) { console.error("signup:", r.error.message); process.exit(1); }
  error = null;
}
if (error) { console.error("login:", error.message); process.exit(1); }
console.log([...jar].map(([n, v]) => `${n}=${v}`).join("; "));
