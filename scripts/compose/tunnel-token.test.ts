import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const hasDocker = spawnSync('docker', ['compose', 'version']).status === 0;

describe('tunnel token is optional without the tunnel profile', () => {
  it('does not require CLOUDFLARE_TUNNEL_TOKEN in docker-compose.yml', () => {
    const src = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
    expect(src).not.toMatch(/\$\{CLOUDFLARE_TUNNEL_TOKEN:\?/);
  });

  it('leaves the token empty in .env.example', () => {
    const src = readFileSync(resolve(root, '.env.example'), 'utf8');
    expect(src).toMatch(/^CLOUDFLARE_TUNNEL_TOKEN=$/m);
  });

  it.skipIf(!hasDocker)('`docker compose config` works with no profile and no variable', () => {
    const env = { ...process.env };
    delete env.CLOUDFLARE_TUNNEL_TOKEN;
    // Run from a scratch dir so the repo's own .env (if any) cannot leak in.
    const dir = mkdtempSync(resolve(tmpdir(), 'tunnel-token-'));
    copyFileSync(resolve(root, 'docker-compose.yml'), resolve(dir, 'docker-compose.yml'));
    copyFileSync(resolve(root, '.env.example'), resolve(dir, '.env'));
    const r = spawnSync('docker', ['compose', 'config', '--quiet'], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    expect(r.stderr).not.toMatch(/CLOUDFLARE_TUNNEL_TOKEN/);
    expect(r.status).toBe(0);
  });
});
