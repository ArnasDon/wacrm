import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeStoredFile, readStoredFile, removeStoredFile } from './filesystem';
const roots: string[] = [];
async function root() { const dir = await mkdtemp(resolve('.cache/storage-test-')); roots.push(dir); return dir; }
async function* bytes(value: string) { yield Buffer.from(value); }
const id = '10000000-0000-4000-8000-000000000001';
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    if (!resolve(dir).startsWith(resolve('.cache/storage-test-'))) throw new Error('Unsafe test cleanup path');
    await rm(dir, { recursive: true, force: true });
  }
});
it('writes exclusively, rejects traversal and disallowed MIME, and cleans failed streams', async () => {
  const dir = await root();
  await writeStoredFile(dir, 'chat-media', id, 'text/plain', bytes('hello'));
  expect((await readStoredFile(dir, 'chat-media', id)).toString()).toBe('hello');
  await expect(writeStoredFile(dir, 'chat-media', id, 'text/plain', bytes('overwrite'))).rejects.toThrow();
  for (const malicious of ['../secret', '%2e%2e%2fsecret', '..\\secret', '/absolute']) {
    await expect(readStoredFile(dir, 'chat-media', malicious)).rejects.toThrow();
  }
  await expect(writeStoredFile(dir, 'avatars', '10000000-0000-4000-8000-000000000002', 'text/html', bytes('<script>'))).rejects.toThrow();
  const badId = '10000000-0000-4000-8000-000000000003';
  await expect(writeStoredFile(dir, 'chat-media', badId, 'text/plain', bytes('too large'), 2)).rejects.toThrow(/large/i);
  expect(await readdir(join(dir, 'chat-media'))).toEqual([id]);
  await removeStoredFile(dir, 'chat-media', id);
  expect(await readdir(join(dir, 'chat-media'))).toEqual([]);
});
it('rejects a bucket directory linked outside the storage root', async () => {
  const dir = await root();
  const outside = await root();
  await mkdir(join(outside, 'target'));
  await symlink(join(outside, 'target'), join(dir, 'chat-media'), 'junction');
  await expect(writeStoredFile(dir, 'chat-media', id, 'text/plain', bytes('escape'))).rejects.toThrow(/link|path/i);
  expect(await readdir(join(outside, 'target'))).toEqual([]);
});
