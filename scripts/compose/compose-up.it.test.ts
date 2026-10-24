/**
 * Integration test: docker compose up on a clean machine.
 *
 * Disabled by default — only runs when COMPOSE_IT=1 is set.
 * On CI it runs in a dedicated workflow (.github/workflows/compose-it.yml)
 * on a fresh ubuntu-latest runner, which is the "clean machine" the slice
 * criterion requires.
 *
 * Safety: refuses to start if .env already exists (would overwrite it).
 * Cleans up .env and brings the stack down even if the test fails.
 */

import {
  execFileSync,
  execSync,
  type ExecSyncOptionsWithStringEncoding,
} from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(REPO_ROOT, '.env');

const enabled = process.env['COMPOSE_IT'] === '1';

/**
 * Runs `node scripts/supabase-keys.mjs` and returns its stdout plus the
 * derived lines that map ANON_KEY / SERVICE_ROLE_KEY into the wacrm-specific
 * variable names. When appended to .env.example, these override the placeholders.
 */
function mintKeys(): string {
  const output = execSync('node scripts/supabase-keys.mjs', {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  // Derive NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, META_APP_SECRET
  const lines: Record<string, string> = {};
  for (const line of output.trim().split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) lines[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
  }
  const extras = [
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${lines['ANON_KEY'] ?? ''}`,
    `SUPABASE_SERVICE_ROLE_KEY=${lines['SERVICE_ROLE_KEY'] ?? ''}`,
    // Dummy Meta App Secret — the app won't receive webhooks, but it must start
    `META_APP_SECRET=integration-test-secret`,
  ].join('\n');
  return output + extras + '\n';
}

const execOpts: ExecSyncOptionsWithStringEncoding = {
  encoding: 'utf8',
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
};

/**
 * Prints `docker compose ps` and recent logs while the stack still exists.
 * `afterAll` always runs `compose down -v`, so the workflow step that dumps
 * logs afterwards sees nothing when `--wait` fails.
 */
function dumpComposeDiagnostics(): void {
  const commands = [
    ['compose', 'ps'],
    ['compose', 'logs', '--tail', '200'],
  ];
  for (const args of commands) {
    const label = `docker ${args.join(' ')}`;
    try {
      const output = execFileSync('docker', args, {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
      console.error(`\n--- ${label} ---\n${output}`);
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      console.error(
        `\n--- ${label} (failed) ---\n${failed.stdout ?? ''}${failed.stderr ?? ''}`
      );
    }
  }
}

describe.skipIf(!enabled)('docker compose up on a clean machine', () => {
  beforeAll(() => {
    if (existsSync(ENV_PATH)) {
      throw new Error(
        `.env already exists at ${ENV_PATH} — this test only runs on a clean machine (no existing .env).`
      );
    }
    const envContent = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8');
    // Every-minute schedule so the cron case does not wait five minutes.
    writeFileSync(
      ENV_PATH,
      envContent + '\n' + mintKeys() + 'CRON_SCHEDULE=* * * * *\n'
    );
  }, 30_000);

  afterAll(() => {
    try {
      execFileSync('docker', ['compose', 'down', '-v', '--remove-orphans'], {
        ...execOpts,
        stdio: 'ignore',
      });
    } finally {
      rmSync(ENV_PATH, { force: true });
    }
  }, 300_000);

  it('brings every service to healthy', () => {
    // `--wait` exits non-zero if any service fails to reach healthy before
    // the timeout — that IS the assertion. Dump ps/logs before afterAll
    // tears the stack down.
    try {
      execFileSync(
        'docker',
        ['compose', 'up', '-d', '--wait', '--wait-timeout', '600'],
        { ...execOpts, stdio: 'inherit' }
      );
    } catch (error) {
      dumpComposeDiagnostics();
      throw error;
    }

    // Double-check via `docker compose ps` — every service must report healthy.
    const psOutput = execFileSync(
      'docker',
      ['compose', 'ps', '--format', 'json'],
      execOpts
    );
    // Each line is a JSON object (one per service)
    const rows = psOutput
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { Name: string; Health: string });

    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.Health, `service ${row.Name} is not healthy`).toBe('healthy');
    }
  }, 900_000);

  it('runs the wacrm scheduled tasks from inside the compose network', async () => {
    // Migrations need auth.users (created by gotrue), so they are applied
    // after the first `up --wait`, as docs/docker.md describes.
    execFileSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'supabase-db',
        'sh',
        '-c',
        'for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" >/dev/null || exit 1; done',
      ],
      execOpts
    );
    // 200 (not 503) proves the AUTOMATION_CRON_SECRET header arrived.
    const deadline = Date.now() + 180_000;
    let logs = '';
    while (Date.now() < deadline) {
      logs = execFileSync('docker', ['compose', 'logs', 'cron'], execOpts);
      if (
        logs.includes('/api/automations/cron 200') &&
        logs.includes('/api/flows/cron 200')
      )
        return;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    throw new Error(`cron did not report 200 for both tasks:\n${logs}`);
  }, 300_000);

  it('publishes no Postgres port on the host', () => {
    const psOutput = execFileSync(
      'docker',
      ['compose', 'ps', '--format', 'json'],
      execOpts
    );
    const rows = psOutput
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            Name: string;
            Publishers: Array<{ PublishedPort: number; URL: string }>;
          }
      );

    const postgresPorts = [5432, 6543];
    for (const row of rows) {
      for (const pub of row.Publishers ?? []) {
        expect(
          postgresPorts,
          `Service ${row.Name} publishes Postgres port ${pub.PublishedPort}`
        ).not.toContain(pub.PublishedPort);
      }
    }

    // docker compose port exits 0 in Compose v2 even when no port is mapped;
    // docker inspect is reliable across all versions.
    const inspectOut = execFileSync(
      'docker',
      [
        'inspect',
        'wacrm-supabase-db-1',
        '--format',
        '{{json .NetworkSettings.Ports}}',
      ],
      execOpts
    );
    const ports = JSON.parse(inspectOut.toString().trim()) as Record<
      string,
      unknown
    >;
    expect(
      ports['5432/tcp'] ?? null,
      'supabase-db port 5432 should not be published'
    ).toBeNull();
  }, 60_000);

  it('publishes nothing on a public interface', () => {
    const psOutput = execFileSync(
      'docker',
      ['compose', 'ps', '--format', 'json'],
      execOpts
    );
    const rows = psOutput
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            Name: string;
            Publishers: Array<{ URL: string; PublishedPort: number }>;
          }
      );

    for (const row of rows) {
      for (const pub of row.Publishers ?? []) {
        if (pub.PublishedPort === 0) continue; // not published
        expect(
          pub.URL,
          `Service ${row.Name} publishes on non-loopback interface`
        ).toBe('127.0.0.1');
      }
    }
  }, 60_000);
});
