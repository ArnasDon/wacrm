import nextEnv from '@next/env';
import { setTimeout } from 'node:timers/promises';

nextEnv.loadEnvConfig(process.cwd());
const origin =
  process.env.JOBS_BASE_URL ??
  process.env.BETTER_AUTH_URL ??
  'http://localhost:3000';
const secret = process.env.AUTOMATION_CRON_SECRET;
if (!secret) {
  console.error(
    'Configure AUTOMATION_CRON_SECRET in .env.local before running local jobs.'
  );
  process.exit(1);
}
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => controller.abort());
do {
  for (const path of ['/api/automations/cron', '/api/flows/cron']) {
    if (controller.signal.aborted) break;
    try {
      const response = await fetch(new URL(path, origin), {
        headers: { 'x-cron-secret': secret },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55_000),
        ]),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`[jobs] ${path}: ${JSON.stringify(await response.json())}`);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(`[jobs] ${path}: ${error.message}`);
        if (process.argv.includes('--once')) process.exitCode = 1;
      }
    }
  }
  if (process.argv.includes('--once') || controller.signal.aborted) break;
  try {
    await setTimeout(60_000, undefined, { signal: controller.signal });
  } catch {
    break;
  }
} while (!controller.signal.aborted);
