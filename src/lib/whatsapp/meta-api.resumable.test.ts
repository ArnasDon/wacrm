import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadResumableMedia } from './meta-api';

// Capture the two requests the resumable upload makes.
const calls: Array<{ url: string; init?: RequestInit }> = [];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('uploadResumableMedia', () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a session then uploads the bytes and returns the handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('/uploads?')) {
          return jsonResponse({ id: 'upload:SESSION123' });
        }
        return jsonResponse({ h: '2:HANDLE' });
      })
    );

    const { handle } = await uploadResumableMedia({
      appId: 'app-1',
      accessToken: 'tok',
      fileName: 'header.jpg',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(handle).toBe('2:HANDLE');
    expect(calls).toHaveLength(2);

    // Step 1: app-scoped session with file metadata + access_token query.
    expect(calls[0].url).toContain('/app-1/uploads?');
    expect(calls[0].url).toContain('file_length=4');
    expect(calls[0].url).toContain('file_type=image%2Fjpeg');
    expect(calls[0].url).toContain('access_token=tok');

    // Step 2: posts to the returned session id with OAuth + file_offset.
    expect(calls[1].url).toContain('/upload:SESSION123');
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('OAuth tok');
    expect(headers.file_offset).toBe('0');
  });

  it('throws if the session response has no id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}))
    );
    await expect(
      uploadResumableMedia({
        appId: 'a',
        accessToken: 't',
        fileName: 'h.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([0]),
      })
    ).rejects.toThrow(/session id/);
  });

  it('throws if the upload response has no handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/uploads?')
          ? jsonResponse({ id: 'upload:S' })
          : jsonResponse({})
      )
    );
    await expect(
      uploadResumableMedia({
        appId: 'a',
        accessToken: 't',
        fileName: 'h.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([0]),
      })
    ).rejects.toThrow(/file handle/);
  });
});
