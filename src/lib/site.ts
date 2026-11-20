// La app de prueba usa la base "Salud"; la de la clínica, la suya. Sirve para mostrar opciones solo en prueba.
export const isTestSite = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("ljawbbqbvrpufevoguik");
