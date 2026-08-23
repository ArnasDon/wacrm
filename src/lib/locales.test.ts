import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  isLocale,
  matchAcceptLanguage,
  resolveLocale,
} from './locales';

// The whole point of this module is that a Spanish-speaking browser
// lands on Spanish and everyone else lands on English, without anyone
// touching a setting. That behaviour is invisible in the UI until it
// is wrong, so it is pinned here.

describe('isLocale', () => {
  it('accepts supported ids and rejects everything else', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    // ko.json exists in the repo but is not offered, so it must not
    // resolve — otherwise a stale cookie would strand a user there.
    expect(isLocale('ko')).toBe(false);
    expect(isLocale('es-MX')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('matchAcceptLanguage', () => {
  it('matches a bare language tag', () => {
    expect(matchAcceptLanguage('es')).toBe('es');
    expect(matchAcceptLanguage('en')).toBe('en');
  });

  it('matches regional variants on their language subtag', () => {
    expect(matchAcceptLanguage('es-MX')).toBe('es');
    expect(matchAcceptLanguage('es-419')).toBe('es');
    expect(matchAcceptLanguage('ES-ES')).toBe('es');
  });

  it('honours quality weights over header order', () => {
    expect(matchAcceptLanguage('en;q=0.4,es;q=0.9')).toBe('es');
    expect(matchAcceptLanguage('es;q=0.3,en;q=0.8')).toBe('en');
  });

  it('keeps header order when weights tie', () => {
    expect(matchAcceptLanguage('es,en')).toBe('es');
    expect(matchAcceptLanguage('en,es')).toBe('en');
  });

  it('skips unsupported languages rather than giving up', () => {
    expect(matchAcceptLanguage('ko,ja;q=0.8,es;q=0.5')).toBe('es');
  });

  it('ignores entries the client marked unacceptable', () => {
    expect(matchAcceptLanguage('es;q=0,en')).toBe('en');
  });

  it('returns null when nothing supported is requested', () => {
    expect(matchAcceptLanguage('ko,ja')).toBeNull();
    expect(matchAcceptLanguage('')).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
    expect(matchAcceptLanguage(undefined)).toBeNull();
  });

  it('treats a wildcard as no signal', () => {
    // "*" means any language is fine — that is not a request for
    // English, so the caller's fallback should decide.
    expect(matchAcceptLanguage('*')).toBeNull();
  });

  it('does not let a malformed weight win', () => {
    // A NaN quality must sort last, not first.
    expect(matchAcceptLanguage('es;q=high,en;q=0.5')).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('prefers an explicit cookie over the browser header', () => {
    expect(resolveLocale('en', 'es-MX,es;q=0.9')).toBe('en');
    expect(resolveLocale('es', 'en-US,en;q=0.9')).toBe('es');
  });

  it('falls back to the header when the cookie is absent or junk', () => {
    expect(resolveLocale(null, 'es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(resolveLocale('klingon', 'es')).toBe('es');
    expect(resolveLocale('ko', 'es')).toBe('es');
  });

  it('defaults to English for any other browser language', () => {
    expect(resolveLocale(null, 'ko-KR,ko;q=0.9')).toBe('en');
    expect(resolveLocale(null, null)).toBe(DEFAULT_LOCALE);
  });

  it('uses the deployment fallback only when nothing else matches', () => {
    expect(resolveLocale(null, 'ko-KR', 'es')).toBe('es');
    expect(resolveLocale(null, 'en-GB', 'es')).toBe('en');
    expect(resolveLocale('en', 'ko-KR', 'es')).toBe('en');
  });
});
