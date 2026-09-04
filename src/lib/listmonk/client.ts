import {
  LISTMONK_TIMEOUT_MS,
  requireListmonkConfig,
  type ListmonkConfig,
} from './config';
import type {
  ListmonkCampaign,
  ListmonkCampaignStatus,
  ListmonkCounts,
  ListmonkEnvelope,
  ListmonkList,
  ListmonkPage,
  ListmonkSubscriber,
  ListmonkTemplate,
} from './types';

/**
 * A non-2xx response from listmonk. Carries the upstream status so
 * API routes can pass a 404 through as a 404 instead of flattening
 * everything to 500.
 */
export class ListmonkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ListmonkError';
    this.status = status;
  }
}

/**
 * listmonk authenticates API users with:
 *
 *   Authorization: token <api_user>:<token>
 *
 * NOT HTTP Basic with an admin's password — that is rejected with
 * "invalid API credentials". The user must be of type `api`, created
 * under Admin → Users, and note that listmonk **caches API users in
 * memory at boot**: a user inserted directly into its database is not
 * accepted until the process restarts.
 */
function authHeader(cfg: ListmonkConfig): string {
  return `token ${cfg.apiUser}:${cfg.apiToken}`;
}

async function request<T>(
  path: string,
  init: RequestInit & {
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<T> {
  const cfg = requireListmonkConfig();
  const { query, ...rest } = init;

  const url = new URL(`${cfg.baseUrl}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }

  // AbortSignal.timeout rather than a manual controller+setTimeout:
  // it cannot leak a dangling timer if the fetch settles first.
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        Authorization: authHeader(cfg),
        'Content-Type': 'application/json',
        ...(rest.headers ?? {}),
      },
      signal: AbortSignal.timeout(LISTMONK_TIMEOUT_MS),
      // Never let Next cache a mailing-list read; campaign stats and
      // subscriber counts are live numbers an operator acts on.
      cache: 'no-store',
    });
  } catch (err) {
    // Connection refused / DNS failure / timeout. 502 is the honest
    // status: this service is up, its upstream is not.
    const reason = err instanceof Error ? err.message : String(err);
    throw new ListmonkError(502, `Could not reach listmonk: ${reason}`);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // listmonk returns HTML for some auth failures (a login redirect).
    throw new ListmonkError(
      res.ok ? 502 : res.status,
      `Unexpected non-JSON response from listmonk (HTTP ${res.status})`
    );
  }

  if (!res.ok) {
    const message =
      (parsed as { message?: string } | null)?.message ??
      `listmonk returned HTTP ${res.status}`;
    throw new ListmonkError(res.status, message);
  }

  return (parsed as ListmonkEnvelope<T>).data;
}

// ------------------------------------------------------------
// Lists
// ------------------------------------------------------------

export function getLists(params: { page?: number; per_page?: number } = {}) {
  return request<ListmonkPage<ListmonkList>>('/api/lists', {
    query: { page: params.page ?? 1, per_page: params.per_page ?? 100 },
  });
}

export function createList(input: {
  name: string;
  type?: 'public' | 'private';
  optin?: 'single' | 'double';
  tags?: string[];
  description?: string;
}) {
  return request<ListmonkList>('/api/lists', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      type: input.type ?? 'private',
      optin: input.optin ?? 'single',
      tags: input.tags ?? [],
      description: input.description ?? '',
    }),
  });
}

export function deleteList(id: number) {
  return request<boolean>(`/api/lists/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------
// Subscribers
// ------------------------------------------------------------

export function getSubscribers(
  params: {
    page?: number;
    per_page?: number;
    list_id?: number;
    /** A raw SQL boolean expression over `subscribers`. */
    query?: string;
  } = {}
) {
  return request<ListmonkPage<ListmonkSubscriber>>('/api/subscribers', {
    query: {
      page: params.page ?? 1,
      per_page: params.per_page ?? 50,
      list_id: params.list_id,
      query: params.query,
    },
  });
}

export function createSubscriber(input: {
  email: string;
  name: string;
  status?: 'enabled' | 'blocklisted';
  lists?: number[];
  attribs?: Record<string, unknown>;
  preconfirm_subscriptions?: boolean;
}) {
  return request<ListmonkSubscriber>('/api/subscribers', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      status: input.status ?? 'enabled',
      lists: input.lists ?? [],
      attribs: input.attribs ?? {},
      preconfirm_subscriptions: input.preconfirm_subscriptions ?? true,
    }),
  });
}

export function updateSubscriber(
  id: number,
  input: {
    email: string;
    name: string;
    status?: 'enabled' | 'blocklisted';
    lists?: number[];
    attribs?: Record<string, unknown>;
    preconfirm_subscriptions?: boolean;
  }
) {
  return request<ListmonkSubscriber>(`/api/subscribers/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      status: input.status ?? 'enabled',
      lists: input.lists ?? [],
      attribs: input.attribs ?? {},
      preconfirm_subscriptions: input.preconfirm_subscriptions ?? true,
    }),
  });
}

export function deleteSubscriber(id: number) {
  return request<boolean>(`/api/subscribers/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------
// Campaigns
// ------------------------------------------------------------

export function getCampaigns(
  params: { page?: number; per_page?: number; query?: string } = {}
) {
  return request<ListmonkPage<ListmonkCampaign>>('/api/campaigns', {
    query: {
      page: params.page ?? 1,
      per_page: params.per_page ?? 50,
      query: params.query,
    },
  });
}

export function getCampaign(id: number) {
  return request<ListmonkCampaign>(`/api/campaigns/${id}`);
}

export function createCampaign(input: {
  name: string;
  subject: string;
  lists: number[];
  body: string;
  from_email?: string;
  content_type?: 'richtext' | 'html' | 'markdown' | 'plain';
  template_id?: number;
  tags?: string[];
  send_at?: string | null;
}) {
  return request<ListmonkCampaign>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      subject: input.subject,
      lists: input.lists,
      type: 'regular',
      content_type: input.content_type ?? 'richtext',
      body: input.body,
      ...(input.from_email ? { from_email: input.from_email } : {}),
      ...(input.template_id ? { template_id: input.template_id } : {}),
      tags: input.tags ?? [],
      ...(input.send_at ? { send_at: input.send_at } : {}),
    }),
  });
}

export function updateCampaign(
  id: number,
  input: {
    name: string;
    subject: string;
    lists: number[];
    body: string;
    from_email?: string;
    content_type?: 'richtext' | 'html' | 'markdown' | 'plain';
    template_id?: number;
    tags?: string[];
    send_at?: string | null;
  }
) {
  return request<ListmonkCampaign>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      subject: input.subject,
      lists: input.lists,
      type: 'regular',
      content_type: input.content_type ?? 'richtext',
      body: input.body,
      ...(input.from_email ? { from_email: input.from_email } : {}),
      ...(input.template_id ? { template_id: input.template_id } : {}),
      tags: input.tags ?? [],
      send_at: input.send_at ?? null,
    }),
  });
}

/**
 * Drive the campaign state machine. listmonk only accepts legal
 * transitions (you cannot resume a finished campaign), and rejects
 * anything else with a 400 we surface verbatim.
 */
export function setCampaignStatus(id: number, status: ListmonkCampaignStatus) {
  return request<ListmonkCampaign>(`/api/campaigns/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function deleteCampaign(id: number) {
  return request<boolean>(`/api/campaigns/${id}`, { method: 'DELETE' });
}

export function testCampaign(id: number, subscribers: string[]) {
  return request<boolean>(`/api/campaigns/${id}/test`, {
    method: 'POST',
    body: JSON.stringify({ subscribers }),
  });
}

// ------------------------------------------------------------
// Misc
// ------------------------------------------------------------

export function getTemplates() {
  return request<ListmonkTemplate[]>('/api/templates');
}

export function getCounts() {
  return request<ListmonkCounts>('/api/dashboard/counts');
}

/**
 * Cheap reachability + credential probe used by the Email section to
 * decide between "not configured", "unreachable", and "ready".
 */
export async function ping(): Promise<
  { ok: true; version: string } | { ok: false; status: number; error: string }
> {
  try {
    const about = await request<{ version: string }>('/api/config');
    return { ok: true, version: about?.version ?? 'unknown' };
  } catch (err) {
    if (err instanceof ListmonkError) {
      return { ok: false, status: err.status, error: err.message };
    }
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ------------------------------------------------------------
// Settings
//
// Exposed so the CRM can host the SMTP configuration itself rather
// than sending operators to a second admin panel.
// ------------------------------------------------------------

export function getSettings() {
  return request<Record<string, unknown>>('/api/settings');
}

/**
 * Replace the settings document.
 *
 * listmonk RESTARTS itself after a successful write (it has to —
 * the SMTP pool is built at boot). The HTTP response returns before
 * the restart completes, so callers must expect a brief window where
 * the service is unreachable.
 */
export function updateSettings(settings: Record<string, unknown>) {
  return request<{ needsRestart?: boolean }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

/**
 * Send a test message through a candidate SMTP config without saving
 * it. The body is an SMTP server object plus the destination in an
 * `email` field.
 */
export function testSmtp(server: Record<string, unknown>, email: string) {
  return request<boolean>('/api/settings/smtp/test', {
    method: 'POST',
    body: JSON.stringify({ ...server, email }),
  });
}

/**
 * Render a campaign body the way recipients will see it, with the
 * chosen template wrapped around it.
 *
 * Two things make this different from every other call here:
 *   1. listmonk reads the fields with `c.FormValue`, so the request
 *      MUST be form-encoded — a JSON body arrives empty and you get
 *      a preview of the stored campaign instead of the draft.
 *   2. The response is raw HTML, not listmonk's `{data: …}` envelope,
 *      so it cannot go through `request()`.
 */
export async function previewCampaign(
  id: number,
  input: { body: string; content_type: string; template_id?: number }
): Promise<string> {
  const cfg = requireListmonkConfig();

  const form = new URLSearchParams();
  form.set('body', input.body);
  form.set('content_type', input.content_type);
  if (input.template_id) form.set('template_id', String(input.template_id));

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/campaigns/${id}/preview`, {
      method: 'POST',
      headers: {
        Authorization: `token ${cfg.apiUser}:${cfg.apiToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(LISTMONK_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ListmonkError(502, `Could not reach listmonk: ${reason}`);
  }

  const text = await res.text();
  if (!res.ok) {
    let message = `listmonk returned HTTP ${res.status}`;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ListmonkError(res.status, message);
  }
  return text;
}

// ------------------------------------------------------------
// Transactional email
//
// This is what lets the WhatsApp automation and flow builders send
// email: one template, one recipient, sent immediately — no campaign,
// no list membership required.
// ------------------------------------------------------------

export interface TxSendInput {
  template_id: number;
  /** Recipient. `subscriber_mode: 'external'` means listmonk does NOT
   *  require this address to exist as a subscriber — it builds an
   *  ephemeral one for the send. That is the right mode for a CRM
   *  contact who may never have opted into a newsletter. */
  email: string;
  /** Free-form variables the template reads as `{{ .Tx.Data.<key> }}`. */
  data: Record<string, unknown>;
  /** Optional override of the template's own subject. */
  subject?: string;
  from_email?: string;
}

export function sendTransactional(input: TxSendInput) {
  return request<boolean>('/api/tx', {
    method: 'POST',
    body: JSON.stringify({
      subscriber_emails: [input.email],
      subscriber_mode: 'external',
      template_id: input.template_id,
      data: input.data,
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.from_email ? { from_email: input.from_email } : {}),
      content_type: 'html',
    }),
  });
}

// ------------------------------------------------------------
// Templates — full CRUD so the CRM can host the template editor.
//
// Two kinds matter here:
//   `tx`        — transactional. Has its own subject. Used by the
//                 automation/flow email steps.
//   `campaign`  — wrapper for newsletters. MUST contain the literal
//                 `{{ template "content" . }}` placeholder or listmonk
//                 rejects it (that is where the campaign body goes).
// ------------------------------------------------------------

export interface TemplateInput {
  name: string;
  type: 'tx' | 'campaign';
  body: string;
  /** Required for `tx`; ignored for `campaign`. */
  subject?: string;
}

export function getTemplate(id: number) {
  return request<ListmonkTemplate & { body: string; subject?: string }>(
    `/api/templates/${id}`
  );
}

export function createTemplate(input: TemplateInput) {
  return request<ListmonkTemplate>('/api/templates', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      body: input.body,
      subject: input.type === 'tx' ? (input.subject ?? '') : '',
    }),
  });
}

export function updateTemplate(id: number, input: TemplateInput) {
  return request<ListmonkTemplate>(`/api/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      body: input.body,
      subject: input.type === 'tx' ? (input.subject ?? '') : '',
    }),
  });
}

export function deleteTemplate(id: number) {
  return request<boolean>(`/api/templates/${id}`, { method: 'DELETE' });
}

/**
 * Render an unsaved template body. Same form-encoded + raw-HTML
 * contract as previewCampaign — see the note there.
 */
export async function previewTemplateBody(input: {
  body: string;
  type: 'tx' | 'campaign';
}): Promise<string> {
  const cfg = requireListmonkConfig();
  const form = new URLSearchParams();
  form.set('body', input.body);
  form.set('template_type', input.type);

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/templates/preview`, {
      method: 'POST',
      headers: {
        Authorization: `token ${cfg.apiUser}:${cfg.apiToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(LISTMONK_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ListmonkError(502, `Could not reach listmonk: ${reason}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = `listmonk returned HTTP ${res.status}`;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* keep generic */
    }
    throw new ListmonkError(res.status, message);
  }
  return text;
}
