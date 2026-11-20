"use client";

import { useRef, useState, useTransition } from "react";
import { CircleHelp, Download, PlugZap, Upload } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { Modal } from "@/components/modal";
import { Badge, Button, Card, Field, Input, Select, cn } from "@/components/ui";
import type { ArcaStatus } from "@/lib/arca-session";
import { fmtDate } from "@/lib/format";
import { isTestSite } from "@/lib/site";
import { arcaNewRequest, arcaSaveSettings, arcaTest, arcaUploadCertificate } from "./arca-actions";


const DAY = 86_400_000;

function state(s: ArcaStatus | null) {
  if (!s) return { label: "Sin conectar", cls: "bg-slate-100 text-slate-600" };
  if (!s.hasCertificate) return { label: "Falta el certificado", cls: "bg-amber-100 text-amber-800" };
  const left = s.cert_expires_at ? new Date(s.cert_expires_at).getTime() - Date.now() : Infinity;
  if (left < 0) return { label: "Certificado vencido", cls: "bg-rose-100 text-rose-700" };
  if (!s.punto_venta) return { label: "Falta el punto de venta", cls: "bg-amber-100 text-amber-800" };
  if (s.check_error) return { label: "Con error", cls: "bg-rose-100 text-rose-700" };
  if (!s.checked_at) return { label: "Sin probar", cls: "bg-amber-100 text-amber-800" };
  if (left < 30 * DAY) return { label: "Vence pronto", cls: "bg-amber-100 text-amber-800" };
  return { label: "Conectado", cls: "bg-emerald-100 text-emerald-800" };
}

export function ArcaCard({ pro, status }: { pro: { id: string; full_name: string; cuit: string | null }; status: ArcaStatus | null }) {
  const [cuit, setCuit] = useState(status?.cuit ?? pro.cuit?.replace(/\D/g, "") ?? "");
  const [pv, setPv] = useState(status?.punto_venta ? String(status.punto_venta) : "");
  const [env, setEnv] = useState(status?.environment ?? "produccion");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [guide, setGuide] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const { ask } = useDialog();
  const st = state(status);
  const testSite = isTestSite();
  const dirty = !!status && (pv !== (status.punto_venta ? String(status.punto_venta) : "") || env !== status.environment);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.error) setMsg({ text: r.error, bad: true });
      else if (r.message) setMsg({ text: r.message });
    });

  const download = async () => {
    if (status?.hasCertificate && !(await ask("Si generás un pedido nuevo, el certificado actual deja de servir y hay que crear otro en ARCA. ¿Seguir?", "Generar pedido nuevo"))) return;
    start(async () => {
      setMsg(null);
      const r = await arcaNewRequest(pro.id, cuit);
      if (r.error || !r.csr) return setMsg({ text: r.error ?? "No se pudo generar el pedido.", bad: true });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.csr], { type: "application/pkcs10" }));
      a.download = `pedido-medapp-${cuit.replace(/\D/g, "")}.csr`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ text: "Pedido descargado. Subilo en ARCA para crear el certificado." });
    });
  };

  const upload = async (f: File) => {
    const text = await f.text();
    run(() => arcaUploadCertificate(pro.id, text));
    if (file.current) file.current.value = "";
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-semibold">{pro.full_name}</p>
          <Badge className={st.cls}>{st.label}</Badge>
        </div>
        <button onClick={() => setGuide(true)} className="flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline">
          <CircleHelp size={16} /> Cómo hacerlo
        </button>
      </div>

      {status?.hasCertificate && status.cert_expires_at && (
        <p className="text-sm text-slate-500">Certificado vigente hasta el {fmtDate(status.cert_expires_at)}{testSite && status.environment === "homologacion" && " · ambiente de pruebas de ARCA"}</p>
      )}

      <div className={cn("grid gap-3", testSite ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Field label="CUIT"><Input value={cuit} onChange={(e) => setCuit(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Punto de venta"><Input value={pv} onChange={(e) => setPv(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={!status} /></Field>
        {/* En la app de la clínica siempre se factura de verdad: el ambiente de pruebas de ARCA solo existe en la app de prueba */}
        {testSite && (
          <Field label="Ambiente">
            <Select value={env} onChange={(e) => setEnv(e.target.value as "produccion")} disabled={!status}>
              <option value="produccion">Real</option>
              <option value="homologacion">Pruebas de ARCA</option>
            </Select>
          </Field>
        )}
      </div>
      {dirty && (
        <div className="flex justify-end">
          <Button variant="secondary" disabled={pending} onClick={() => run(() => arcaSaveSettings(pro.id, { punto_venta: pv ? Number(pv) : null, environment: env }))}>Guardar</Button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="secondary" disabled={pending || cuit.replace(/\D/g, "").length !== 11} onClick={download}>
          <Download size={16} /> Descargar pedido
        </Button>
        <Button variant="secondary" disabled={pending || !status} onClick={() => file.current?.click()}>
          <Upload size={16} /> Subir certificado
        </Button>
        <Button disabled={pending || !status?.hasCertificate || !status.punto_venta || dirty} onClick={() => run(() => arcaTest(pro.id))}>
          <PlugZap size={16} /> {pending ? "Conectando…" : "Probar conexión"}
        </Button>
        <input ref={file} type="file" accept=".crt,.pem,.cer,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>

      {msg && <p className={cn("rounded-lg p-3 text-sm", msg.bad ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800")}>{msg.text}</p>}
      {!msg && status?.check_error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{status.check_error}</p>}

      {guide && <ArcaGuide onClose={() => setGuide(false)} />}
    </Card>
  );
}

// Guía para conectar la cuenta de ARCA, de principio a fin
function ArcaGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Conectar con ARCA" size="lg">
      <div className="space-y-7 text-[15px] leading-relaxed text-slate-700">
        <div className="space-y-3">
          <p>
            Se hace <b>una sola vez</b>, desde una computadora, y lleva unos 20 minutos. Cuando termines, tus facturas se emiten en ARCA desde MedApp con un
            botón, sin entrar a ARCA.
          </p>
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <p className="mb-1 font-semibold text-slate-900">Antes de empezar</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Tu clave fiscal de ARCA con nivel 3. Es la misma con la que facturás hoy.</li>
              <li>Tener ARCA y MedApp abiertos en dos pestañas del navegador.</li>
              <li>Si el navegador avisa que bloqueó una ventana de ARCA, tocá permitir.</li>
            </ul>
          </div>
        </div>

        <Phase title="En MedApp">
          <Step n={1} title="Descargá el pedido de certificado">
            <li>Revisá que el CUIT de esta tarjeta sea el tuyo.</li>
            <li>Tocá <b>Descargar pedido</b>. Se baja un archivo que termina en <b>.csr</b> a tu carpeta Descargas.</li>
            <li>No lo abras ni lo cambies: lo vas a subir a ARCA tal como está.</li>
          </Step>
        </Phase>

        <Phase title="En ARCA, entrando con tu clave fiscal">
          <Step n={2} title="Activá el servicio de certificados" tip="Si ya tenés Administración de Certificados Digitales en tus servicios, salteá este paso.">
            <li>En la página principal de ARCA tocá <b>Administrador de relaciones</b>.</li>
            <li>Tocá el botón <b>Adherir servicio</b>.</li>
            <li>En la lista de organismos tocá el botón <b>ARCA</b> y después <b>Servicios Interactivos</b>.</li>
            <li>Elegí <b>Administración de Certificados Digitales</b> y tocá <b>Confirmar</b>.</li>
            <li>Cerrá sesión en ARCA y volvé a entrar, para que el servicio aparezca.</li>
          </Step>
          <Step n={3} title="Creá el certificado">
            <li>En la página principal, en <b>Servicios</b>, tocá <b>Ver todos</b> y abrí <b>Administración de Certificados Digitales</b>.</li>
            <li>Tocá <b>Agregar alias</b>.</li>
            <li>En el alias escribí <b>medapp</b>, elegí el archivo .csr que descargaste en el paso 1 y confirmá.</li>
            <li>Entrá al alias <b>medapp</b> y descargá el certificado. Se baja un archivo que termina en <b>.crt</b>: guardalo, lo vas a subir a MedApp al final.</li>
          </Step>
          <Step n={4} title="Autorizá el certificado para facturar">
            <li>Volvé a <b>Administrador de relaciones</b> y tocá <b>Nueva relación</b>.</li>
            <li>Al lado de Servicio tocá <b>Buscar</b>. Tocá el botón <b>ARCA</b>, después <b>WebServices</b>, y elegí <b>Facturación Electrónica</b>.</li>
            <li>Al lado de Representante tocá <b>Buscar</b> y elegí el certificado <b>medapp</b>.</li>
            <li>Tocá <b>Confirmar</b>. No hace falta imprimir el formulario que ofrece ARCA.</li>
          </Step>
          <Step n={5} title="Creá un punto de venta para MedApp" tip="Si no tenés Administración de puntos de venta y domicilios en tus servicios, agregalo como en el paso 2: también está en Servicios Interactivos.">
            <li className="list-none -ml-5 mb-1">
              El punto de venta es el número que va adelante de cada factura, por ejemplo <b>0003</b>-00000125. Las facturas que emite MedApp necesitan uno propio,
              distinto del que usás para facturar desde la página de ARCA, y arrancan desde el número 1.
            </li>
            <li>En <b>Servicios</b> abrí <b>Administración de puntos de venta y domicilios</b> y elegí tu nombre.</li>
            <li>Tocá <b>A/B/M de Puntos de venta</b> y después <b>Agregar</b>.</li>
            <li>Número: uno que no estés usando. <b>Anotalo</b>, lo vas a necesitar en el paso 6.</li>
            <li>Sistema: <b>Factura Electrónica - Monotributo - Web Services</b>. Domicilio: el de tu consultorio.</li>
            <li>Tocá <b>Aceptar</b>.</li>
          </Step>
        </Phase>

        <Phase title="De vuelta en MedApp">
          <Step n={6} title="Terminá la conexión">
            <li>Tocá <b>Subir certificado</b> y elegí el archivo .crt del paso 3.</li>
            <li>En <b>Punto de venta</b> escribí el número del paso 5. En <b>Ambiente</b> dejá <b>Real</b>.</li>
            <li>Tocá <b>Guardar</b> y después <b>Probar conexión</b>.</li>
            <li>Si aparece <b>Conectado con ARCA</b>, listo. Desde ahora, en Facturación, tus facturas preparadas tienen el botón <b>Emitir en ARCA</b>.</li>
          </Step>
        </Phase>

        <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>El certificado dura dos años. Un mes antes de que venza vas a ver <b>Vence pronto</b> en esta tarjeta: se renueva repitiendo los pasos 1, 3 y 6.</p>
          <p>Si Probar conexión muestra un error, el mensaje dice qué falta. Lo más común es que no se haya hecho el paso 4 o que el punto de venta no sea del tipo Web Services.</p>
        </div>
        <div className="flex justify-end"><Button onClick={onClose}>Entendido</Button></div>
      </div>
    </Modal>
  );
}

function Phase({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-700">{title}</h3>
      {children}
    </section>
  );
}

function Step({ n, title, tip, children }: { n: number; title: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold text-slate-900">{title}</p>
        <ul className="list-disc space-y-1.5 pl-5">{children}</ul>
        {tip && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{tip}</p>}
      </div>
    </div>
  );
}
