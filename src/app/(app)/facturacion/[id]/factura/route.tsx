import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { cleanCuit, qrUrl } from "@/lib/arca";
import { fmtDate, fullName, money } from "@/lib/format";
import { INVOICE_SELECT } from "@/lib/invoice-history";
import { getSession } from "@/lib/session";
import type { Invoice } from "@/lib/types";

const IVA: Record<string, string> = {
  monotributo: "Responsable Monotributo",
  responsable_inscripto: "IVA Responsable Inscripto",
  exento: "IVA Sujeto Exento",
  consumidor_final: "Consumidor Final",
};

// Factura emitida, con el CAE y el código QR que exige ARCA
export async function GET(_req: Request, ctx: RouteContext<"/facturacion/[id]/factura">) {
  const { id } = await ctx.params;
  const { supabase, org, canBill } = await getSession();
  if (!canBill) return new Response("No autorizado", { status: 403 });
  const { data } = await supabase.from("invoices").select(INVOICE_SELECT).eq("id", id).single();
  const inv = data as unknown as Invoice | null;
  if (!inv) return new Response("Factura no encontrada", { status: 404 });
  if (!inv.cae || !inv.arca_number || !inv.issue_date) return new Response("La factura todavía no tiene CAE", { status: 400 });

  const pro = inv.professional;
  const toOS = inv.kind === "obra_social";
  const issuerCuit = cleanCuit(pro?.cuit ?? org.cuit ?? "");
  const pv = inv.punto_venta ?? 1;
  const receptorDoc = toOS ? cleanCuit(inv.obra_social?.cuit ?? "") : (inv.patient?.dni ?? "").replace(/\D/g, "");
  const docTipo = toOS ? 80 : receptorDoc ? 96 : 99;
  const qr = await QRCode.toDataURL(
    qrUrl({ date: inv.issue_date, cuit: issuerCuit, pv, tipo: 11, number: inv.arca_number, total: Number(inv.total), docTipo, docNro: receptorDoc || "0", cae: inv.cae }),
    { margin: 0, width: 220 },
  );
  const number = `${String(pv).padStart(5, "0")}-${String(inv.arca_number).padStart(8, "0")}`;

  const buffer = await renderToBuffer(
    <Document title={`Factura C ${number}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.original}>ORIGINAL</Text>
        <View style={s.header}>
          <View style={s.half}>
            <Text style={s.issuer}>{(pro?.full_name ?? org.razon_social ?? org.name).toUpperCase()}</Text>
            {org.address && <Text style={s.small}>Domicilio: {org.address}</Text>}
            <Text style={s.small}>Condición frente al IVA: {IVA[pro?.condicion_iva ?? org.condicion_iva ?? "monotributo"]}</Text>
          </View>
          <View style={s.letter}>
            <Text style={s.letterText}>C</Text>
            <Text style={s.tiny}>COD. 011</Text>
          </View>
          <View style={s.half}>
            <Text style={s.title}>FACTURA</Text>
            <Text style={s.small}>Punto de venta y número: {number}</Text>
            <Text style={s.small}>Fecha de emisión: {fmtDate(inv.issue_date)}</Text>
            <Text style={s.small}>CUIT: {issuerCuit}</Text>
            {org.ingresos_brutos && <Text style={s.small}>Ingresos brutos: {org.ingresos_brutos}</Text>}
            {org.inicio_actividades && <Text style={s.small}>Inicio de actividades: {fmtDate(org.inicio_actividades)}</Text>}
          </View>
        </View>
        <View style={s.box}>
          <Text style={s.small}>
            Período facturado: {inv.period_from ? `${fmtDate(inv.period_from)} al ${fmtDate(inv.period_to!)}` : "—"}    Vencimiento del pago: {fmtDate(inv.issue_date)}
          </Text>
        </View>
        <View style={s.box}>
          <Text style={s.small}>{toOS ? "CUIT" : "DNI"}: {receptorDoc || "—"}</Text>
          <Text style={s.small}>Apellido y nombre o razón social: {toOS ? inv.obra_social?.razon_social || inv.obra_social?.name : fullName(inv.patient)}</Text>
          <Text style={s.small}>Condición frente al IVA: {toOS ? IVA[inv.obra_social?.condicion_iva ?? ""] ?? "—" : "Consumidor Final"}</Text>
          {toOS && inv.obra_social?.address && <Text style={s.small}>Domicilio: {inv.obra_social.address}</Text>}
        </View>
        <View style={s.th}>
          <Text style={[s.c1, s.bold]}>Producto / servicio</Text>
          <Text style={[s.c2, s.bold]}>Cantidad</Text>
          <Text style={[s.c2, s.bold]}>Precio unitario</Text>
          <Text style={[s.c2, s.bold]}>Subtotal</Text>
        </View>
        {(inv.items ?? []).map((it, i) => (
          <View key={i} style={s.tr}>
            <Text style={s.c1}>{it.description}</Text>
            <Text style={s.c2}>{Number(it.quantity)}</Text>
            <Text style={s.c2}>{money(Number(it.unit_price))}</Text>
            <Text style={s.c2}>{money(Number(it.quantity) * Number(it.unit_price))}</Text>
          </View>
        ))}
        <View style={s.total}>
          <Text style={s.small}>Importe total</Text>
          <Text style={s.totalText}>{money(Number(inv.total))}</Text>
        </View>
        <View style={s.footer}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no tiene alt */}
          <Image src={qr} style={s.qr} />
          <View>
            <Text style={s.bold}>Comprobante autorizado</Text>
            <Text style={s.small}>CAE N°: {inv.cae}</Text>
            {inv.cae_vencimiento && <Text style={s.small}>Fecha de vencimiento del CAE: {fmtDate(inv.cae_vencimiento)}</Text>}
          </View>
        </View>
      </Page>
    </Document>,
  );

  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="factura-C-${number}.pdf"` },
  });
}

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  original: { borderWidth: 1, borderBottomWidth: 0, textAlign: "center", paddingVertical: 3, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  header: { flexDirection: "row", borderWidth: 1 },
  half: { flex: 1, padding: 8, gap: 2 },
  letter: { width: 56, alignItems: "center", borderLeftWidth: 1, borderRightWidth: 1, paddingTop: 4 },
  letterText: { fontSize: 28, fontFamily: "Helvetica-Bold" },
  tiny: { fontSize: 6 },
  issuer: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  small: { fontSize: 8.5, lineHeight: 1.4 },
  box: { borderWidth: 1, borderTopWidth: 0, padding: 8, gap: 2 },
  th: { flexDirection: "row", backgroundColor: "#e2e8f0", marginTop: 10, padding: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#cbd5e1", padding: 5 },
  c1: { flex: 4 },
  c2: { flex: 1.2, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  total: { alignSelf: "flex-end", width: 200, borderWidth: 1, padding: 8, marginTop: 12, alignItems: "flex-end" },
  totalText: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  footer: { flexDirection: "row", gap: 14, alignItems: "center", marginTop: 24, borderTopWidth: 0.5, borderColor: "#cbd5e1", paddingTop: 12 },
  qr: { width: 90, height: 90 },
});
