import { describe, expect, it } from 'vitest';
import {
  DEFAULT_META_API_VERSION,
  metaApiBase,
  metaApiVersion,
} from './meta-version';

describe('metaApiVersion', () => {
  it('uses the default when the variable is unset or empty', () => {
    expect(metaApiVersion(undefined)).toBe(DEFAULT_META_API_VERSION);
    expect(metaApiVersion('')).toBe(DEFAULT_META_API_VERSION);
  });

  it('accepts a vNN.N override', () => {
    expect(metaApiVersion(' v25.0 ')).toBe('v25.0');
    expect(metaApiBase('v25.0')).toBe('https://graph.facebook.com/v25.0');
  });

  it('falls back to the default on a malformed value', () => {
    expect(metaApiVersion('25')).toBe(DEFAULT_META_API_VERSION);
    expect(metaApiVersion('v25.0/../x')).toBe(DEFAULT_META_API_VERSION);
  });
});
