import { describe, expect, it } from 'vitest';
import { readResponseJson } from './response-json';

describe('readResponseJson', () => {
  it('parses valid JSON regardless of the HTTP status', async () => {
    const response = Response.json({ error: 'No autorizado' }, { status: 401 });

    await expect(
      readResponseJson<{ error: string }>(response)
    ).resolves.toEqual({
      error: 'No autorizado',
    });
  });

  it('reports HTML responses without exposing a JSON syntax error', async () => {
    const response = new Response('<!DOCTYPE html><title>Error</title>', {
      status: 502,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    await expect(readResponseJson(response)).rejects.toThrow(
      'text/html; charset=utf-8 instead of JSON (502)'
    );
  });

  it('reports malformed and empty JSON responses clearly', async () => {
    const malformed = new Response('{broken', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const empty = new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' },
    });

    await expect(readResponseJson(malformed)).rejects.toThrow('invalid JSON');
    await expect(readResponseJson(empty)).rejects.toThrow('empty response');
  });
});
