# Túnel de Cloudflare y webhook de Meta (BASE.2)

El servicio `tunnel` de `docker-compose.yml` es un Cloudflare Tunnel saliente: el host no
publica ningún puerto para él (R1). Está bajo el profile `tunnel`, así que `docker compose up`
sin profile no lo arranca ni exige token.

| Hostname público | Destino interno |
|---|---|
| `crm.<dominio>` | `http://app:3000` |
| `api.<dominio>` | `http://supabase-kong:8000` |

El webhook de Meta es `POST/GET /api/whatsapp/webhook` en el app, así que se registra por
`https://crm.<dominio>/api/whatsapp/webhook`.

## Pasos manuales (Juan)

1. Cloudflare Zero Trust > Networks > Tunnels > Create a tunnel (Cloudflared), nombre
   `wacrm-<empresa>`. Copia el token.
2. En el túnel, Public Hostnames: los dos de la tabla (el servicio es `http://app:3000` y
   `http://supabase-kong:8000`, porque cloudflared corre en la red de compose).
3. En `.env` de la máquina: `CLOUDFLARE_TUNNEL_TOKEN=<token>`, y
   `NEXT_PUBLIC_SUPABASE_URL=https://api.<dominio>`, `NEXT_PUBLIC_SITE_URL=https://crm.<dominio>`
   (son variables de build: `docker compose build app`).
4. `docker compose --profile tunnel up -d --wait`.
5. En el CRM, Ajustes > WhatsApp: guarda `verify_token` y credenciales. En Meta (App >
   WhatsApp > Configuration > Webhook): callback `https://crm.<dominio>/api/whatsapp/webhook`
   con ese `verify_token`; suscribe `messages`.
6. Verifica extremo a extremo: mensaje desde un teléfono aparece en la bandeja en menos de 5 s
   y la respuesta desde la bandeja llega al teléfono.

## Acceso del servidor a Supabase

Dentro del contenedor, el servidor usa `SUPABASE_INTERNAL_URL` (`http://supabase-kong:8000`)
y no la URL pública: `src/lib/supabase/internal-url.ts`. Como supabase-js deriva el nombre de la
cookie de sesión del hostname de la URL, se fija con `supabaseAuthCookieName()` al nombre que
deriva el navegador desde la URL pública.

Las URLs que arma el servidor con ese cliente (por ejemplo las de Storage) salen con el host
interno (`http://supabase-kong:8000`) y no sirven en el navegador ni en Meta. Antes de persistir
una, pásala por `toPublicSupabaseUrl()` (ya lo hace el espejo de adjuntos entrantes en
`mirror-inbound-media.ts`).
