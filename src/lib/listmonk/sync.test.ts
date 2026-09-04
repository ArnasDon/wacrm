import { describe, expect, it } from 'vitest';
import {
  accountListTag,
  isSyncableEmail,
  mergeListIds,
  toSubscriberPayload,
  type SyncableContact,
} from './sync';
import type { ListmonkSubscriber } from './types';

const contact: SyncableContact = {
  id: 'c-1',
  name: 'Jane Doe',
  email: 'Jane@Example.COM',
  phone: '+14155550123',
  company: 'Acme',
};

describe('isSyncableEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isSyncableEmail('jane@example.com')).toBe(true);
  });

  it('rejects empty and missing values', () => {
    expect(isSyncableEmail(null)).toBe(false);
    expect(isSyncableEmail(undefined)).toBe(false);
    expect(isSyncableEmail('   ')).toBe(false);
  });

  it('rejects addresses without a dotted domain', () => {
    expect(isSyncableEmail('jane@localhost')).toBe(false);
    expect(isSyncableEmail('not-an-email')).toBe(false);
  });

  // The value is interpolated into listmonk's raw-SQL `query`
  // parameter, so these are the characters that would let a contact
  // row break out of the string literal. This is the gate that makes
  // findSubscriberByEmail safe.
  it('rejects quote and escape characters used for SQL injection', () => {
    expect(isSyncableEmail("a'--@example.com")).toBe(false);
    expect(isSyncableEmail("x' OR '1'='1@example.com")).toBe(false);
    expect(isSyncableEmail('a"b@example.com')).toBe(false);
    expect(isSyncableEmail('a;drop@example.com')).toBe(false);
    expect(isSyncableEmail('a\\b@example.com')).toBe(false);
  });

  it('rejects absurdly long values', () => {
    expect(isSyncableEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('toSubscriberPayload', () => {
  it('lowercases the email so lookups match on the round trip', () => {
    const p = toSubscriberPayload(contact, 'acct-1', [3]);
    expect(p.email).toBe('jane@example.com');
  });

  it('carries the CRM join keys in attribs', () => {
    const p = toSubscriberPayload(contact, 'acct-1', [3]);
    expect(p.attribs).toMatchObject({
      source: 'wacrm',
      wacrm_contact_id: 'c-1',
      wacrm_account_id: 'acct-1',
      phone: '+14155550123',
      company: 'Acme',
    });
  });

  it('falls back to the phone number when the contact has no name', () => {
    const p = toSubscriberPayload({ ...contact, name: null }, 'acct-1', [3]);
    expect(p.name).toBe('+14155550123');
  });

  it('omits company when absent rather than writing null', () => {
    const p = toSubscriberPayload({ ...contact, company: null }, 'acct-1', [3]);
    expect(p.attribs).not.toHaveProperty('company');
  });

  it('assigns the requested lists', () => {
    expect(toSubscriberPayload(contact, 'acct-1', [1, 2]).lists).toEqual([
      1, 2,
    ]);
  });
});

describe('mergeListIds', () => {
  const sub = (lists: ListmonkSubscriber['lists']): ListmonkSubscriber =>
    ({ lists }) as ListmonkSubscriber;

  it('keeps existing subscriptions when adding a new list', () => {
    const existing = sub([
      { id: 1, subscription_status: 'confirmed' },
      { id: 2, subscription_status: 'unconfirmed' },
    ]);
    expect(mergeListIds(existing, [3]).sort()).toEqual([1, 2, 3]);
  });

  // A CRM sync silently re-subscribing someone who opted out is both
  // a trust failure and, in most jurisdictions, illegal.
  it('never re-adds a list the subscriber unsubscribed from', () => {
    const existing = sub([
      { id: 1, subscription_status: 'unsubscribed' },
      { id: 2, subscription_status: 'confirmed' },
    ]);
    expect(mergeListIds(existing, [5])).toEqual([2, 5]);
  });

  it('deduplicates when the target list is already subscribed', () => {
    const existing = sub([{ id: 7, subscription_status: 'confirmed' }]);
    expect(mergeListIds(existing, [7])).toEqual([7]);
  });

  it('handles a brand-new subscriber', () => {
    expect(mergeListIds(null, [4])).toEqual([4]);
  });
});

describe('accountListTag', () => {
  it('namespaces the tag so it cannot collide with a user tag', () => {
    expect(accountListTag('abc-123')).toBe('wacrm:abc-123');
  });
});
