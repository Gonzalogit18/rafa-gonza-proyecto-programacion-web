import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fetchBillingRows } from "@/lib/billing";
import { fmtDate, fullName, monthLabel } from "@/lib/format";
import { getSession } from "@/lib/session";

// Planilla de asistencia con las fechas ya completas (para que el paciente firme cada sesión)
export async function GET(_req: Request, ctx: RouteContext<"/facturacion/[id]/planilla">) {
  const { id } = await ctx.params;
  const { supabase, org, canBill } = await getSession();
  if (!canBill) return new Response("No autorizado", { status: 403 });

  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, period, arca_number, punto_venta, treatment_id, patient_id, " +
        "obra_social:obras_sociales(name), treatment:treatments(practice_name, practice_code, auth_number), " +
        "professional:professionals(full_name, matricula, cuit)",
    )
    .eq("id", id)
    .single();
  if (!inv) return new Response("Factura no encontrada", { status: 404 });
  const invoice = inv as unknown as {
    period: string | null;
    arca_number: number | null;
    treatment_id: string | null;
    patient_id: string;
    obra_social: { name: string } | null;
    treatment: { practice_name: string; practice_code: string | null; auth_number: string | null } | null;
    professional: { full_name: string; matricula: string | null; cuit: string | null } | null;
  };
  if (!invoice.period || !invoice.treatment_id) return new Response("La factura no tiene período o tratamiento", { status: 400 });

  const { rows } = await fetchBillingRows(supabase, { period: invoice.period, patientId: invoice.patient_id });
  const row = rows.find((r) => r.treatment.id === invoice.treatment_id);
  const dates = row?.dates ?? [];
  const patient = row?.patient;

  const prestador = invoice.professional?.full_name ?? org.razon_social ?? org.name;
  const cuit = invoice.professional?.cuit ?? org.cuit ?? "";
  // Mínimo 12 renglones para que se vea como la planilla en papel
  const lines = [...dates, ...Array(Math.max(0, 12 - dates.length)).fill("")];

  const buffer = await renderToBuffer(
    <Document title={`Planilla ${patient ? fullName(patient) : ""} ${invoice.period}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>PLANILLA DE ASISTENCIA</Text>
        <Text style={s.subtitle}>{invoice.obra_social?.name ?? ""}</Text>
        <View style={s.grid}>
          <Item label="Prestador" value={prestador} />
          <Item label="N° CUIT" value={cuit} />
          <Item label="N° de factura asociada" value={invoice.arca_number ? String(invoice.arca_number) : ""} />
          <Item label="Período" value={monthLabel(invoice.period).toUpperCase()} />
          <Item label="Beneficiario" value={patient ? fullName(patient).toUpperCase() : ""} />
          <Item label="N° de afiliado" value={patient?.os_affiliate_number ?? ""} />
          <Item label="DNI / CUIL" value={patient?.cuil ?? patient?.dni ?? ""} />
          <Item label="Práctica" value={`${invoice.treatment?.practice_name ?? ""} ${invoice.treatment?.practice_code ? `(${invoice.treatment.practice_code})` : ""}`} />
        </View>
        <View style={s.th}>
          <Text style={[s.c1, s.bold]}>Fecha de la prestación</Text>
          <Text style={[s.c2, s.bold]}>Firma paciente o encargado</Text>
          <Text style={[s.c3, s.bold]}>Firma y sello del prestador</Text>
        </View>
        {lines.map((d, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.c1}>{d ? fmtDate(d) : ""}</Text>
            <Text style={s.c2} />
            <Text style={s.c3} />
          </View>
        ))}
        <Text style={s.footer}>
          {dates.length} sesiones · {invoice.professional?.matricula ? `Matrícula ${invoice.professional.matricula}` : ""}
        </Text>
      </Page>
    </Document>,
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="planilla-${invoice.period}.pdf"` },
  });
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.item}>
      <Text style={s.value}>{value || " "}</Text>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "center" },
  subtitle: { fontSize: 11, textAlign: "center", color: "#475569", marginBottom: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14 },
  item: { width: "50%", paddingRight: 12, marginBottom: 10 },
  value: { borderBottomWidth: 1, borderColor: "#0f172a", paddingBottom: 2, fontSize: 11 },
  label: { fontSize: 8, color: "#64748b", marginTop: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", backgroundColor: "#e2e8f0", borderWidth: 1, borderColor: "#0f172a" },
  tr: { flexDirection: "row", borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#0f172a", height: 36 },
  c1: { width: "26%", padding: 6, borderRightWidth: 1, borderColor: "#0f172a" },
  c2: { width: "37%", padding: 6, borderRightWidth: 1, borderColor: "#0f172a" },
  c3: { width: "37%", padding: 6 },
  footer: { marginTop: 10, fontSize: 9, color: "#64748b" },
});
