# MedApp · Proyecto Programación Web

**Integrantes:** Rafael Sclani · Gonzalo Castelnuovo

Aplicación web para gestionar un consultorio o clínica de salud en Argentina: agenda de turnos, pacientes y tratamientos, historia clínica, facturación a obras sociales (con ARCA) y balance de cobros.

## Probar la app

- **Sitio publicado:** https://rafa-gonza-proyecto-programacion-web.vercel.app
- **Usuario demo:** `demo@medapp.com.ar` · **Contraseña:** `Demo1234!`

Todos los datos son ficticios: pacientes, obras sociales y facturas inventados para probar.

## Funciones

- **Agenda:** turnos sueltos o en serie, una agenda por profesional, sobreturnos, copiar un mes, deshacer cambios. Funciona en celular, iPad y compu.
- **Pacientes:** ficha con cobertura, CUD y archivos adjuntos (credencial, orden médica). Se archivan, no se borran.
- **Historia clínica:** cada registro queda con autor, fecha y hora; no se edita ni se borra, solo se anula con motivo.
- **Tratamientos:** sesiones autorizadas, atendidas y las que quedan.
- **Facturación:** las facturas se arman solas con las sesiones atendidas y la tarifa de cada obra social. Tablero por estado (para emitir, sin presentar, presentadas, vencidas, cobradas), emisión en ARCA con CAE y PDF con QR.
- **Balance:** cobrado, por cobrar y vencido, por mes, por cobertura y por antigüedad.
- **Roles:** administración, profesional y asistente; cada uno ve y hace solo lo que le corresponde.

## Stack

| Capa | Tecnología |
|---|---|
| Interfaz | React 19 · Tailwind CSS 4 |
| Aplicación (frontend + backend) | Next.js 16 · TypeScript |
| Base de datos, login y archivos | Supabase (PostgreSQL 17, Auth, Storage) |
| Publicación | Vercel · GitHub |
| Servicios externos | ARCA (factura electrónica) · Mercado Pago |
| Librerías | date-fns · Recharts · react-pdf · node-forge |
| Calidad | Playwright · ESLint |

## Arquitectura

- El **navegador** muestra las pantallas (React + Tailwind).
- El **servidor** (Next.js en Vercel) revisa la sesión en cada pedido (`src/proxy.ts`), arma las páginas leyendo la base (Server Components) y guarda los cambios (Server Actions).
- **Supabase** guarda los datos. La seguridad la hace cumplir la base con **RLS**: cada consulta devuelve solo las filas de la clínica y el rol de quien la hace. Los **triggers** registran cada cambio (auditoría) y protegen la historia clínica.

## Estructura del código

```
src/app/(app)/      pantallas: agenda, pacientes, tratamientos, facturación, balance, configuración
src/app/(auth)/     login, registro con código de invitación, recuperar contraseña
src/lib/            reglas de facturación, conexión con ARCA, formatos, sesión
src/proxy.ts        control de sesión en cada pedido
supabase/schema.sql tablas, reglas de seguridad (RLS) y triggers
supabase/migrations cambios de la base, en orden
```

## Correr en local

```bash
npm install
cp .env.example .env.local   # completar la URL y la clave pública de Supabase
npm run dev
```

La base se crea ejecutando `supabase/schema.sql` en un proyecto de Supabase.
