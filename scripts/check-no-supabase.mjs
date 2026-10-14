import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const problems = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\./.test(path)) {
      const source = await readFile(path, 'utf8');
      if (
        /@supabase\/|lib\/supabase|process\.env(?:\.|\[['"])(?:NEXT_PUBLIC_)?SUPABASE_|https?:\/\/[^\s'"`]+\.supabase\.(?:co|in)/i.test(
          source
        )
      )
        problems.push(path);
    }
  }
}
await scan('src');
for (const path of [
  'package-lock.json',
  '.env.local.example',
  'next.config.ts',
  'Dockerfile',
  'docker-compose.yml',
]) {
  try {
    if (/supabase/i.test(await readFile(path, 'utf8'))) problems.push(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (
  Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((name) =>
    name.startsWith('@supabase/')
  )
)
  problems.push('package.json');
if (problems.length) {
  console.error(
    'Supabase runtime dependency detected:\n' + problems.join('\n')
  );
  process.exitCode = 1;
} else
  console.log(
    'No Supabase runtime imports, endpoints, dependencies, or required environment variables.'
  );
