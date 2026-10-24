import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { CommandRunner } from './destino';

export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/** The only real child_process adapter; no shell, never throws. */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };

    const child = spawn(command, args, { shell: false });
    const timer = setTimeout(() => {
      timedOut = true;
      stderr += `timeout after ${timeoutMs}ms`;
      child.kill('SIGKILL');
      finish(-1);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      stderr += error.message;
      finish(-1);
    });
    child.on('close', (code) => {
      if (timedOut) return;
      finish(code ?? -1);
    });
  });

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
