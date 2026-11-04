import { describe, expect, it } from 'vitest';
import {
  clearsRejectionReason,
  normalizeStatus,
  templateStatusFromWebhookEvent,
} from './template-status-normalize';

describe('normalizeStatus', () => {
  it('passes through known Meta statuses verbatim', () => {
    expect(normalizeStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeStatus('PAUSED')).toBe('PAUSED');
    expect(normalizeStatus('IN_APPEAL')).toBe('IN_APPEAL');
  });
  it('uppercases lowercase input', () => {
    expect(normalizeStatus('approved')).toBe('APPROVED');
  });
  it('maps PENDING_REVIEW → PENDING', () => {
    expect(normalizeStatus('PENDING_REVIEW')).toBe('PENDING');
  });
  it('falls back to PENDING for unknown values (so the row is still visible)', () => {
    expect(normalizeStatus('SOMETHING_NEW')).toBe('PENDING');
    expect(normalizeStatus('')).toBe('PENDING');
  });
});

describe('templateStatusFromWebhookEvent', () => {
  it('passes through the statuses we store', () => {
    expect(templateStatusFromWebhookEvent('APPROVED')).toBe('APPROVED');
    expect(templateStatusFromWebhookEvent('paused')).toBe('PAUSED');
    expect(templateStatusFromWebhookEvent('PENDING_REVIEW')).toBe('PENDING');
  });
  it('maps lifecycle events onto existing statuses', () => {
    expect(templateStatusFromWebhookEvent('REINSTATED')).toBe('APPROVED');
    expect(templateStatusFromWebhookEvent('DELETED')).toBe('PENDING_DELETION');
  });
  it('returns null for events that are not a status change', () => {
    for (const event of ['FLAGGED', 'LIMIT_EXCEEDED', 'LOCKED', 'ARCHIVED', 'NEW_THING', '']) {
      expect(templateStatusFromWebhookEvent(event)).toBeNull();
    }
  });
});

describe('clearsRejectionReason', () => {
  it('only clears on approval or resubmission', () => {
    expect(clearsRejectionReason('APPROVED')).toBe(true);
    expect(clearsRejectionReason('PENDING')).toBe(true);
    expect(clearsRejectionReason('PAUSED')).toBe(false);
    expect(clearsRejectionReason('REJECTED')).toBe(false);
  });
});
