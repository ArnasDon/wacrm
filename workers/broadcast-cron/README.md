# Broadcast cron worker

This small Cloudflare Worker runs once per minute and calls the broadcast
queue endpoint on the Vercel-hosted application. It has no database, queue,
or app bindings, so deploying it does not deploy wacrm to Cloudflare.

## Deploy

1. Set `CRON_SECRET` in the Vercel project's Production environment variables.
   Use a long random value.
2. From the repository root, set the same two Worker secrets:

   ```sh
   npx wrangler secret put CRON_SECRET --config workers/broadcast-cron/wrangler.jsonc
   npx wrangler secret put VERCEL_BROADCAST_CRON_URL --config workers/broadcast-cron/wrangler.jsonc
   ```

   The URL value must be the production Vercel URL plus
   `/api/broadcasts/cron`, for example
   `https://your-app.vercel.app/api/broadcasts/cron`.

3. Deploy only this Worker:

   ```sh
   npx wrangler deploy --config workers/broadcast-cron/wrangler.jsonc
   ```

Cloudflare invokes the `scheduled()` handler every minute. The Vercel endpoint
processes the ten oldest pending broadcast recipients each time, one after another.
