import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline security headers applied to every response.
 *
 * CSP ships as `Content-Security-Policy-Report-Only` so the browser
 * surfaces violations in the console without blocking anything — once
 * we have confidence nothing legit trips it (two deploys, a pass on
 * every route), flip the key to `Content-Security-Policy` to enforce.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / etc, so
 *     deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Microphone is allowed for same-origin (`self`) so the inbox
    // composer can record voice notes via MediaRecorder. Everything
    // else stays denied — a compromised dependency can't silently grab
    // the camera / geolocation / etc.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      //
      // youtube.com: la API de iframes (YT.Player) se carga bajo demanda al
      // pulsar play — es la única copia, no existe en el dominio nocookie.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com",
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      // Outbound media previews (blob: from MediaRecorder + file picker)
      // and Supabase public-bucket audio/video the inbox renders.
      "media-src 'self' blob: https://*.supabase.co",
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). All Meta API calls happen
      // server-side, so graph.facebook.com does not belong here.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      // El reproductor de la landing embebe en nocookie (god.ts le pasa
      // `host`). Sin `frame-src` explícito cae a `default-src 'self'` y, en
      // cuanto esta cabecera pase de report-only a enforcing, el vídeo deja de
      // cargar. Se declara también youtube.com porque el reproductor redirige
      // ahí en algunos flujos de consentimiento.
      "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the
  // Docker image can run without node_modules or the Next CLI.
  // Harmless outside Docker: `next start` keeps working as before.
  output: "standalone",

  /**
   * Cross-origin dev access (Next.js 16).
   *
   * Next 16 blocks requests to dev-only resources (`/_next/*` internals,
   * the HMR websocket, the dev overlay) unless the browser's Origin is
   * the host the dev server booted on — `localhost` by default. Tunnels
   * like ngrok serve the app from a public HTTPS host, so without
   * allow-listing that host those dev requests come back 403: HMR stops
   * working and the dev session degrades over the tunnel (issue #365).
   *
   * Wildcards match subdomains only (Next's CSRF matcher), so the
   * randomised tunnel subdomain is covered. Add any other host via
   * `ALLOWED_DEV_ORIGINS` (comma-separated). This key is dev-only and
   * has no effect on a production build.
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    "*.loca.lt",
    ...(process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : []),
  ],

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path((?!_next/static|_next/image|api).*)",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },

  /**
   * Landing estática (Astro, DAD §3.1).
   *
   * `pnpm --filter landing build` copia `landing/dist/` a `public/landing/`
   * (los assets hash se emiten bajo `/landing/_astro/*` por el `base:
   * '/landing'` de astro.config.mjs). El redirect de la raíz a /dashboard
   * se quita: la raíz sirve la landing (home del Revenue Engine).
   *
   * beforeFiles: gana al filesystem (page.tsx) → `/` muestra la landing.
   * La URL limpia `/landing` (sin trailing slash) → index.html, evitando
   * el redirect 308 de Next para directorios estáticos.
   */
  async rewrites() {
    return {
      beforeFiles: [
        // TODO /landing/* (y la raíz) → route handler dinámico
        // (/api/landing/[...path]) que lee public/landing del FILESYSTEM
        // REAL en cada request. El servidor estático de Next solo sirve
        // archivos del build del contenedor; el live update del page editor
        // regenera el HTML en runtime y el fs estático daba 404 (o lo
        // congelaba). beforeFiles gana al filesystem de public/.
        { source: "/", destination: "/api/landing/index.html" },
        { source: "/landing/:path*", destination: "/api/landing/:path*" },
      ],
      afterFiles: [
        // Las páginas de gracias cuelgan del home, no de /landing: son el
        // final del embudo de la raíz y `/landing/...` en la barra de
        // direcciones delata la mecánica interna. El HTML se sigue
        // construyendo bajo /landing/ — el `base` de Astro es lo que hace
        // resolver los `_astro/*` hasheados — y esto solo cambia la URL
        // pública. Un rewrite, no un redirect: sin salto visible.
        { source: "/thank-you", destination: "/landing/thank-you/index.html" },
        {
          source: "/thank-you-download",
          destination: "/landing/thank-you-download/index.html",
        },
      ],
    };
  },

  /**
   * Rutas viejas que ya circulan por ahí.
   *
   * `permanent: false` (307) a propósito: un 308 se queda cacheado en el
   * navegador de forma prácticamente irreversible, y estas rutas son jóvenes —
   * si hubiera que deshacerlo, un 307 se deshace y un 308 no.
   *
   * Los dos nombres viejos del imán de leads: el PDF es un archivo estático
   * bajo public/landing/, y `copy-dist.mjs` borra el destino entero en cada
   * build, así que sin esto la URL que el lead guardó en su historial pasa a
   * 404 en el siguiente despliegue. Los redirects de Next se evalúan antes
   * del sistema de archivos, así que cubren rutas que ya no existen en disco.
   */
  async redirects() {
    return [
      { source: "/landing/thank-you", destination: "/thank-you", permanent: false },
      // URLs viejas con extensión que generaba una versión anterior del
      // page editor (el build de Astro emite directorios, no .html).
      { source: "/landing/:slug.html", destination: "/landing/:slug", permanent: false },
      {
        source: "/landing/guia-dolor-de-espalda.pdf",
        destination: "/landing/guia.pdf",
        permanent: false,
      },
      {
        source: "/landing/guide-2026.pdf",
        destination: "/landing/guia.pdf",
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
