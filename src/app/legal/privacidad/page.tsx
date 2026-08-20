import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

// ============================================================
// Public privacy-policy page — required as the "Privacy Policy URL"
// on the Google Cloud OAuth consent screen (chat-sandia project)
// before it can request verification to leave "Testing" status.
// Google's review looks specifically for the Limited Use disclosure
// language near the bottom — do not remove or reword that section
// without checking https://developers.google.com/terms/api-services-user-data-policy
// first.
//
// Deliberately outside every route group with auth (not under
// (dashboard) or (auth)) and NOT in `protectedPaths` in
// src/proxy.ts, so it's reachable by anonymous visitors — including
// Google's own verification reviewer.
// ============================================================

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description:
    'Política de privacidad de Chat Sandía: qué datos recopilamos, cómo los usamos y cómo se conecta la integración con Google Calendar.',
  robots: { index: true, follow: true },
};

const LAST_UPDATED = '20 de agosto de 2026';
const CONTACT_EMAIL = 'asistentedechat@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-background text-foreground min-h-screen px-4 py-16">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
          >
            <span className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg">
              <MessageSquare className="text-primary h-4 w-4" />
            </span>
            Chat Sandía
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            Política de privacidad
          </h1>
          <p className="text-muted-foreground text-sm">
            Última actualización: {LAST_UPDATED}
          </p>
        </header>

        <section className="space-y-3">
          <p>
            Chat Sandía es una plataforma de inteligencia comercial para
            empresas: bandeja compartida de WhatsApp/Instagram/Facebook,
            pipeline de negociaciones, automatizaciones y un asistente de
            IA que responde a clientes y puede agendar citas en nombre del
            equipo que usa la plataforma. Cada empresa que usa Chat Sandía
            (&quot;cuenta&quot;) administra sus propios datos, aislados de
            cualquier otra cuenta.
          </p>
          <p>
            Esta página describe qué datos recopila Chat Sandía, cómo se
            usan y, en particular, qué hacemos con los datos de tu cuenta
            de Google cuando conectas Google Calendar.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Qué datos recopilamos</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Datos de cuenta:</strong> nombre, correo electrónico y
              contraseña (gestionados por nuestro proveedor de
              autenticación, Supabase) de las personas que usan la
              plataforma.
            </li>
            <li>
              <strong>Datos de tus clientes:</strong> contactos, mensajes y
              archivos multimedia que tu equipo intercambia con sus propios
              clientes a través de WhatsApp, Instagram o Facebook, más
              cualquier dato que tu equipo registre manualmente (etiquetas,
              notas, negociaciones).
            </li>
            <li>
              <strong>Datos de uso:</strong> registros técnicos básicos
              (fecha/hora de acceso, errores) usados solo para operar y
              dar soporte a la plataforma.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Integración con Google Calendar
          </h2>
          <p>
            Si conectas Google Calendar desde Configuración, Chat Sandía
            solicita permiso para los siguientes alcances (scopes) de la
            API de Google Calendar — y solo esos:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <code className="bg-muted rounded px-1 py-0.5 text-sm">
                calendar.events
              </code>{' '}
              — crear y leer eventos que el asistente de IA agenda en tu
              calendario cuando confirma una cita con un cliente.
            </li>
            <li>
              <code className="bg-muted rounded px-1 py-0.5 text-sm">
                calendar.freebusy
              </code>{' '}
              — consultar tus horarios libres/ocupados para saber cuándo
              puede ofrecer una cita, sin leer el contenido de tus otros
              eventos.
            </li>
            <li>
              <code className="bg-muted rounded px-1 py-0.5 text-sm">
                userinfo.email
              </code>{' '}
              — mostrar en Configuración qué cuenta de Google está
              conectada.
            </li>
          </ul>
          <p>
            Chat Sandía <strong>nunca</strong> solicita acceso de lectura a
            los detalles de tus demás eventos (título, invitados,
            descripción), ni a otros productos de Google (Gmail, Drive,
            Contactos, etc.). Los tokens de acceso y de actualización se
            guardan cifrados (AES-256-GCM) en nuestra base de datos y
            nunca se comparten con terceros. Puedes revocar el acceso en
            cualquier momento desde Configuración → Google Calendar →
            Desconectar, o directamente desde{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              la página de permisos de tu cuenta de Google
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Con quién compartimos datos
          </h2>
          <p>
            No vendemos datos personales. Los compartimos únicamente con
            los proveedores necesarios para operar el servicio, bajo
            obligaciones de confidencialidad: Meta (WhatsApp/Instagram/
            Facebook, para enviar y recibir mensajes), Google (Calendar,
            solo si tú lo conectas), Supabase (base de datos y
            autenticación) y nuestro proveedor de hosting. Ninguno de
            estos proveedores puede usar tus datos para sus propios fines
            publicitarios.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Seguridad</h2>
          <p>
            Los datos de cada cuenta están aislados mediante controles de
            acceso a nivel de base de datos (Row Level Security), de modo
            que ninguna cuenta puede leer los datos de otra. Los secretos
            (tokens de API, credenciales) se guardan cifrados en reposo.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Retención y eliminación
          </h2>
          <p>
            Conservamos los datos mientras la cuenta esté activa. Puedes
            solicitar la eliminación de tu cuenta y de los datos asociados
            escribiendo a{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-primary hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className="space-y-3 border-border bg-muted/30 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Uso limitado de datos de Google</h2>
          <p className="text-sm">
            El uso que Chat Sandía hace de la información recibida de las
            APIs de Google se rige por la{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Política de datos de usuario de los servicios de la API de
              Google
            </a>
            , incluidos los requisitos de Uso Limitado.
          </p>
          <p className="text-muted-foreground text-sm italic">
            Chat Sandía&apos;s use and transfer to any other app of
            information received from Google APIs will adhere to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Cambios a esta política</h2>
          <p>
            Podemos actualizar esta política ocasionalmente. Publicaremos
            cualquier cambio en esta misma página con la fecha de
            actualización correspondiente.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Contacto</h2>
          <p>
            Para preguntas sobre esta política o sobre tus datos, escribe
            a{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-primary hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
