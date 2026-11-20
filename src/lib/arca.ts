// Conexión con ARCA para emitir facturas electrónicas: WSAA (permiso de 12 horas) y wsfev1 (CAE).
// Solo corre en el servidor. Cada profesional usa su propio certificado, que conecta en Configuración, ARCA.
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import https from "node:https";
import forge from "node-forge";

export type ArcaEnv = "produccion" | "homologacion";

const HOSTS: Record<ArcaEnv, { wsaa: string; wsfe: string }> = {
  produccion: { wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms", wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx" },
  homologacion: { wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms", wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx" },
};

// Los servidores de ARCA usan un intercambio de claves viejo que Node rechaza por defecto
const agent = new https.Agent({ ciphers: "DEFAULT@SECLEVEL=1", keepAlive: true });

// ---------------------------------------------------------------- Clave privada encriptada
function secret() {
  const k = Buffer.from(process.env.ARCA_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("Falta configurar ARCA_ENCRYPTION_KEY en el servidor.");
  return k;
}

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string) {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", secret(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- Pedido y certificado
export const cleanCuit = (s: string) => s.replace(/\D/g, "");

export function newKeyAndCsr(cuit: string, holder: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const key = forge.pki.privateKeyFromPem(privateKey);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  csr.setSubject([
    { shortName: "C", value: "AR" },
    { shortName: "O", value: holder.normalize("NFD").replace(/[^\x20-\x7e]/g, "").slice(0, 60) || "MedApp" },
    { shortName: "CN", value: "medapp" },
    { name: "serialNumber", value: `CUIT ${cuit}` },
  ]);
  csr.sign(key, forge.md.sha256.create());
  return { keyPem: privateKey, csrPem: forge.pki.certificationRequestToPem(csr) };
}

// Revisa que el certificado sea el que ARCA emitió para esta clave y este CUIT
export function readCertificate(certPem: string, keyPem: string, cuit: string) {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new Error("El archivo no es un certificado. Subí el que descargaste de ARCA.");
  }
  const key = forge.pki.privateKeyFromPem(keyPem);
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (pub.n.compareTo(key.n) !== 0) throw new Error("Este certificado no corresponde al último pedido descargado. Generá el certificado en ARCA con ese pedido.");
  const serial = cert.subject.getField({ name: "serialNumber" })?.value as string | undefined;
  if (serial && cleanCuit(serial) !== cuit) throw new Error(`El certificado es del CUIT ${cleanCuit(serial)}, no del ${cuit}.`);
  return { expiresAt: cert.validity.notAfter };
}

// ---------------------------------------------------------------- SOAP
function soap(url: string, action: string, body: string) {
  const u = new URL(url);
  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      { host: u.host, path: u.pathname, method: "POST", agent, timeout: 30000, headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      },
    );
    req.on("timeout", () => req.destroy(new Error("ARCA no respondió a tiempo. Probá de nuevo en unos minutos.")));
    req.on("error", reject);
    req.end(body);
  });
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? unescapeXml(m[1].trim()) : null;
};
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- WSAA: permiso de acceso
export type Ticket = { token: string; sign: string; expiresAt: string };

export async function login(env: ArcaEnv, certPem: string, keyPem: string): Promise<Ticket> {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${iso(now - 60_000)}</generationTime>` +
    `<expirationTime>${iso(now + 10 * 60_000)}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  const xml = await soap(
    HOSTS[env].wsaa,
    "",
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`,
  );
  const ret = tag(xml, "loginCmsReturn");
  if (!ret) throw new Error(wsaaError(tag(xml, "faultstring") ?? "Respuesta inesperada de ARCA"));
  const token = tag(ret, "token"), sign = tag(ret, "sign"), expiresAt = tag(ret, "expirationTime");
  if (!token || !sign || !expiresAt) throw new Error("ARCA no devolvió el permiso de acceso.");
  return { token, sign, expiresAt };
}

function wsaaError(msg: string) {
  if (/alreadyAuthenticated|ya posee un TA/i.test(msg)) return "ARCA ya entregó un permiso que todavía no venció. Probá de nuevo en unos minutos.";
  if (/cms\.cert|certificado|untrusted|expired/i.test(msg)) return `ARCA no aceptó el certificado: ${msg}`;
  if (/notAuthorized|no autorizado|computador/i.test(msg)) return "El certificado no está autorizado para Facturación Electrónica. Revisá la relación en el Administrador de Relaciones de ARCA.";
  return msg;
}

// ---------------------------------------------------------------- wsfev1
const FE = "http://ar.gov.afip.dif.FEV1/";

async function fe(env: ArcaEnv, method: string, inner: string) {
  const xml = await soap(
    HOSTS[env].wsfe,
    FE + method,
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${FE}"><soap:Body><ar:${method}>${inner}</ar:${method}></soap:Body></soap:Envelope>`,
  );
  const fault = tag(xml, "faultstring");
  if (fault) throw new Error(fault);
  return xml;
}

const auth = (t: Ticket, cuit: string) => `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;

const errorsOf = (xml: string) =>
  [...tags(xml, "Err"), ...tags(xml, "Obs")].map((e) => `${tag(e, "Code")}: ${tag(e, "Msg")}`);

export async function lastNumber(env: ArcaEnv, t: Ticket, cuit: string, pv: number, tipo: number) {
  const xml = await fe(env, "FECompUltimoAutorizado", `${auth(t, cuit)}<ar:PtoVta>${pv}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`);
  const errs = tags(xml, "Err");
  const nro = tag(xml, "CbteNro");
  if (errs.length || nro === null) throw new Error(friendlyFe(errorsOf(xml).join(" · ") || "ARCA no devolvió el último número."));
  return Number(nro);
}

export type InvoiceRequest = {
  pv: number;
  tipo: number; // 11 = factura C
  number: number;
  date: string; // yyyy-MM-dd
  docTipo: number; // 80 CUIT · 96 DNI · 99 sin identificar
  docNro: string;
  condIvaReceptor: number; // 1 RI · 4 exento · 5 consumidor final · 6 monotributo
  total: number;
  serviceFrom: string;
  serviceTo: string;
  payBy: string;
};

const ymd = (d: string) => d.replace(/-/g, "");

export async function requestCae(env: ArcaEnv, t: Ticket, cuit: string, r: InvoiceRequest) {
  const total = r.total.toFixed(2);
  const det =
    `<ar:FECAEDetRequest><ar:Concepto>2</ar:Concepto><ar:DocTipo>${r.docTipo}</ar:DocTipo><ar:DocNro>${esc(r.docNro)}</ar:DocNro>` +
    `<ar:CbteDesde>${r.number}</ar:CbteDesde><ar:CbteHasta>${r.number}</ar:CbteHasta><ar:CbteFch>${ymd(r.date)}</ar:CbteFch>` +
    `<ar:ImpTotal>${total}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total}</ar:ImpNeto><ar:ImpOpEx>0</ar:ImpOpEx>` +
    `<ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA><ar:FchServDesde>${ymd(r.serviceFrom)}</ar:FchServDesde>` +
    `<ar:FchServHasta>${ymd(r.serviceTo)}</ar:FchServHasta><ar:FchVtoPago>${ymd(r.payBy)}</ar:FchVtoPago>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${r.condIvaReceptor}</ar:CondicionIVAReceptorId></ar:FECAEDetRequest>`;
  const xml = await fe(
    env,
    "FECAESolicitar",
    `${auth(t, cuit)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${r.pv}</ar:PtoVta><ar:CbteTipo>${r.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${det}</ar:FeDetReq></ar:FeCAEReq>`,
  );
  const det2 = tag(xml, "FECAEDetResponse") ?? "";
  const cae = tag(det2, "CAE");
  if (tag(det2, "Resultado") !== "A" || !cae) throw new Error(friendlyFe(errorsOf(xml).join(" · ") || "ARCA rechazó la factura."));
  const vto = tag(det2, "CAEFchVto")!;
  return { cae, caeExpires: `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}`, observations: tags(det2, "Obs").map((o) => tag(o, "Msg")) };
}

function friendlyFe(msg: string) {
  if (/600|ValidacionDeToken|token/i.test(msg) && /inv|venc|expir/i.test(msg)) return "El permiso de ARCA venció. Probá de nuevo.";
  if (/11002|punto de venta/i.test(msg)) return `ARCA no reconoce el punto de venta. Tiene que ser del tipo Web Services. (${msg})`;
  return `ARCA respondió: ${msg}`;
}

// Link del código QR que exige ARCA en la factura impresa
export function qrUrl(d: { date: string; cuit: string; pv: number; tipo: number; number: number; total: number; docTipo: number; docNro: string; cae: string }) {
  const data = {
    ver: 1, fecha: d.date, cuit: Number(d.cuit), ptoVta: d.pv, tipoCmp: d.tipo, nroCmp: d.number, importe: Number(d.total.toFixed(2)),
    moneda: "PES", ctz: 1, tipoDocRec: d.docTipo, nroDocRec: Number(d.docNro) || 0, tipoCodAut: "E", codAut: Number(d.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString("base64")}`;
}

export const TIPO_COMPROBANTE = { C: 11 } as const;
export const COND_IVA_RECEPTOR: Record<string, number> = { responsable_inscripto: 1, exento: 4, consumidor_final: 5, monotributo: 6 };
