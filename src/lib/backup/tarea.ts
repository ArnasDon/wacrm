import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyFailure, type FailureNotice } from './aviso';
import { fileSize, runCommand, sha256 } from './comandos';
import {
  backupArtifacts,
  backupConfigFromEnv,
  databaseUrlFromEnv,
  destinationFolder,
  templateTopology,
  type BackupArtifact,
} from './contrato';
import { createUploader, type CommandRunner, type Uploader } from './destino';

export const MANIFEST_NAME = 'manifiesto.json';

export type BackupOutcome =
  | { ok: true; folder: string; uploaded: string[] }
  | {
      ok: false;
      folder: string;
      uploaded: string[];
      failure: FailureNotice;
      notified: boolean;
    };

export type BackupDeps = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  run?: CommandRunner;
  topology?: ReturnType<typeof templateTopology>;
  makeUploader?: typeof createUploader;
  notify?: typeof notifyFailure;
  workDir?: string;
  sleep?: (ms: number) => Promise<void>;
};

class StepError extends Error {
  constructor(
    readonly step: FailureNotice['step'],
    readonly artifact: string | null,
    message: string
  ) {
    super(message);
  }
}

const STDERR_LIMIT = 500;

export async function runDailyBackup(
  deps: BackupDeps = {}
): Promise<BackupOutcome> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const run = deps.run ?? runCommand;
  const notify = deps.notify ?? notifyFailure;
  const makeUploader = deps.makeUploader ?? createUploader;

  const config = backupConfigFromEnv(env);
  const topology = deps.topology ?? templateTopology();
  const folder = destinationFolder(now());
  const artifacts = backupArtifacts(topology);
  const uploader: Uploader = makeUploader(config, folder, {
    run,
    sleep: deps.sleep,
  });
  const work = deps.workDir ?? (await mkdtemp(join(tmpdir(), 'bak1-work-')));
  const created: string[] = [];
  const uploaded: string[] = [];

  // Never let a secret reach the notice, even through a command's stderr.
  const secrets = [config.credencial, env.BACKUP_DB_URL].filter(
    (s): s is string => Boolean(s)
  );
  const scrub = (text: string) =>
    secrets.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text);

  const command = async (
    step: FailureNotice['step'],
    artifact: BackupArtifact,
    cmd: string,
    args: string[],
    target: string
  ) => {
    const result = await run(cmd, args);
    created.push(target);
    if (result.code !== 0) {
      throw new StepError(
        step,
        artifact.fileName,
        `${cmd} exited with ${result.code}: ${result.stderr.slice(0, STDERR_LIMIT)}`
      );
    }
    if ((await fileSize(target)) === 0) {
      throw new StepError(
        step,
        artifact.fileName,
        `${cmd} produced an empty file`
      );
    }
  };

  try {
    const files: { name: string; path: string }[] = [];
    for (const artifact of artifacts) {
      const target = join(work, artifact.fileName);
      if (artifact.kind === 'database') {
        const url = databaseUrlFromEnv(env, topology);
        await command(
          'dump',
          artifact,
          'pg_dump',
          [
            '--dbname',
            url,
            '--format',
            'custom',
            '--compress',
            '6',
            '--file',
            target,
          ],
          target
        );
      } else {
        await command(
          'archive',
          artifact,
          'tar',
          ['-c', '-z', '-f', target, '-C', artifact.sourcePath, '.'],
          target
        );
      }
      files.push({ name: artifact.fileName, path: target });
    }

    const manifestPath = join(work, MANIFEST_NAME);
    try {
      const entries = [];
      for (const file of files) {
        entries.push({
          name: file.name,
          bytes: await fileSize(file.path),
          sha256: await sha256(file.path),
        });
      }
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            version: 'BAK.1.v1',
            folder,
            createdAt: now().toISOString(),
            files: entries,
          },
          null,
          2
        )
      );
      created.push(manifestPath);
    } catch (error) {
      throw new StepError(
        'manifest',
        MANIFEST_NAME,
        error instanceof Error ? error.message : 'manifest failed'
      );
    }

    for (const file of [
      ...files,
      { name: MANIFEST_NAME, path: manifestPath },
    ]) {
      try {
        await uploader.upload(file.path, file.name);
      } catch (error) {
        throw new StepError(
          'upload',
          file.name,
          error instanceof Error ? error.message : 'upload failed'
        );
      }
      uploaded.push(file.name);
    }
    return { ok: true, folder, uploaded };
  } catch (error) {
    const step = error instanceof StepError ? error.step : 'dump';
    const failure: FailureNotice = {
      step,
      artifact: error instanceof StepError ? error.artifact : null,
      destinationScheme: uploader.scheme,
      folder,
      message: scrub(error instanceof Error ? error.message : 'backup failed'),
      at: now().toISOString(),
    };
    const notified = await notify(config.avisoWebhook, failure);
    return { ok: false, folder, uploaded, failure, notified };
  } finally {
    for (const path of created) await rm(path, { force: true });
    if (!deps.workDir) await rm(work, { recursive: true, force: true });
  }
}
