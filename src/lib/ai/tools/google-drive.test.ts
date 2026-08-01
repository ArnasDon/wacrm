import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidGoogleDriveUrl, runGoogleDriveTool } from './google-drive';

afterEach(() => {
  vi.unstubAllGlobals();
});

function textResponse(body: string, contentType = 'text/plain') {
  return new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
}

describe('isValidGoogleDriveUrl', () => {
  it('accepts Sheets, Docs, Slides and Drive file links', () => {
    expect(isValidGoogleDriveUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(true);
    expect(isValidGoogleDriveUrl('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(isValidGoogleDriveUrl('https://docs.google.com/presentation/d/abc/edit')).toBe(true);
    expect(isValidGoogleDriveUrl('https://drive.google.com/file/d/abc/view')).toBe(true);
  });

  it('rejects a non-Google host even if it looks like a Drive path', () => {
    expect(isValidGoogleDriveUrl('https://evil.com/spreadsheets/d/abc')).toBe(false);
  });

  it('rejects a Google URL that matches none of the known patterns', () => {
    expect(isValidGoogleDriveUrl('https://docs.google.com/forms/d/abc')).toBe(false);
  });
});

describe('runGoogleDriveTool', () => {
  it('routes a Sheets URL through the CSV export', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('name,price\nCafé,1500')));
    const result = await runGoogleDriveTool({
      drive_url: 'https://docs.google.com/spreadsheets/d/abc123/edit',
    });
    expect(result).toBe('Fila 1: name: Café, price: 1500');
  });

  it('routes a Docs URL through the text export', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('contenido del documento')));
    const result = await runGoogleDriveTool({
      drive_url: 'https://docs.google.com/document/d/abc123/edit',
    });
    expect(result).toBe('contenido del documento');
  });

  it('routes a Slides URL through the text export', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('contenido de la presentación')));
    const result = await runGoogleDriveTool({
      drive_url: 'https://docs.google.com/presentation/d/abc123/edit',
    });
    expect(result).toBe('contenido de la presentación');
  });

  it('routes a Drive file URL through the generic file fetcher', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('archivo de texto')));
    const result = await runGoogleDriveTool({
      drive_url: 'https://drive.google.com/file/d/abc123/view',
    });
    expect(result).toBe('archivo de texto');
  });

  it('never throws — returns a readable error for a non-Google URL', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runGoogleDriveTool({ drive_url: 'https://example.com/file' });
    expect(result).toMatch(/no es un link de Google/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws — returns a readable error when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await runGoogleDriveTool({
      drive_url: 'https://docs.google.com/document/d/abc123/edit',
    });
    expect(result).toMatch(/Error al consultar Google Drive/);
  });
});
