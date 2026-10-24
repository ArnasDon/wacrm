import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BASE_TOPOLOGY } from '@contracts/base/compose-services.stub';
import { MANIFEST_NAME, runDailyBackup } from './tarea';

const now = () => new Date('2026-10-21T03:00:00.000Z');
const folder = '2026-10-21T03-00-00-000Z';
const sleep = async () => {};

async function destination() {
  return mkdtemp(join(tmpdir(), 'bak1-destino-'));
}

function env(target: string) {
  return {
    BACKUP_DESTINO_URI: `file://${target}`,
    BACKUP_DESTINO_CREDENCIAL: 'no-aplica',
    BACKUP_AVISO_WEBHOOK: 'https://avisos.example.com/backup',
    BACKUP_DB_URL: 'postgresql://postgres:pw@supabase-db:5432/postgres',
  };
}

// Fake pg_dump and tar: write the file the real command would write.
function fakeRun(contents = 'datos') {
  const calls: { command: string; args: string[] }[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    const flag = command === 'pg_dump' ? '--file' : '-f';
    const out = args[args.indexOf(flag) + 1];
    if (args.includes(flag) && out) await writeFile(out, contents);
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const base = { now, topology: BASE_TOPOLOGY, sleep };

describe('runDailyBackup · IT: genera el backup de la base y el storage y lo sube', () => {
  it('sube el volcado y un archivo por volumen, con los nombres de CT.2', async () => {
    const target = await destination();
    const { run, calls } = fakeRun();
    const outcome = await runDailyBackup({
      ...base,
      env: env(target),
      run,
      notify: async () => true,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.uploaded).toEqual([
      'supabase-db.dump',
      'supabase-db-data.tar.gz',
      'supabase-storage-data.tar.gz',
      MANIFEST_NAME,
    ]);
    for (const name of outcome.uploaded) {
      await expect(
        readFile(join(target, folder, name), 'utf8')
      ).resolves.toBeTruthy();
    }
    expect(calls[0].command).toBe('pg_dump');
    expect(calls[0].args.join(' ')).toContain('supabase-db');
    expect(calls.slice(1).map((c) => c.command)).toEqual(['tar', 'tar']);
  });

  it('escribe un manifiesto con tamaño y sha256 de cada archivo', async () => {
    const target = await destination();
    const { run } = fakeRun('abc');
    await runDailyBackup({
      ...base,
      env: env(target),
      run,
      notify: async () => true,
    });
    const manifest = JSON.parse(
      await readFile(join(target, folder, MANIFEST_NAME), 'utf8')
    );
    expect(manifest.folder).toBe(folder);
    expect(manifest.files).toEqual([
      {
        name: 'supabase-db.dump',
        bytes: 3,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      { name: 'supabase-db-data.tar.gz', bytes: 3, sha256: expect.any(String) },
      {
        name: 'supabase-storage-data.tar.gz',
        bytes: 3,
        sha256: expect.any(String),
      },
    ]);
  });

  it('no deja el respaldo dentro del contenedor', async () => {
    const target = await destination();
    const work = await mkdtemp(join(tmpdir(), 'bak1-trabajo-'));
    const { run } = fakeRun();
    await runDailyBackup({
      ...base,
      env: env(target),
      run,
      workDir: work,
      notify: async () => true,
    });
    await expect(readdir(work)).resolves.toEqual([]);
  });
});

describe('runDailyBackup · IT: si la subida falla, se emite el aviso', () => {
  it('avisa con el paso, el artefacto y el error, y devuelve ok: false', async () => {
    const { run } = fakeRun();
    const notify = vi.fn(async (_url: string, _notice: unknown) => true);
    const outcome = await runDailyBackup({
      ...base,
      env: { ...env('/no-existe'), BACKUP_DESTINO_URI: 's3://b/p' },
      run: async (command, args) =>
        command === 'rclone'
          ? { code: 1, stdout: '', stderr: 'quota exceeded' }
          : run(command, args),
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.notified).toBe(true);
    const [webhook, notice] = notify.mock.calls[0] as unknown as [
      string,
      Record<string, string>,
    ];
    expect(webhook).toBe('https://avisos.example.com/backup');
    expect(notice).toMatchObject({
      step: 'upload',
      artifact: 'supabase-db.dump',
      destinationScheme: 's3',
      folder,
    });
    expect(notice.message).toContain('quota exceeded');
  });

  it('avisa también cuando falla el volcado, y no sube nada', async () => {
    const target = await destination();
    const notify = vi.fn(async (_url: string, _notice: unknown) => true);
    const outcome = await runDailyBackup({
      ...base,
      env: env(target),
      run: async () => ({
        code: 1,
        stdout: '',
        stderr: 'pg_dump: connection refused',
      }),
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.uploaded).toEqual([]);
    expect(notify.mock.calls[0][1]).toMatchObject({ step: 'dump' });
  });

  it('trata un volcado de 0 bytes como fallo antes de subirlo', async () => {
    const target = await destination();
    const notify = vi.fn(async (_url: string, _notice: unknown) => true);
    const outcome = await runDailyBackup({
      ...base,
      env: env(target),
      run: fakeRun('').run,
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(notify.mock.calls[0][1]).toMatchObject({
      step: 'dump',
      artifact: 'supabase-db.dump',
    });
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('reporta el fallo igual cuando el aviso tampoco se pudo entregar', async () => {
    const target = await destination();
    const outcome = await runDailyBackup({
      ...base,
      env: env(target),
      run: async () => ({
        code: 1,
        stdout: '',
        stderr: 'pg_dump: connection refused',
      }),
      notify: async () => false,
    });
    expect(outcome).toMatchObject({ ok: false, notified: false });
    if (outcome.ok) throw new Error('el backup no debía salir bien');
    expect(outcome.failure.step).toBe('dump');
  });

  it('no mete la credencial ni la url de la base en el aviso', async () => {
    const notify = vi.fn(async (_url: string, _notice: unknown) => true);
    await runDailyBackup({
      ...base,
      env: {
        ...env('/no-existe'),
        BACKUP_DESTINO_URI: 's3://b/p',
        BACKUP_DESTINO_CREDENCIAL: 'secret_access_key = sk-super-secreta',
      },
      run: async () => ({
        code: 1,
        stdout: '',
        stderr:
          'failed: postgresql://postgres:pw@supabase-db:5432/postgres secret_access_key = sk-super-secreta',
      }),
      notify,
    });
    const sent = JSON.stringify(notify.mock.calls[0][1]);
    expect(sent).not.toContain('sk-super-secreta');
    expect(sent).not.toContain('pw@supabase-db');
  });
});
