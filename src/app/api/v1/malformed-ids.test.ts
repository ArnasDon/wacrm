import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: {
      from() {
        throw new Error('must not query with a malformed id');
      },
    },
    accountId: 'account-1',
  })),
}));

import { GET as getConversation } from './conversations/[id]/route';
import { GET as getBroadcast } from './broadcasts/[id]/route';
import {
  GET as getWebhook,
  PATCH as patchWebhook,
  DELETE as deleteWebhook,
} from './webhooks/[id]/route';

const params = { params: Promise.resolve({ id: 'not-a-uuid' }) };

function req(method = 'GET', body?: unknown) {
  return new Request('https://x.test/api/v1/resource/not-a-uuid', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('v1 [id] routes with a non-UUID id', () => {
  it.each([
    ['GET conversations/{id}', () => getConversation(req(), params)],
    ['GET broadcasts/{id}', () => getBroadcast(req(), params)],
    ['GET webhooks/{id}', () => getWebhook(req(), params)],
    [
      'PATCH webhooks/{id}',
      () => patchWebhook(req('PATCH', { is_active: true }), params),
    ],
    ['DELETE webhooks/{id}', () => deleteWebhook(req('DELETE'), params)],
  ])('%s returns 404 not_found', async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');
  });
});
