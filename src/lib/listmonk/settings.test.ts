import { describe, expect, it } from 'vitest';
import {
  isMaskedSecret,
  mergeSmtpSettings,
  toEmailSettings,
  unmaskPassword,
  type EmailSettings,
} from './settings';

const MASK = '••••••••';

describe('isMaskedSecret', () => {
  it('recognises the bullet mask listmonk returns for stored secrets', () => {
    expect(isMaskedSecret(MASK)).toBe(true);
    expect(isMaskedSecret('•')).toBe(true);
  });

  it('does not treat a real password as a mask', () => {
    expect(isMaskedSecret('hunter2')).toBe(false);
    expect(isMaskedSecret('pass•word')).toBe(false);
    expect(isMaskedSecret('')).toBe(false);
  });
});

describe('unmaskPassword', () => {
  // Writing the mask back would set the literal password to
  // "••••••••" — sending would break silently while the save looked
  // successful. Empty is listmonk's "keep the stored one".
  it('turns the mask into empty so listmonk keeps the stored secret', () => {
    expect(unmaskPassword(MASK)).toBe('');
  });

  it('passes a genuinely new password through untouched', () => {
    expect(unmaskPassword('new-secret')).toBe('new-secret');
  });
});

describe('mergeSmtpSettings', () => {
  const edits: EmailSettings = {
    fromEmail: '  Acme <hi@acme.com>  ',
    siteName: 'Acme',
    rootUrl: 'https://crm.acme.com',
    smtp: {
      enabled: true,
      host: '  smtp.acme.com  ',
      port: 587,
      auth_protocol: 'plain',
      username: ' user ',
      password: MASK,
      tls_type: 'STARTTLS',
      tls_skip_verify: false,
    },
  };

  // listmonk's PUT replaces the WHOLE settings document, so anything
  // we fail to carry forward is reset to empty.
  it('preserves settings this UI does not expose', () => {
    const current = {
      'app.lang': 'en',
      'upload.provider': 's3',
      'bounce.enabled': true,
      smtp: [],
    };
    const out = mergeSmtpSettings(current, edits);
    expect(out['app.lang']).toBe('en');
    expect(out['upload.provider']).toBe('s3');
    expect(out['bounce.enabled']).toBe(true);
  });

  it('writes an empty password when the form still shows the mask', () => {
    const out = mergeSmtpSettings(
      { smtp: [{ uuid: 'u1', password: 'stored' }] },
      edits
    );
    expect((out.smtp as Array<{ password: string }>)[0].password).toBe('');
  });

  it('writes a real password when the operator typed a new one', () => {
    const out = mergeSmtpSettings(
      { smtp: [] },
      { ...edits, smtp: { ...edits.smtp, password: 'brand-new' } }
    );
    expect((out.smtp as Array<{ password: string }>)[0].password).toBe(
      'brand-new'
    );
  });

  it('trims whitespace pasted in from a provider dashboard', () => {
    const out = mergeSmtpSettings({ smtp: [] }, edits);
    const s = (out.smtp as Array<{ host: string; username: string }>)[0];
    expect(s.host).toBe('smtp.acme.com');
    expect(s.username).toBe('user');
    expect(out['app.from_email']).toBe('Acme <hi@acme.com>');
  });

  it('keeps the server uuid so listmonk can match the stored password', () => {
    const out = mergeSmtpSettings(
      { smtp: [{ uuid: 'abc', password: 'x' }] },
      edits
    );
    expect((out.smtp as Array<{ uuid: string }>)[0].uuid).toBe('abc');
  });

  // An operator may have added a second relay directly in listmonk.
  it('leaves additional SMTP servers untouched', () => {
    const out = mergeSmtpSettings(
      {
        smtp: [
          { uuid: 'a', host: 'one' },
          { uuid: 'b', host: 'two' },
        ],
      },
      edits
    );
    const servers = out.smtp as Array<{ host: string }>;
    expect(servers).toHaveLength(2);
    expect(servers[1].host).toBe('two');
  });
});

describe('toEmailSettings', () => {
  it('reads the first SMTP server and sender identity', () => {
    const view = toEmailSettings({
      'app.from_email': 'a@b.com',
      'app.site_name': 'Acme',
      'app.root_url': 'https://x.com',
      smtp: [
        {
          host: 'h',
          port: 25,
          username: 'u',
          password: MASK,
          tls_type: 'TLS',
          auth_protocol: 'login',
          enabled: true,
          tls_skip_verify: true,
        },
      ],
    });
    expect(view.fromEmail).toBe('a@b.com');
    expect(view.smtp.host).toBe('h');
    expect(view.smtp.tls_type).toBe('TLS');
    expect(view.smtp.password).toBe(MASK);
  });

  it('produces usable defaults on a fresh install with no SMTP row', () => {
    const view = toEmailSettings({});
    expect(view.smtp.port).toBe(587);
    expect(view.smtp.tls_type).toBe('STARTTLS');
    expect(view.smtp.host).toBe('');
  });
});
