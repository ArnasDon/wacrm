import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendAuthEmail } from './email';

describe('authentication mail', () => {
  it('captures development reset mail in a private local file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'crm-mail-'));
    try {
      await sendAuthEmail(
        'owner@example.test',
        'http://localhost:3000/reset-password?token=private',
        { directory, production: false }
      );
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      const content = await readFile(join(directory, files[0]), 'utf8');
      expect(content).toContain('owner@example.test');
      expect(content).toContain('token=private');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to silently capture password-reset mail in production', async () => {
    await expect(
      sendAuthEmail('owner@example.test', 'https://crm.example/reset', {
        production: true,
        smtpURL: '',
      })
    ).rejects.toThrow(/SMTP_URL/);
  });
});
