import { describe, expect, it } from 'vitest';

import { validatePartnerInvite, validatePartnerSignup } from './validation';

describe('validatePartnerInvite', () => {
  it('accepts and normalises a valid invite', () => {
    const r = validatePartnerInvite({
      companyName: '  ABC Company ',
      email: ' John@Example.COM ',
      phone: '+91 98765-43210',
    });
    expect(r).toEqual({
      ok: true,
      value: { companyName: 'ABC Company', email: 'john@example.com', phone: '+919876543210' },
    });
  });

  it('flags every missing field', () => {
    const r = validatePartnerInvite({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({ companyName: 'required', email: 'required', phone: 'required' });
    }
  });

  it.each(['john@example', 'john example.com', 'john@@example.com'])(
    'rejects malformed email %s',
    (email) => {
      const r = validatePartnerInvite({ companyName: 'A', email, phone: '+14155550123' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.email).toBe('invalidEmail');
    },
  );

  it.each(['4155550123', '+12', '+1415abc0123'])('rejects phone %s', (phone) => {
    const r = validatePartnerInvite({ companyName: 'A', email: 'a@b.co', phone });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phone).toBe('invalidPhone');
  });

  it('ignores owner / role fields entirely', () => {
    const r = validatePartnerInvite({
      companyName: 'A',
      email: 'a@b.co',
      phone: '+14155550123',
      parent_user_id: 'attacker',
      role: 'User',
    });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['companyName', 'email', 'phone']);
  });
});

describe('validatePartnerSignup', () => {
  const base = { firstName: 'John', lastName: 'Doe', password: 'correct-horse', confirmPassword: 'correct-horse' };

  it('accepts a valid signup', () => {
    expect(validatePartnerSignup(base).ok).toBe(true);
  });

  it('requires at least 8 password characters', () => {
    const r = validatePartnerSignup({ ...base, password: 'short', confirmPassword: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.password).toBe('tooShort');
  });

  it('requires matching confirmation', () => {
    const r = validatePartnerSignup({ ...base, confirmPassword: 'different-pass' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.confirmPassword).toBe('mismatch');
  });

  it('requires first and last name', () => {
    const r = validatePartnerSignup({ ...base, firstName: ' ', lastName: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ firstName: 'required', lastName: 'required' });
  });
});
