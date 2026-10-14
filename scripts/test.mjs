import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Keep tooling temporary files off the OS drive on development machines.
const temp = resolve('.cache/temp');
mkdirSync(temp, { recursive: true });
const args = process.argv.slice(2);
const workers = args.some(
  (arg) => arg === '--maxWorkers' || arg.startsWith('--maxWorkers=')
)
  ? []
  : ['--maxWorkers=1'];
const result = spawnSync(
  process.execPath,
  [
    '--wasm-lazy-compilation',
    '--liftoff-only',
    resolve('node_modules/vitest/vitest.mjs'),
    'run',
    ...workers,
    ...args,
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
  }
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
