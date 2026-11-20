// Test de seguridad contra la base de PRUEBAS (nunca contra producción).
// Uso: node scripts/test-security.mjs
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
const client = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const run = Date.now().toString(36);
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
async function signup(code, name) {
  const c = client();
  const { error } = await c.auth.signUp({ email: `test-${name}-${run}@example.com`, password: "Test12345!", options: { data: { full_name: name, invite_code: code } } });
  if (error) throw new Error(`${name}: ${error.message}`);
  return c;
}
const invite = (org, role, professionalId = null) =>
  sql(`insert into public.invitations (organization_id, role, professional_id) values ('${org}', '${role}', ${professionalId ? `'${professionalId}'` : "null"}) returning code`)[0].code;

console.log("Creando clínicas de prueba…");
const [{ code: codeA }] = sql(`select public.create_clinic('Test A ${run}') as code`);
const [{ code: codeB }] = sql(`select public.create_clinic('Test B ${run}') as code`);
const adminA = await signup(codeA, "adminA");
const adminB = await signup(codeB, "adminB");
const { data: profA } = await adminA.from("profiles").select("organization_id").single();
const orgA = profA.organization_id;
const { data: proA } = await adminA.from("professionals").select("id").single();
check("La administración de una clínica nueva tiene agenda propia", !!proA);
// Segundo profesional de la clínica A (las altas las hace el equipo de MedApp)
const [{ id: proB }] = sql(`insert into public.professionals (organization_id, full_name) values ('${orgA}', 'Otro ${run}') returning id`);

{
  const c = client();
  const { error } = await c.auth.signUp({ email: `test-nocode-${run}@example.com`, password: "Test12345!", options: { data: { full_name: "x" } } });
  check("No se puede crear una cuenta sin código", !!error);
  const { error: e2 } = await c.auth.signUp({ email: `test-reuse-${run}@example.com`, password: "Test12345!", options: { data: { full_name: "x", invite_code: codeA } } });
  check("Un código no se puede usar dos veces", !!e2);
  const { error: e3 } = await adminA.from("invitations").insert({ organization_id: orgA, role: "admin" });
  check("Nadie puede crear invitaciones desde la app, ni la administración", !!e3);
  const { error: e4 } = await adminA.from("professionals").insert({ organization_id: orgA, full_name: "x" });
  check("Nadie puede dar de alta profesionales desde la app", !!e4);
}

// Datos de A: paciente de proA y paciente de proB
const { data: patA, error: ep } = await adminA.from("patients").insert({ organization_id: orgA, first_name: "Ana", last_name: "Prueba", main_professional_id: proA.id }).select("id").single();
check("Admin carga un paciente", !ep, ep?.message);
const { data: patB } = await adminA.from("patients").insert({ organization_id: orgA, first_name: "Beto", last_name: "Prueba", main_professional_id: proB }).select("id").single();
const { data: entry } = await adminA.from("clinical_entries").insert({ organization_id: orgA, patient_id: patA.id, title: "Consulta", content: "Texto original" }).select("id").single();
const start = new Date(Date.now() + 86400000).toISOString();
const end = new Date(Date.now() + 86400000 + 45 * 60000).toISOString();
const { data: appt, error: ea } = await adminA.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proA.id, starts_at: start, ends_at: end }).select("id").single();
check("Admin agenda un turno", !ea, ea?.message);
const { data: inv } = await adminA.from("invoices").insert({ organization_id: orgA, kind: "particular", patient_id: patA.id, professional_id: proA.id, total: 1000 }).select("id").single();
const { data: invB } = await adminA.from("invoices").insert({ organization_id: orgA, kind: "particular", patient_id: patB.id, professional_id: proB, total: 500 }).select("id").single();

// --- Aislamiento entre clínicas
{
  const { data } = await adminB.from("patients").select("id");
  check("La clínica B no ve pacientes de A", (data ?? []).length === 0);
  const { data: hc } = await adminB.from("clinical_entries").select("id");
  check("La clínica B no ve historias clínicas de A", (hc ?? []).length === 0);
  const { data: i2 } = await adminB.from("invoices").select("id");
  check("La clínica B no ve facturas de A", (i2 ?? []).length === 0);
  const { error } = await adminB.from("patients").insert({ organization_id: orgA, first_name: "Intruso", last_name: "X" });
  check("La clínica B no puede cargar datos en A", !!error);
  const { data: upd } = await adminB.from("patients").update({ first_name: "Hackeado" }).eq("id", patA.id).select("id");
  check("La clínica B no puede modificar datos de A", (upd ?? []).length === 0);
}

// --- Turnos
{
  const { error: e1 } = await adminA.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proA.id, starts_at: start, ends_at: end });
  check("No se superponen turnos del mismo profesional", e1?.code === "23P01", e1?.message);
  const { error: e2 } = await adminA.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proA.id, starts_at: start, ends_at: end, is_overbook: true });
  check("Sí se permite como sobreturno", !e2, e2?.message);
  const { error: e3 } = await adminA.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proA.id, starts_at: "1900-01-01T10:00:00Z", ends_at: "1900-01-01T11:00:00Z" });
  check("No se puede agendar en el año 1900", !!e3);
  const { data: tmp } = await adminA.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proB, starts_at: start, ends_at: end }).select("id").single();
  const { data: d1 } = await adminA.from("appointments").delete().eq("id", tmp.id).select("id");
  check("Un turno no atendido se puede borrar", (d1 ?? []).length === 1);
  await adminA.from("appointments").update({ status: "atendido" }).eq("id", appt.id);
  const { data: d2 } = await adminA.from("appointments").delete().eq("id", appt.id).select("id");
  check("Un turno atendido NO se puede borrar", (d2 ?? []).length === 0);
}

// --- Nada más se borra / historia clínica inalterable
{
  const { data: d1 } = await adminA.from("patients").delete().eq("id", patA.id).select("id");
  check("Un paciente no se puede borrar", (d1 ?? []).length === 0);
  const { data: d3 } = await adminA.from("invoices").delete().eq("id", inv.id).select("id");
  check("Una factura no se puede borrar", (d3 ?? []).length === 0);
  const { error: e1 } = await adminA.from("clinical_entries").update({ content: "cambiado" }).eq("id", entry.id);
  check("La historia clínica no se puede editar", !!e1);
  const { error: e3 } = await adminA.from("clinical_entries").update({ voided_at: new Date().toISOString(), void_reason: "Paciente equivocado" }).eq("id", entry.id);
  check("Se puede anular con motivo", !e3, e3?.message);
}

// --- Roles
{
  const secre = await signup(invite(orgA, "secretaria"), "secretariaA");
  const prof = await signup(invite(orgA, "profesional", proB), "profesionalB");
  const [{ id: secId }] = sql(`select id from public.profiles where email = lower('test-secretariaA-${run}@example.com')`);

  const { data: s0 } = await secre.from("patients").select("id");
  check("Secretaria sin médicos asignados no ve pacientes", (s0 ?? []).length === 0);
  const { error: eAsg } = await secre.from("secretary_assignments").insert({ organization_id: orgA, secretary_id: secId, professional_id: proA.id });
  check("La secretaria no puede asignarse médicos", !!eAsg);
  const { error: eAsg2 } = await adminA.from("secretary_assignments").insert({ organization_id: orgA, secretary_id: secId, professional_id: proA.id });
  check("La administración asigna médicos a la secretaria", !eAsg2, eAsg2?.message);

  const { data: s1 } = await secre.from("patients").select("id");
  check("La secretaria ve los pacientes de su médico asignado", (s1 ?? []).length === 1 && s1[0].id === patA.id);
  const { data: sa } = await secre.from("appointments").select("id, professional_id");
  check("La secretaria ve solo turnos de su médico", (sa ?? []).length > 0 && sa.every((a) => a.professional_id === proA.id));
  const { error: eOther } = await secre.from("appointments").insert({ organization_id: orgA, patient_id: patA.id, professional_id: proB, starts_at: start, ends_at: end, is_overbook: true });
  check("La secretaria NO puede dar turnos a un médico no asignado", !!eOther);
  const { data: hcS } = await secre.from("clinical_entries").select("id");
  check("La secretaria NUNCA ve historias clínicas", (hcS ?? []).length === 0);
  const { data: invS } = await secre.from("invoices").select("id");
  check("La secretaria ve las facturas de su médico y no las de otros", (invS ?? []).length === 1 && invS[0].id === inv.id);
  const { error: eInvS } = await secre.from("invoices").update({ notes: "ok" }).eq("id", inv.id);
  check("La secretaria gestiona facturas de su médico", !eInvS, eInvS?.message);
  const { error: eOs } = await secre.from("obras_sociales").insert({ organization_id: orgA, name: `OS ${run}` });
  check("La secretaria puede cargar coberturas", !eOs, eOs?.message);
  const { data: orgUpd } = await secre.from("organizations").update({ name: "Cambiado" }).eq("id", orgA).select("id");
  check("La secretaria NO cambia los datos de la clínica", (orgUpd ?? []).length === 0);

  const { data: pp } = await prof.from("patients").select("id");
  check("El profesional ve solo sus pacientes", (pp ?? []).length === 1 && pp[0].id === patB.id);
  const { data: invP } = await prof.from("invoices").select("id");
  check("El profesional ve solo sus facturas", (invP ?? []).length === 1 && invP[0].id === invB.id);
  const { data: invPu } = await prof.from("invoices").update({ notes: "x" }).eq("id", invB.id).select("id");
  check("El profesional NO modifica facturas", (invPu ?? []).length === 0);
  const { error: eAp } = await prof.from("appointments").insert({ organization_id: orgA, patient_id: patB.id, professional_id: proA.id, starts_at: start, ends_at: end, is_overbook: true });
  check("El profesional NO da turnos en la agenda de otro", !!eAp);
  const { error: eAp2 } = await prof.from("appointments").insert({ organization_id: orgA, patient_id: patB.id, professional_id: proB, starts_at: start, ends_at: end, is_overbook: true });
  check("El profesional sí da turnos en su agenda", !eAp2, eAp2?.message);
  const { error: eHc } = await prof.from("clinical_entries").insert({ organization_id: orgA, patient_id: patB.id, title: "Sesión", content: "ok" });
  check("El profesional escribe en la historia clínica de su paciente", !eHc, eHc?.message);
  const { error: eTar } = await prof.from("tariffs").insert({ organization_id: orgA, tariff: "colegio", value: 1, valid_from: "2026-01-01" });
  check("El profesional NO carga tarifas", !!eTar);

  const { data: me } = await secre.auth.getUser();
  const { error: eRole } = await secre.from("profiles").update({ role: "admin" }).eq("id", me.user.id);
  check("Nadie se puede cambiar el rol", !!eRole);
  const { data: profMe } = await prof.auth.getUser();
  await adminA.from("profiles").update({ role: "secretaria" }).eq("id", profMe.user.id);
  const [{ role: stillRole }] = sql(`select role from public.profiles where id = '${profMe.user.id}'`);
  check("Ni la administración cambia roles desde la app", stillRole === "profesional", stillRole);
  const { error: eName } = await secre.from("profiles").update({ full_name: "Renombrada" }).eq("id", me.user.id);
  check("Cada uno puede cambiar su nombre", !eName, eName?.message);
}

// --- Archivos
{
  const { error: e1 } = await adminA.storage.from("documents").upload(`${orgA}/test/${run}.txt`, new Blob(["hola"]), { contentType: "text/plain" });
  check("Admin sube un archivo a su carpeta", !e1, e1?.message);
  const { error: e2 } = await adminB.storage.from("documents").upload(`${orgA}/test/intruso-${run}.txt`, new Blob(["x"]), { contentType: "text/plain" });
  check("Otra clínica no sube archivos a la carpeta de A", !!e2);
  const { data: d3 } = await adminB.storage.from("documents").download(`${orgA}/test/${run}.txt`);
  check("Otra clínica no descarga archivos de A", !d3);
}

sql(`delete from public.organizations where name like 'Test _ ${run}'`);
sql(`delete from auth.users where email like 'test-%-${run}@example.com'`);
console.log(failed ? `\n${failed} pruebas FALLARON` : "\nTodas las pruebas pasaron");
process.exit(failed ? 1 : 0);
