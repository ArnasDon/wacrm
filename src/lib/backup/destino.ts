import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackupConfig } from './contrato';

export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

export type Uploader = {
  scheme: 'file' | 's3' | 'b2' | 'gs';
  upload: (localPath: string, remoteName: string) => Promise<void>;
};

const SCHEMES = ['file', 's3', 'b2', 'gs'] as const;
const BACKOFF_MS = [1000, 4000];

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createUploader(
  config: BackupConfig,
  folder: string,
  deps: {
    run: CommandRunner;
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Uploader {
  const sep = config.destinoUri.indexOf('://');
  const scheme = config.destinoUri.slice(0, sep) as Uploader['scheme'];
  if (sep < 0 || !SCHEMES.includes(scheme)) {
    throw new Error('Unsupported backup destination scheme');
  }
  const rest = config.destinoUri.slice(sep + 3).replace(/\/+$/, '');

  if (scheme === 'file') {
    return {
      scheme,
      async upload(localPath, remoteName) {
        const dir = join(rest, folder);
        await mkdir(dir, { recursive: true });
        await copyFile(localPath, join(dir, remoteName));
      },
    };
  }

  const attempts = deps.attempts ?? 3;
  const sleep = deps.sleep ?? defaultSleep;

  async function once(localPath: string, remoteName: string) {
    const dir = await mkdtemp(join(tmpdir(), 'bak-rclone-'));
    const configPath = join(dir, 'rclone.conf');
    try {
      await writeFile(configPath, `[destino]\n${config.credencial}\n`, {
        mode: 0o600,
      });
      const result = await deps.run('rclone', [
        '--config',
        configPath,
        'copyto',
        localPath,
        `destino:${rest}/${folder}/${remoteName}`,
      ]);
      if (result.code !== 0) {
        throw new Error(
          `rclone exited with ${result.code}: ${result.stderr.slice(0, 500)}`
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    scheme,
    async upload(localPath, remoteName) {
      let last: unknown;
      for (let i = 0; i < attempts; i++) {
        try {
          await once(localPath, remoteName);
          return;
        } catch (error) {
          last = error;
          if (i < attempts - 1) await sleep(BACKOFF_MS[i] ?? 4000);
        }
      }
      throw last instanceof Error ? last : new Error('upload failed');
    },
  };
}
