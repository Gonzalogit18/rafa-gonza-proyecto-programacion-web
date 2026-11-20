// Adonde vuelve el paciente después de pagar en Mercado Pago. Es pública: el paciente no tiene cuenta.
// No marca nada como cobrado: eso lo confirma la clínica consultando a Mercado Pago.
const TEXT: Record<string, [string, string]> = {
  approved: ["Pago recibido", "Gracias. La clínica ya puede ver tu pago."],
  pending: ["Pago en proceso", "Mercado Pago está procesando el pago."],
};

export default async function PagoPage({ searchParams }: PageProps<"/pago">) {
  const { status } = (await searchParams) as { status?: string };
  const [title, text] = TEXT[status ?? ""] ?? ["El pago no se completó", "Podés volver a intentarlo con el mismo link."];
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}
