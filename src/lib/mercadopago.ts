// Checkout Pro: el paciente paga en la página de Mercado Pago y vuelve a la app.
// El token es secreto: vive solo en el servidor (variable MP_ACCESS_TOKEN de Vercel).
const API = process.env.MP_API_URL ?? "https://api.mercadopago.com";

export const mercadoPagoEnabled = () => !!process.env.MP_ACCESS_TOKEN;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}`);
  return res.json();
}

export async function createPreference(p: { reference: string; title: string; amount: number; returnUrl: string }) {
  const https = p.returnUrl.startsWith("https://");
  const pref = await call<{ id: string; init_point: string }>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ id: p.reference, title: p.title, quantity: 1, unit_price: p.amount, currency_id: "ARS" }],
      external_reference: p.reference,
      back_urls: { success: p.returnUrl, pending: p.returnUrl, failure: p.returnUrl },
      // Mercado Pago solo vuelve solo a la app si la dirección es https
      ...(https && { auto_return: "approved" }),
    }),
  });
  return pref.init_point;
}

export type Payment = { id: number; status: string; transaction_amount: number; date_approved: string | null };

// Pagos hechos con los links de esta factura, del más nuevo al más viejo
export async function paymentsFor(reference: string) {
  const r = await call<{ results: Payment[] }>(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc`);
  return r.results;
}
