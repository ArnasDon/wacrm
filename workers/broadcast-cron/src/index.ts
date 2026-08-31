interface Env {
  CRON_SECRET: string;
  VERCEL_BROADCAST_CRON_URL: string;
}

async function triggerBroadcastQueue(env: Env): Promise<void> {
  try {
    const response = await fetch(env.VERCEL_BROADCAST_CRON_URL, {
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
      },
    });

    if (!response.ok) {
      console.error(
        `[broadcast-cron] Vercel queue endpoint returned ${response.status}`,
      );
    }
  } catch (error) {
    console.error('[broadcast-cron] Could not call the Vercel queue endpoint', error);
  }
}

export default {
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(triggerBroadcastQueue(env));
  },

  async fetch(): Promise<Response> {
    return new Response('Broadcast cron worker is healthy.');
  },
} satisfies ExportedHandler<Env>;
