import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/messages — route-level test (never had one before).
// Focused on the API-N1 idempotency wiring introduced by this fix —
// the underlying send pipeline itself (resolveConversationByPhone,
// sendMessageToConversation) is already covered by
// src/lib/whatsapp/send-message.test.ts and is mocked here so these
// tests isolate exactly the new behavior.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/auth/api-context')>();
  return {
    ...actual,
    requireApiKey: mocks.requireApiKey,
    withApiKey: async (
      request: Request,
      scope: string | undefined,
      handler: (ctx: unknown) => Promise<Response>
    ) => {
      const { toApiErrorResponse } = await import('@/lib/api/v1/respond');
      try {
        const ctx = await mocks.requireApiKey(request, scope);
        return await handler(ctx);
      } catch (err) {
        return toApiErrorResponse(err);
      }
    },
  };
});

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/send-message')>();
  return {
    ...actual,
    sendMessageToConversation: mocks.sendMessageToConversation,
  };
});

import { POST } from './route';
import { unauthorized } from '@/lib/api/v1/respond';
import { SendMessageError } from '@/lib/whatsapp/send-message';

/** Fake `.rpc()` surface for the idempotency RPCs — mirrors the one in
 *  idempotency.test.ts. `calls` records every RPC invocation so a test
 *  can assert exactly what was cached/released. */
function fakeIdempotencySupabase(beginOutcome: {
  outcome: string;
  cached_status?: number | null;
  cached_body?: unknown;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const result =
          name === 'begin_idempotent_request'
            ? { data: beginOutcome, error: null }
            : { data: null, error: null };
        return {
          single: async () => result,
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(result).then(resolve),
        };
      },
    } as never,
    calls,
  };
}

function postRequest(body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return new Request('http://localhost/api/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireApiKey.mockReset();
  mocks.resolveConversationByPhone.mockReset();
  mocks.sendMessageToConversation.mockReset();
});

describe('POST /api/v1/messages', () => {
  it('unauthenticated → 401, send pipeline never runs', async () => {
    mocks.requireApiKey.mockRejectedValue(unauthorized());
    const res = await POST(postRequest({ to: '+15550001111', text: 'hi' }));
    expect(res.status).toBe(401);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('sends normally when no Idempotency-Key header is present (unchanged behavior)', async () => {
    const { supabase } = fakeIdempotencySupabase({ outcome: 'proceed' });
    mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    mocks.sendMessageToConversation.mockResolvedValue({
      messageId: 'msg-1',
      whatsappMessageId: 'wamid-1',
    });

    const res = await POST(postRequest({ to: '+15550001111', text: 'hi' }));
    const body = (await res.json()) as { data: { message_id: string } };

    expect(res.status).toBe(201);
    expect(body.data.message_id).toBe('msg-1');
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });

  describe('with Idempotency-Key', () => {
    it("first request (outcome 'proceed'): sends for real and caches the response", async () => {
      const { supabase, calls } = fakeIdempotencySupabase({
        outcome: 'proceed',
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
      mocks.resolveConversationByPhone.mockResolvedValue({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: true,
      });
      mocks.sendMessageToConversation.mockResolvedValue({
        messageId: 'msg-1',
        whatsappMessageId: 'wamid-1',
      });

      const res = await POST(
        postRequest({ to: '+15550001111', text: 'hi' }, 'key-abc')
      );

      expect(res.status).toBe(201);
      expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
      expect(calls.some((c) => c.name === 'complete_idempotent_request')).toBe(
        true
      );
    });

    it("repeated identical request (outcome 'replay'): does NOT send again, returns the original response", async () => {
      const { supabase } = fakeIdempotencySupabase({
        outcome: 'replay',
        cached_status: 201,
        cached_body: {
          data: { message_id: 'original-msg', conversation_id: 'conv-1' },
        },
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest({ to: '+15550001111', text: 'hi' }, 'key-abc')
      );
      const body = (await res.json()) as { data: { message_id: string } };

      expect(res.status).toBe(201);
      expect(body.data.message_id).toBe('original-msg');
      expect(mocks.sendMessageToConversation).not.toHaveBeenCalled(); // the actual duplicate-send proof
      expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    });

    it("same key, different payload (outcome 'conflict'): 409, no send attempted", async () => {
      const { supabase } = fakeIdempotencySupabase({ outcome: 'conflict' });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest(
          { to: '+15550009999', text: 'different message' },
          'key-abc'
        )
      );
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('idempotency_key_reused');
      expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
    });

    it("concurrent request (outcome 'in_progress'): 409, no send attempted — exactly one real send across the race", async () => {
      const { supabase } = fakeIdempotencySupabase({ outcome: 'in_progress' });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(
        postRequest({ to: '+15550001111', text: 'hi' }, 'key-abc')
      );
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(409);
      expect(body.error.code).toBe('idempotency_key_in_progress');
      expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
    });

    it('a validation failure (bad phone) releases the claim instead of caching a 400 forever', async () => {
      const { supabase, calls } = fakeIdempotencySupabase({
        outcome: 'proceed',
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });

      const res = await POST(postRequest({ to: '', text: 'hi' }, 'key-abc'));

      expect(res.status).toBe(400);
      expect(calls.some((c) => c.name === 'fail_idempotent_request')).toBe(
        true
      );
      expect(calls.some((c) => c.name === 'complete_idempotent_request')).toBe(
        false
      );
    });

    // ============================================================
    // Punto 10, F-P10-4 — Meta already accepted the send (a real
    // SendMessageError with externalEffectOccurred:true) before the
    // local persistence failed. The route must let this propagate
    // UNCAUGHT to withIdempotency() rather than mapping it to a
    // response itself — that's what lets the idempotency layer
    // COMPLETE (not fail) the claim, so a retry with the same key can
    // never send this message to Meta a second time.
    // ============================================================
    it('a SendMessageError with externalEffectOccurred COMPLETES the idempotency claim (never fails it) — the actual fix for the duplicate-send bug', async () => {
      const { supabase, calls } = fakeIdempotencySupabase({
        outcome: 'proceed',
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
      mocks.resolveConversationByPhone.mockResolvedValue({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: false,
      });
      mocks.sendMessageToConversation.mockRejectedValue(
        new SendMessageError(
          'db_error',
          'Message sent to Meta but failed to save to DB: boom',
          500,
          { externalEffectOccurred: true, waMessageId: 'wamid-real' }
        )
      );

      const res = await POST(
        postRequest({ to: '+15550001111', text: 'hi' }, 'key-abc')
      );
      const body = (await res.json()) as { error: { code: string; message: string } };

      expect(res.status).toBe(500);
      expect(body.error.code).toBe('db_error');
      expect(body.error.message).toContain('sent to Meta');
      expect(calls.some((c) => c.name === 'complete_idempotent_request')).toBe(
        true
      );
      expect(calls.some((c) => c.name === 'fail_idempotent_request')).toBe(
        false
      );
    });

    it('a plain (non-external-effect) SendMessageError still releases the claim exactly as before — regression guard', async () => {
      const { supabase, calls } = fakeIdempotencySupabase({
        outcome: 'proceed',
      });
      mocks.requireApiKey.mockResolvedValue({ supabase, accountId: 'acct-1' });
      mocks.resolveConversationByPhone.mockResolvedValue({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: false,
      });
      mocks.sendMessageToConversation.mockRejectedValue(
        new SendMessageError('meta_error', 'Meta API error: 400', 502)
      );

      const res = await POST(
        postRequest({ to: '+15550001111', text: 'hi' }, 'key-abc')
      );

      expect(res.status).toBe(502);
      expect(calls.some((c) => c.name === 'fail_idempotent_request')).toBe(
        true
      );
      expect(calls.some((c) => c.name === 'complete_idempotent_request')).toBe(
        false
      );
    });
  });
});
