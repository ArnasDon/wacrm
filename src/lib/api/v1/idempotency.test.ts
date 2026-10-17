import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

import {
  extractIdempotencyKey,
  computeRequestHash,
  withIdempotency,
} from './idempotency';

describe('extractIdempotencyKey', () => {
  function reqWith(header: string | null): Request {
    return new Request('http://localhost/api/v1/messages', {
      method: 'POST',
      headers: header !== null ? { 'idempotency-key': header } : {},
    });
  }

  it('returns null when the header is absent', () => {
    expect(extractIdempotencyKey(reqWith(null))).toBeNull();
  });

  it('returns null for an empty/whitespace-only header (treated as absent)', () => {
    expect(extractIdempotencyKey(reqWith('   '))).toBeNull();
  });

  it('returns the trimmed key when present', () => {
    expect(extractIdempotencyKey(reqWith('  abc-123  '))).toBe('abc-123');
  });
});

describe('computeRequestHash', () => {
  it('is deterministic for the same endpoint + body', () => {
    const a = computeRequestHash('messages:send', { to: '+1', text: 'hi' });
    const b = computeRequestHash('messages:send', { to: '+1', text: 'hi' });
    expect(a).toBe(b);
  });

  it('is insensitive to key order (canonicalization)', () => {
    const a = computeRequestHash('messages:send', { to: '+1', text: 'hi' });
    const b = computeRequestHash('messages:send', { text: 'hi', to: '+1' });
    expect(a).toBe(b);
  });

  it('is insensitive to key order in nested objects too', () => {
    const a = computeRequestHash('messages:send', {
      to: '+1',
      template: { name: 'x', language: 'en' },
    });
    const b = computeRequestHash('messages:send', {
      to: '+1',
      template: { language: 'en', name: 'x' },
    });
    expect(a).toBe(b);
  });

  it('differs when the body differs', () => {
    const a = computeRequestHash('messages:send', { to: '+1', text: 'hi' });
    const b = computeRequestHash('messages:send', { to: '+1', text: 'bye' });
    expect(a).not.toBe(b);
  });

  it('differs when only the endpoint differs, same body — cross-endpoint key reuse is always a mismatch', () => {
    const a = computeRequestHash('messages:send', { to: '+1' });
    const b = computeRequestHash('broadcasts:send', { to: '+1' });
    expect(a).not.toBe(b);
  });
});

describe('withIdempotency', () => {
  function fakeSupabase(
    rpcImpl: (name: string, args: Record<string, unknown>) => unknown
  ) {
    return {
      rpc: (name: string, args: Record<string, unknown>) => ({
        single: async () => {
          const result = rpcImpl(name, args);
          return result;
        },
        then: (resolve: (v: unknown) => void) => {
          // complete_/fail_idempotent_request are called WITHOUT .single()
          Promise.resolve(rpcImpl(name, args)).then(resolve);
        },
      }),
    } as never;
  }

  function reqWithKey(key: string | null): Request {
    return new Request('http://localhost/api/v1/messages', {
      method: 'POST',
      headers: key !== null ? { 'idempotency-key': key } : {},
    });
  }

  it('no Idempotency-Key header → calls the handler directly, no RPC involved', async () => {
    const rpc = vi.fn();
    const handler = vi.fn(async () =>
      NextResponse.json({ data: 'ok' }, { status: 200 })
    );

    const res = await withIdempotency(
      reqWithKey(null),
      { rpc } as never,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("outcome 'proceed': calls the handler once and caches a successful (2xx) response", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const supabase = fakeSupabase((name, args) => {
      calls.push({ name, args });
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json({ data: { message_id: 'm1' } }, { status: 201 })
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    const complete = calls.find(
      (c) => c.name === 'complete_idempotent_request'
    );
    expect(complete).toBeTruthy();
    expect(complete!.args.p_account_id).toBe('acct-1');
    expect(complete!.args.p_idempotency_key).toBe('key-1');
    expect(complete!.args.p_response_status).toBe(201);
  });

  it("outcome 'replay': NEVER calls the handler — returns the cached response verbatim", async () => {
    const supabase = fakeSupabase((name) => {
      if (name === 'begin_idempotent_request') {
        return {
          data: {
            outcome: 'replay',
            cached_status: 201,
            cached_body: { message_id: 'original-m1' },
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json({ data: { message_id: 'a-NEW-send' } }, { status: 201 })
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(handler).not.toHaveBeenCalled(); // the actual proof no second send happens
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message_id: string };
    expect(body.message_id).toBe('original-m1');
  });

  it("outcome 'conflict': 409, handler never called", async () => {
    const supabase = fakeSupabase((name) => {
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'conflict', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json({ data: {} }, { status: 200 })
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('idempotency_key_reused');
    expect(handler).not.toHaveBeenCalled();
  });

  it("outcome 'in_progress': 409, handler never called (this is what makes two concurrent requests produce exactly one real send)", async () => {
    const supabase = fakeSupabase((name) => {
      if (name === 'begin_idempotent_request') {
        return {
          data: {
            outcome: 'in_progress',
            cached_status: null,
            cached_body: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json({ data: {} }, { status: 200 })
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('idempotency_key_in_progress');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a non-2xx handler response releases the claim (fail) instead of caching it — a retry with a fixed payload is not locked out', async () => {
    const calls: string[] = [];
    const supabase = fakeSupabase((name) => {
      calls.push(name);
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json(
        { error: { code: 'bad_request', message: 'bad phone' } },
        { status: 400 }
      )
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: 'bad' },
      handler
    );

    expect(res.status).toBe(400);
    expect(calls).toContain('fail_idempotent_request');
    expect(calls).not.toContain('complete_idempotent_request');
  });

  it('a thrown exception releases the claim (fail), then re-throws for the outer error handler', async () => {
    const calls: string[] = [];
    const supabase = fakeSupabase((name) => {
      calls.push(name);
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () => {
      throw new Error('meta is down');
    });

    await expect(
      withIdempotency(
        reqWithKey('key-1'),
        supabase,
        'acct-1',
        'messages:send',
        { to: '+1' },
        handler
      )
    ).rejects.toThrow('meta is down');
    expect(calls).toContain('fail_idempotent_request');
  });

  // ============================================================
  // Punto 10, F-P10-4 — the external-effect-already-happened case. A
  // retry under the SAME Idempotency-Key must never re-run the
  // handler (and re-send to Meta) once evidence exists that the real
  // side effect already occurred.
  // ============================================================
  it('an externalEffectOccurred exception COMPLETES (never fails) the idempotency record, and maps to the same error response a retry will replay', async () => {
    const calls: string[] = [];
    const completedArgs: Record<string, unknown>[] = [];
    const supabase = fakeSupabase((name, args) => {
      calls.push(name);
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      if (name === 'complete_idempotent_request') completedArgs.push(args);
      return { data: null, error: null };
    });
    const handler = vi.fn(async () => {
      throw Object.assign(
        new Error('Message sent to Meta but failed to save to DB: boom'),
        { code: 'db_error', status: 500, externalEffectOccurred: true }
      );
    });

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('db_error');
    expect(body.error.message).toContain('sent to Meta');
    // The actual proof this closes the duplicate-send bug: completed,
    // never failed — see the pre-existing "outcome 'replay': NEVER
    // calls the handler" test above for what a completed record does
    // on the next request with the same key.
    expect(calls).toContain('complete_idempotent_request');
    expect(calls).not.toContain('fail_idempotent_request');
    expect(completedArgs[0]?.p_response_status).toBe(500);
  });

  it('a plain thrown error that merely LOOKS similar (has code/status, but no externalEffectOccurred marker) still releases the claim exactly as before — regression guard against over-matching', async () => {
    const calls: string[] = [];
    const supabase = fakeSupabase((name) => {
      calls.push(name);
      if (name === 'begin_idempotent_request') {
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () => {
      throw Object.assign(new Error('bad phone number'), {
        code: 'bad_request',
        status: 400,
        // externalEffectOccurred intentionally omitted.
      });
    });

    await expect(
      withIdempotency(
        reqWithKey('key-1'),
        supabase,
        'acct-1',
        'messages:send',
        { to: 'bad' },
        handler
      )
    ).rejects.toThrow('bad phone number');
    expect(calls).toContain('fail_idempotent_request');
    expect(calls).not.toContain('complete_idempotent_request');
  });

  it('isolation: the account_id passed to the RPC is always the authenticated one, never mixed up across calls', async () => {
    const seenAccounts: string[] = [];
    const supabase = fakeSupabase((name, args) => {
      if (name === 'begin_idempotent_request') {
        seenAccounts.push(args.p_account_id as string);
        return {
          data: { outcome: 'proceed', cached_status: null, cached_body: null },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const handler = vi.fn(async () =>
      NextResponse.json({ data: {} }, { status: 200 })
    );

    await withIdempotency(
      reqWithKey('same-key'),
      supabase,
      'acct-a',
      'messages:send',
      { to: '+1' },
      handler
    );
    await withIdempotency(
      reqWithKey('same-key'),
      supabase,
      'acct-b',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(seenAccounts).toEqual(['acct-a', 'acct-b']);
  });

  it('an Idempotency-Key longer than 255 characters is rejected with 400, no RPC call', async () => {
    const rpc = vi.fn();
    const handler = vi.fn();

    const res = await withIdempotency(
      reqWithKey('x'.repeat(256)),
      { rpc } as never,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a begin_idempotent_request RPC error fails OPEN — the request proceeds as if no key were sent', async () => {
    const supabase = fakeSupabase(() => ({
      data: null,
      error: { message: 'db down' },
    }));
    const handler = vi.fn(async () =>
      NextResponse.json({ data: {} }, { status: 200 })
    );

    const res = await withIdempotency(
      reqWithKey('key-1'),
      supabase,
      'acct-1',
      'messages:send',
      { to: '+1' },
      handler
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
