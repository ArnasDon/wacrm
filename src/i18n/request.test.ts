import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Real defect found while auditing ESLint warnings: the original
// catch block here silently discarded `error` (the exact warning
// being fixed), and once it was logged for the first time, the log
// revealed that this project's OWN production config
// (NEXT_PUBLIC_APP_LOCALE=es-DO) was hitting it on every single
// request with no NEXT_LOCALE cookie override — `messages/` only
// ships base-language files (`es.json`, never `es-DO.json`), so the
// app was silently rendering in English instead of Spanish. This
// suite pins the fix: a regional variant falls back to its base
// language BEFORE giving up to English.
// ============================================================

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
// getRequestConfig just needs to hand back the callback unchanged for
// this test — next-intl's own runtime wiring is not under test here.
vi.mock('next-intl/server', () => ({
  getRequestConfig: (cb: () => unknown) => cb,
}));

async function noCookie() {
  return { get: () => undefined };
}

describe('i18n request config — locale resolution and fallback', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APP_LOCALE;

  beforeEach(() => {
    mocks.cookies.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_LOCALE = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('a regional variant with no exact dictionary (es-DO) falls back to its base language (es), not straight to English', async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = 'es-DO';
    mocks.cookies.mockResolvedValue(await noCookie());
    const { default: getConfig } = await import('./request');

    const config = await (getConfig as () => Promise<{ locale: string; messages: unknown }>)();

    // Resolved to the base-language dictionary, not English — and the
    // returned `locale` reflects that real fallback (es), never the
    // unresolvable es-DO.
    expect(config.locale).toBe('es');
    expect(config.messages).toBeTruthy();
    expect((config.messages as Record<string, unknown>).Settings).toBeTruthy();
  });

  it('a locale with NO dictionary at any level (base or regional) falls all the way back to English, exactly as before', async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = 'xx-YY';
    mocks.cookies.mockResolvedValue(await noCookie());
    const { default: getConfig } = await import('./request');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = await (getConfig as () => Promise<{ locale: string; messages: unknown }>)();

    expect(config.locale).toBe('xx-YY'); // unchanged — the failure is logged, not silently renamed
    expect(config.messages).toBeTruthy();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('xx-YY'),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('an exact, real locale (es) resolves directly — the fallback chain never even runs', async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = 'es';
    mocks.cookies.mockResolvedValue(await noCookie());
    const { default: getConfig } = await import('./request');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = await (getConfig as () => Promise<{ locale: string; messages: unknown }>)();

    expect(config.locale).toBe('es');
    expect(consoleSpy).not.toHaveBeenCalled(); // no fallback needed, no error logged
    consoleSpy.mockRestore();
  });

  it('a NEXT_LOCALE cookie always wins over NEXT_PUBLIC_APP_LOCALE', async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = 'es-DO';
    mocks.cookies.mockResolvedValue({ get: (name: string) => (name === 'NEXT_LOCALE' ? { value: 'en' } : undefined) });
    const { default: getConfig } = await import('./request');

    const config = await (getConfig as () => Promise<{ locale: string; messages: unknown }>)();
    expect(config.locale).toBe('en');
  });
});
