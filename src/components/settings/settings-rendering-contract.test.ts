import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getConnectionCopyKeys, isZapiConfigActive } from './whatsapp-config';

async function readSource(relativePath: string) {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('settings rendering contracts', () => {
  it('renders the account-scoped role with Settings.roles', async () => {
    const source = await readSource('src/components/settings/profile-form.tsx');

    expect(source).toContain("useTranslations('Settings.roles')");
    expect(source).toMatch(/\baccountRole\b/);
    expect(source).not.toMatch(/profile\?\.role/);
  });

  it('keeps Z-API status copy separate from Meta credentials', async () => {
    const source = await readSource(
      'src/components/settings/whatsapp-config.tsx'
    );

    expect(
      isZapiConfigActive({
        zapi_instance_id: 'instance-1',
        zapi_instance_token: null,
        zapi_client_token: null,
      })
    ).toBe(true);
    expect(getConnectionCopyKeys(true, 'connected')).toEqual({
      title: 'zapiConnected',
      description: 'zapiConnectedDesc',
    });
    expect(getConnectionCopyKeys(true, 'connected').title).not.toBe(
      'credentialsValid'
    );
    expect(getConnectionCopyKeys(false, 'connected').title).toBe(
      'credentialsValid'
    );
    expect(source).toContain("t('zapiActiveTitle')");
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('uses valid contact detail translation keys without fallback options', async () => {
    const source = await readSource(
      'src/components/contacts/contact-detail-view.tsx'
    );

    expect(source).toContain("t('name')");
    expect(source).toContain("t('tabs.tags')");
    expect(source).not.toMatch(/\{\s*fallback:/);
  });
});
