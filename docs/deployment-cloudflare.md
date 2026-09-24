# Deploy on Cloudflare Workers

This project uses vinext to run the Next.js App Router on Cloudflare Workers.
It is a dynamic application, so deploy it as a Worker rather than as a static
Cloudflare Pages export.

## 1. Configure environment variables

In Cloudflare Dashboard, open **Workers & Pages → wacrm → Settings → Variables
and Secrets** and add the values from `.env.local` / `.env.local.example`.

Keep these encrypted as secrets:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`
- `META_APP_SECRET`
- `ORDERS_PG_PASSWORD`
- `ORDERS_PG_HOST`
- `ORDERS_PG_PORT`
- `ORDERS_PG_DBNAME`
- `ORDERS_PG_USER`

Add the public/runtime values as variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_LOCALE`

Add optional variables only when the related feature is enabled. Never commit
`.env.local` or secret values.

## 2. Build and preview locally

```bash
npm install
npm run build:vinext
npm run start:vinext
```

## 3. Deploy

```bash
npm run deploy:vinext
```

The Worker name is `wacrm`; Wrangler will print the deployed `workers.dev`
URL. Attach a custom domain from the Worker’s **Domains & Routes** settings.

Before publishing a change, validate the generated bundle with:
```bash
npm run build:vinext
npx wrangler deploy --dry-run --config dist/server/wrangler.json
```
