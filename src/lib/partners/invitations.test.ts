import { describe, expect, it } from 'vitest';

import {
  effectiveInvitationStatus,
  generatePartnerToken,
  hashPartnerToken,
  looksLikePartnerToken,
  partnerInvitationExpiresAt,
  partnerInvitationExpiryHours,
  partnerResendLimit,
  partnerSignupUrl,
} from './invitations';
import { buildPartnerInvitationEmail, PARTNER_INVITATION_SUBJECT } from './email';

describe('partner invitation tokens', () => {
  it('generates unique, URL-safe, 256-bit tokens stored only as a hash', () => {
    const a = generatePartnerToken();
    const b = generatePartnerToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(hashPartnerToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
    expect(looksLikePartnerToken(a.token)).toBe(true);
  });

  it('rejects implausible tokens before hashing', () => {
    expect(looksLikePartnerToken('')).toBe(false);
    expect(looksLikePartnerToken('short')).toBe(false);
    expect(looksLikePartnerToken("x'; drop table users; --".padEnd(40, 'x'))).toBe(false);
    expect(looksLikePartnerToken(null)).toBe(false);
  });
});

describe('partner invitation config', () => {
  it('defaults to 72 hours and honours / clamps the env var', () => {
    expect(partnerInvitationExpiryHours({})).toBe(72);
    expect(partnerInvitationExpiryHours({ PARTNER_INVITATION_EXPIRY_HOURS: '24' })).toBe(24);
    expect(partnerInvitationExpiryHours({ PARTNER_INVITATION_EXPIRY_HOURS: 'nope' })).toBe(72);
    expect(partnerInvitationExpiryHours({ PARTNER_INVITATION_EXPIRY_HOURS: '-5' })).toBe(72);
    expect(partnerInvitationExpiryHours({ PARTNER_INVITATION_EXPIRY_HOURS: '99999' })).toBe(720);
  });

  it('defaults to 3 resends per hour', () => {
    expect(partnerResendLimit({})).toBe(3);
    expect(partnerResendLimit({ PARTNER_INVITATION_RESEND_LIMIT: '5' })).toBe(5);
  });

  it('computes expires_at from hours', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(partnerInvitationExpiresAt(72, now).toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });

  it('builds the signup URL with the token in the query string', () => {
    expect(partnerSignupUrl('abc_-123', 'https://crm.example.com/')).toBe(
      'https://crm.example.com/partner/signup?token=abc_-123',
    );
  });

  it('reports a lapsed PENDING invitation as EXPIRED', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(effectiveInvitationStatus('PENDING', '2026-01-01T00:00:00Z', now)).toBe('EXPIRED');
    expect(effectiveInvitationStatus('PENDING', '2026-01-03T00:00:00Z', now)).toBe('PENDING');
    expect(effectiveInvitationStatus('ACCEPTED', '2026-01-01T00:00:00Z', now)).toBe('ACCEPTED');
  });
});

describe('buildPartnerInvitationEmail', () => {
  it('uses the required subject and includes company, inviter, link and expiry', () => {
    const msg = buildPartnerInvitationEmail({
      to: 'john@example.com',
      companyName: 'ABC Company',
      inviterName: 'Jane Main',
      inviterEmail: 'jane@example.com',
      signupUrl: 'https://crm.example.com/partner/signup?token=t0k',
      expiryHours: 72,
    });
    expect(msg.subject).toBe(PARTNER_INVITATION_SUBJECT);
    expect(msg.subject).toBe("You've been invited to join WSCRM");
    for (const body of [msg.text, msg.html]) {
      expect(body).toContain('ABC Company');
      expect(body).toContain('Jane Main');
      expect(body).toContain('Complete Signup');
      expect(body).toContain('72 hours');
      expect(body).toContain('safely ignore');
    }
    expect(msg.html).toContain('href="https://crm.example.com/partner/signup?token=t0k"');
  });

  it('escapes user-controlled values in the HTML body', () => {
    const msg = buildPartnerInvitationEmail({
      to: 'x@example.com',
      companyName: '<script>alert(1)</script>',
      inviterName: '"><img src=x>',
      inviterEmail: 'a@b.co',
      signupUrl: 'https://crm.example.com/partner/signup?token=t',
      expiryHours: 72,
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<img src=x>');
    expect(msg.html).toContain('&lt;script&gt;');
  });
});
