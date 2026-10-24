import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createUploader, type CommandRunner } from './destino';

const base = {
  credencial: 'type = s3\naccess_key_id = ak\nsecret_access_key = sk',
  avisoWebhook: 'https://avisos.example.com/backup',
  hora: '03:00' as const,
};
const ok: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
const nap = async () => undefined;

async function localFile(contents = 'dump') {
  const dir = await mkdtemp(join(tmpdir(), 'bak1-'));
  const path = join(dir, 'supabase-db.dump');
  await writeFile(path, contents);
  return { dir, path };
}

describe('file:// uploader', () => {
  it('copies the artifact into <path>/<folder>/<name>, creating the folder', async () => {
    const { dir, path } = await localFile('contenido');
    const target = join(dir, 'destino');
    const uploader = createUploader(
      { ...base, destinoUri: `file://${target}` },
      '2026-10-21T03-00-00-000Z',
      { run: ok, sleep: nap }
    );
    await uploader.upload(path, 'supabase-db.dump');
    const copied = join(target, '2026-10-21T03-00-00-000Z', 'supabase-db.dump');
    expect(await readFile(copied, 'utf8')).toBe('contenido');
  });
});

describe('rclone uploader', () => {
  it('copies to <remote>:<bucket/prefix>/<folder>/<name> with a config file', async () => {
    const { path } = await localFile();
    const run = vi.fn(ok);
    const uploader = createUploader(
      { ...base, destinoUri: 's3://backups-demo/empresa-demo' },
      '2026-10-21T03-00-00-000Z',
      { run, sleep: nap }
    );
    await uploader.upload(path, 'supabase-db.dump');
    const [command, args] = run.mock.calls[0];
    expect(command).toBe('rclone');
    expect(args).toContain('copyto');
    expect(args).toContain(path);
    expect(args).toContain(
      'destino:backups-demo/empresa-demo/2026-10-21T03-00-00-000Z/supabase-db.dump'
    );
    const configPath = args[args.indexOf('--config') + 1];
    expect(configPath).toMatch(/\.conf$/);
  });

  it('writes the credential to a 0600 file under [destino] and deletes it afterwards', async () => {
    const { path } = await localFile();
    let seen = { mode: 0, body: '' };
    const run: CommandRunner = async (_c, args) => {
      const configPath = args[args.indexOf('--config') + 1];
      const { stat } = await import('node:fs/promises');
      seen = {
        mode: (await stat(configPath)).mode & 0o777,
        body: await readFile(configPath, 'utf8'),
      };
      return { code: 0, stdout: '', stderr: '' };
    };
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', {
      run,
      sleep: nap,
    });
    await uploader.upload(path, 'x.gz');
    expect(seen.mode).toBe(0o600);
    expect(seen.body).toBe(`[destino]\n${base.credencial}\n`);
  });

  it('deletes the credential file even when the command fails', async () => {
    const { path } = await localFile();
    let configPath = '';
    const run: CommandRunner = async (_c, args) => {
      configPath = args[args.indexOf('--config') + 1];
      return { code: 1, stdout: '', stderr: 'boom' };
    };
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', {
      run,
      attempts: 1,
      sleep: nap,
    });
    await expect(uploader.upload(path, 'x.gz')).rejects.toThrow();
    const { access } = await import('node:fs/promises');
    await expect(access(configPath)).rejects.toThrow();
  });

  it('retries three times and reports the last stderr without the credential', async () => {
    const { path } = await localFile();
    const run = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'quota exceeded',
    }));
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', {
      run,
      sleep: nap,
    });
    await expect(uploader.upload(path, 'x.gz')).rejects.toThrow(
      /quota exceeded/
    );
    expect(run).toHaveBeenCalledTimes(3);
    const message = await uploader
      .upload(path, 'x.gz')
      .catch((e: Error) => e.message);
    expect(message).not.toContain('secret_access_key');
    expect(message).not.toContain('sk');
  });

  it('stops retrying as soon as one attempt succeeds', async () => {
    const { path } = await localFile();
    const run = vi
      .fn(async () => ({ code: 0, stdout: '', stderr: '' }))
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'timeout' });
    const uploader = createUploader({ ...base, destinoUri: 'gs://b/p' }, 'f', {
      run,
      sleep: nap,
    });
    await expect(uploader.upload(path, 'x.gz')).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('createUploader', () => {
  it('reports the scheme it resolved', () => {
    const file = createUploader({ ...base, destinoUri: 'file:///tmp/x' }, 'f', {
      run: ok,
    });
    const b2 = createUploader({ ...base, destinoUri: 'b2://b/p' }, 'f', {
      run: ok,
    });
    expect([file.scheme, b2.scheme]).toEqual(['file', 'b2']);
  });
});
