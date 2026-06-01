import { describe, expect, it } from 'vitest';
import { normalizeStatus } from './template-status-normalize';

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
