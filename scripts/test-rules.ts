// Test de las reglas de facturación. Uso: node scripts/test-rules.ts
import { applyRules, pickTariff, priceSessions, type RuleInput, type TariffRow } from "../src/lib/billing-rules.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "✔" : "✘"} ${name}${ok ? "" : ` — obtuvo ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const OS = { id: "os", type: "obra_social" as const, default_via: "colegio" as const };
const base: RuleInput = { hasOrder: true, reason: "comun", financiador: OS, via: null, cudVigente: false, copagoAmount: null, affiliateNumber: "123", siniestro: null };
const rule = (over: Partial<RuleInput>) => applyRules({ ...base, ...over });

check("1. Sin orden médica → particular (aunque tenga CUD y obra social)", rule({ hasOrder: false, cudVigente: true }).rule === 1 && rule({ hasOrder: false }).billTo === "paciente");
check("2. Accidente de trabajo → ART", rule({ reason: "accidente_trabajo", financiador: { id: "art", type: "art", default_via: "convenio" }, siniestro: "S-1" }).tariff === "art");
check("2. ART sin N° de siniestro → avisa", rule({ reason: "accidente_trabajo", financiador: { id: "art", type: "art", default_via: "convenio" } }).missing.includes("N° de siniestro"));
check("3. Accidente de tránsito con seguro → seguro", rule({ reason: "accidente_transito", financiador: { id: "s", type: "seguro", default_via: "convenio" } }).tariff === "seguro");
check("3. Accidente de tránsito sin seguro → particular", rule({ reason: "accidente_transito" }).billTo === "paciente");
check("4. CUD + IOMA → discapacidad IOMA", rule({ cudVigente: true, financiador: { id: "i", type: "ioma", default_via: "convenio" } }).tariff === "discapacidad_ioma");
check("5. CUD + obra social → discapacidad nacional", rule({ cudVigente: true }).tariff === "discapacidad_nacional");
check("5. CUD + PAMI → discapacidad nacional", rule({ cudVigente: true, financiador: { id: "p", type: "pami", default_via: "convenio" } }).tariff === "discapacidad_nacional");
check("5. CUD + obra social aunque sea por reintegro → nomenclador", rule({ cudVigente: true, via: "reintegro" }).rule === 5);
check("6. CUD sin cobertura → Incluir Salud y avisa que falta", (() => { const r = rule({ cudVigente: true, financiador: null }); return r.rule === 6 && r.missing.length > 0; })());
check("6. CUD + programa provincial → nomenclador provincial", rule({ cudVigente: true, financiador: { id: "pp", type: "programa_provincial", default_via: "convenio" } }).tariff === "discapacidad_provincial");
check("7. Obra social por el Colegio → Colegio", rule({}).tariff === "colegio");
check("8. Obra social con convenio directo → convenio", (() => { const r = rule({ via: "convenio" }); return r.tariff === "convenio" && r.tariffFinanciadorId === "os"; })());
check("9. PAMI sin CUD → PAMI", rule({ financiador: { id: "p", type: "pami", default_via: "convenio" } }).tariff === "pami");
check("10. IOMA sin CUD → IOMA", rule({ financiador: { id: "i", type: "ioma", default_via: "convenio" } }).tariff === "ioma");
check("11. Obra social sin convenio → reintegro a nombre del paciente", (() => { const r = rule({ via: "reintegro" }); return r.rule === 11 && r.kind === "reintegro"; })());
check("12. Sin cobertura ni CUD → particular", rule({ financiador: null }).rule === 12);
check("Copago se aplica a obra social", rule({ copagoAmount: 2000 }).copago === true);
check("Copago no se aplica a particular", rule({ financiador: null, copagoAmount: 2000 }).copago === false);
check("Falta N° de afiliado → avisa", rule({ affiliateNumber: null }).missing.includes("N° de afiliado"));

const T: TariffRow[] = [
  { tariff: "colegio", financiador_id: null, practice_code: null, value: 20000, valid_from: "2026-09-01" },
  { tariff: "colegio", financiador_id: null, practice_code: null, value: 20900, valid_from: "2026-10-01" },
  { tariff: "colegio", financiador_id: null, practice_code: "550203", value: 25000, valid_from: "2026-09-01" },
  { tariff: "convenio", financiador_id: "os", practice_code: null, value: 18000, valid_from: "2026-01-01" },
  { tariff: "convenio", financiador_id: "otra", practice_code: null, value: 99999, valid_from: "2026-01-01" },
];
check("Tarifa vigente según la fecha de la sesión", pickTariff(T, { tariff: "colegio", financiadorId: null, practiceCode: null, date: "2026-09-30" })?.value === 20000);
check("Toma el aumento desde su vigencia", pickTariff(T, { tariff: "colegio", financiadorId: null, practiceCode: null, date: "2026-10-01" })?.value === 20900);
check("Prefiere la tarifa del código de práctica", pickTariff(T, { tariff: "colegio", financiadorId: null, practiceCode: "550203", date: "2026-10-05" })?.value === 25000);
check("Convenio: usa el valor de ESA obra social", pickTariff(T, { tariff: "convenio", financiadorId: "os", practiceCode: null, date: "2026-10-05" })?.value === 18000);
check("Sin tarifa cargada → null", pickTariff(T, { tariff: "pami", financiadorId: null, practiceCode: null, date: "2026-10-05" }) === null);

const priced = priceSessions(["2026-09-29", "2026-09-30", "2026-10-01"], (d) => pickTariff(T, { tariff: "colegio", financiadorId: null, practiceCode: null, date: d })!.value);
check("Si la tarifa cambia en el medio, salen dos renglones", priced.lines.length === 2 && priced.total === 20000 * 2 + 20900, priced);

check("13. Superintendencia → su tabla", rule({ via: "superintendencia" }).tariff === "superintendencia");
check("14. Convenio con ART → valor de esa ART", rule({ via: "convenio_art" }).tariff === "art" && rule({ via: "convenio_art" }).tariffFinanciadorId === "os");
check("15. Módulo CUD sin CUD vigente → avisa", rule({ via: "modulo_cud" }).missing.includes("CUD vigente"));
check("Con CUD vigente manda la regla de CUD", rule({ via: "modulo_cud", cudVigente: true }).rule === 5);

check("Cobertura de tipo Otra → sigue su forma de cobro", rule({ financiador: { id: "o", type: "otra", default_via: "colegio" } }).tariff === "colegio");
check("Cobertura de tipo Otra con CUD → discapacidad nacional", rule({ cudVigente: true, financiador: { id: "o", type: "otra", default_via: "colegio" } }).tariff === "discapacidad_nacional");
check("Categoría Otra → reglas comunes", rule({ reason: "otra" }).tariff === "colegio");

const propias: TariffRow[] = [
  { tariff: "propia", custom_name: "Domicilio", financiador_id: null, practice_code: null, value: 30000, valid_from: "2026-01-01" },
  { tariff: "propia", custom_name: "Pileta", financiador_id: null, practice_code: null, value: 40000, valid_from: "2026-01-01" },
  { tariff: "colegio", financiador_id: null, practice_code: null, value: 20000, valid_from: "2026-01-01" },
];
const propia = (customName: string | null) => pickTariff(propias, { tariff: "colegio", financiadorId: null, practiceCode: null, date: "2026-06-01", customName })?.value;
check("Tarifa propia: usa la elegida", propia("Domicilio") === 30000 && propia("Pileta") === 40000, propia("Domicilio"));
check("Sin tarifa propia: usa la de las reglas", propia(null) === 20000, propia(null));
check("Tarifa propia sin valor: no cae en otra", propia("Otra") === undefined, propia("Otra"));

console.log(failed ? `\n${failed} pruebas FALLARON` : "\nTodas las pruebas de reglas pasaron");
process.exit(failed ? 1 : 0);
