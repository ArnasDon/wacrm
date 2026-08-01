import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractGoogleDriveFileId, fetchGoogleDriveFileText } from './google-drive-file';
import { buildZip } from './test-support/build-zip';

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(body: string | Buffer, contentType: string) {
  const bodyInit = typeof body === 'string' ? body : new Uint8Array(body);
  return new Response(bodyInit, { status: 200, headers: { 'Content-Type': contentType } });
}

describe('extractGoogleDriveFileId', () => {
  it('extracts the id from a /file/d/ share link', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/file/d/abc123/view?usp=sharing')).toBe(
      'abc123',
    );
  });

  it('extracts the id from a ?id= download link', () => {
    expect(extractGoogleDriveFileId('https://drive.google.com/uc?export=download&id=xyz789')).toBe(
      'xyz789',
    );
  });

  it('returns null for an unrelated URL', () => {
    expect(extractGoogleDriveFileId('https://example.com/whatever')).toBeNull();
  });
});

describe('fetchGoogleDriveFileText', () => {
  it('returns plain text as-is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('hola', 'text/plain')));
    expect(await fetchGoogleDriveFileText('abc')).toBe('hola');
  });

  it('extracts a .docx by content-type', async () => {
    const docXml = '<w:document><w:body><w:p><w:r><w:t>Texto</w:t></w:r></w:p></w:body></w:document>';
    const zip = buildZip([{ name: 'word/document.xml', data: docXml, method: 0 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ),
    );
    expect(await fetchGoogleDriveFileText('abc')).toBe('Texto');
  });

  it('treats an HTML interstitial as "too large to auto-download"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('<html>confirm</html>', 'text/html')));
    await expect(fetchGoogleDriveFileText('abc')).rejects.toThrow(/demasiado grande/);
  });

  it('rejects an unsupported content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(Buffer.from('%PDF'), 'application/pdf')));
    await expect(fetchGoogleDriveFileText('abc')).rejects.toThrow(/no soportado/);
  });

  it('surfaces a clear error when the file is not public', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await expect(fetchGoogleDriveFileText('abc')).rejects.toThrow(/no es público/);
  });
});
