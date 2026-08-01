import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { fetchOneDriveText, isOneDriveUrl, runOneDriveTool } from './onedrive';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import { buildZip } from './test-support/build-zip';

function textResponse(body: string, contentType = 'text/plain', url = 'https://onedrive.live.com/download?download=1') {
  const res = new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

function bufferResponse(buf: Buffer, contentType: string, url = 'https://onedrive.live.com/download?download=1') {
  const res = new Response(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': contentType } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

function redirectResponse(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockClear();
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isOneDriveUrl', () => {
  it('accepts onedrive.live.com, 1drv.ms and *.sharepoint.com', () => {
    expect(isOneDriveUrl('https://onedrive.live.com/?id=abc')).toBe(true);
    expect(isOneDriveUrl('https://1drv.ms/x/s!abc')).toBe(true);
    expect(isOneDriveUrl('https://contoso-my.sharepoint.com/:x:/g/personal/a/b')).toBe(true);
  });

  it('rejects other hosts', () => {
    expect(isOneDriveUrl('https://drive.google.com/file/d/x')).toBe(false);
    expect(isOneDriveUrl('https://evil.com/onedrive.live.com')).toBe(false);
    expect(isOneDriveUrl('not a url')).toBe(false);
  });
});

describe('fetchOneDriveText', () => {
  it('refuses a non-OneDrive URL without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchOneDriveText('https://example.com/file.txt')).rejects.toThrow(
      /no es un link de OneDrive/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('appends download=1 and returns plain text directly', async () => {
    const fetchSpy = vi.fn(async () => textResponse('hola mundo'));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchOneDriveText('https://onedrive.live.com/?id=abc');

    expect(result).toBe('hola mundo');
    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toContain('download=1');
  });

  it('follows a redirect chain (1drv.ms -> onedrive.live.com), SSRF-checking each hop', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://onedrive.live.com/download?resid=1'))
      .mockResolvedValueOnce(textResponse('contenido final'));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchOneDriveText('https://1drv.ms/t/s!abc');

    expect(result).toBe('contenido final');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(isDeliverableUrl).toHaveBeenCalledTimes(2);
  });

  it('refuses to follow a redirect to a non-public address', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('http://169.254.169.254/latest/meta-data/'));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchOneDriveText('https://1drv.ms/t/s!abc')).rejects.toThrow(
      /no es accesible públicamente/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many redirects', async () => {
    const fetchSpy = vi.fn(async () => redirectResponse('https://onedrive.live.com/loop'));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchOneDriveText('https://onedrive.live.com/?id=abc')).rejects.toThrow(
      /demasiadas redirecciones/,
    );
  });

  it('treats an HTML response as an interstitial it cannot get past', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('<html>sign in</html>', 'text/html')));

    await expect(fetchOneDriveText('https://onedrive.live.com/?id=abc')).rejects.toThrow(
      /no se pudo descargar/,
    );
  });

  it('extracts .docx content by content-type', async () => {
    const docXml = '<w:document><w:body><w:p><w:r><w:t>Hola OneDrive</w:t></w:r></w:p></w:body></w:document>';
    const zip = buildZip([{ name: 'word/document.xml', data: docXml, method: 8 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        bufferResponse(
          zip,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ),
    );

    const result = await fetchOneDriveText('https://onedrive.live.com/?id=abc');
    expect(result).toBe('Hola OneDrive');
  });

  it('extracts .xlsx content by URL extension when content-type is generic', async () => {
    const sheet1 =
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Precio</t></is></c></row>' +
      '<row r="2"><c r="A2"><v>10</v></c></row></sheetData>';
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet1, method: 0 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        bufferResponse(zip, 'application/octet-stream', 'https://onedrive.live.com/download/list.xlsx?download=1'),
      ),
    );

    const result = await fetchOneDriveText('https://onedrive.live.com/?id=abc');
    expect(result).toBe('Fila 1: Precio: 10');
  });

  it('rejects an unsupported content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bufferResponse(Buffer.from('%PDF'), 'application/pdf')));

    await expect(fetchOneDriveText('https://onedrive.live.com/?id=abc')).rejects.toThrow(
      /tipo de archivo no soportado/,
    );
  });
});

describe('runOneDriveTool', () => {
  it('never throws — returns a readable error string on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNRESET');
    }));

    const result = await runOneDriveTool({ drive_url: 'https://onedrive.live.com/?id=abc' });
    expect(result).toMatch(/Error al consultar OneDrive/);
  });

  it('returns the extracted text on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('todo bien')));

    const result = await runOneDriveTool({ drive_url: 'https://onedrive.live.com/?id=abc' });
    expect(result).toBe('todo bien');
  });
});
