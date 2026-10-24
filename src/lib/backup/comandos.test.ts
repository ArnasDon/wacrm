import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSize, runCommand, sha256 } from './comandos';

describe('runCommand', () => {
  it('returns code 0 and stdout of a command that works', async () => {
    const result = await runCommand('node', [
      '-e',
      'process.stdout.write("hola")',
    ]);
    expect(result).toMatchObject({ code: 0, stdout: 'hola' });
  });

  it('returns the exit code and stderr instead of throwing', async () => {
    const result = await runCommand('node', [
      '-e',
      'process.stderr.write("mal");process.exit(3)',
    ]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('mal');
  });

  it('gives up on a command that hangs past the timeout', async () => {
    const result = await runCommand(
      'node',
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 50 }
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/timeout/i);
  });

  it('does not go through a shell', async () => {
    const result = await runCommand('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      '$(echo inyectado)',
    ]);
    expect(result.stdout).toBe('$(echo inyectado)');
  });

  it('returns a failure when the binary does not exist', async () => {
    const result = await runCommand('no-such-binary-bak1', []);
    expect(result.code).not.toBe(0);
  });
});

describe('fileSize / sha256', () => {
  it('measures and hashes a file', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'bak1-')), 'a.txt');
    await writeFile(path, 'abc');
    expect(await fileSize(path)).toBe(3);
    expect(await sha256(path)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
