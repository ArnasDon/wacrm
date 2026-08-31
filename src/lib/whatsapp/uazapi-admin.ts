// ============================================================
// Client da API de administração da UAZAPI (API não-oficial).
//
// `fetch` direto, sem estado, sem SDK — mesmo estilo de
// `providers/uazapi-transport.ts`. Auth por header: `admintoken` para
// criar instância (governa o servidor todo), `token` da instância para
// tudo depois. Só as rotas de `/api/whatsapp/connections` chamam isto.
// ============================================================

const WEBHOOK_EVENTS = ['messages', 'messages_update', 'connection'];

type Json = Record<string, unknown>;

async function call(
  url: string,
  init: RequestInit & { headers: Record<string, string> }
): Promise<Json> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const path = new URL(url).pathname;
    const msg =
      (json.error as string) ||
      (json.message as string) ||
      `UAZAPI ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export async function createInstance(
  baseUrl: string,
  adminToken: string,
  name: string
): Promise<{ token: string; instanceId: string }> {
  const json = await call(`${baseUrl}/instance/create`, {
    method: 'POST',
    headers: { admintoken: adminToken },
    body: JSON.stringify({ name }),
  });
  const instance = (json.instance as Json | undefined) ?? {};
  const token = json.token as string | undefined;
  const instanceId = instance.id as string | undefined;
  if (!token || !instanceId) {
    throw new Error(
      'UAZAPI /instance/create response missing token or instance id'
    );
  }
  return { token, instanceId };
}

export async function configureWebhook(
  baseUrl: string,
  instanceToken: string,
  url: string
): Promise<void> {
  // isGroupYes pula grupos (senão cada grupo vira um contato); fromMeYes pula
  // tudo que sai do número — o eco dos envios via API e o que o operador digita
  // no celular. history não é assinado (despeja meses de conversa).
  await call(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({
      url,
      events: WEBHOOK_EVENTS,
      excludeMessages: ['isGroupYes', 'fromMeYes'],
    }),
  });
}

export async function connectInstance(
  baseUrl: string,
  instanceToken: string
): Promise<{ qrcode: string | null; paircode: string | null }> {
  const json = await call(`${baseUrl}/instance/connect`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({}),
  });
  const instance = (json.instance as Json | undefined) ?? {};
  return {
    qrcode: (instance.qrcode as string) ?? null,
    paircode: (instance.paircode as string) ?? null,
  };
}

export type UazapiStatus = {
  connected: boolean;
  loggedIn: boolean;
  phone: string | null;
  profileName: string | null;
  instanceStatus:
    'disconnected' | 'connecting' | 'connected' | 'hibernated' | null;
  qrcode: string | null;
};

export async function instanceStatus(
  baseUrl: string,
  instanceToken: string
): Promise<UazapiStatus> {
  const json = await call(`${baseUrl}/instance/status`, {
    method: 'GET',
    headers: { token: instanceToken },
  });
  const instance = (json.instance as Json | undefined) ?? {};
  const status = (json.status as Json | undefined) ?? {};
  const jid = status.jid as Json | null | undefined;
  return {
    connected: status.connected === true,
    loggedIn: status.loggedIn === true,
    phone:
      (jid && typeof jid === 'object' ? (jid.user as string) : null) ?? null,
    profileName: (instance.profileName as string) ?? null,
    instanceStatus: (instance.status as UazapiStatus['instanceStatus']) ?? null,
    qrcode: (instance.qrcode as string) ?? null,
  };
}

export async function disconnectInstance(
  baseUrl: string,
  instanceToken: string
): Promise<void> {
  await call(`${baseUrl}/instance/disconnect`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({}),
  });
}

export async function deleteInstance(
  baseUrl: string,
  instanceToken: string
): Promise<void> {
  await call(`${baseUrl}/instance`, {
    method: 'DELETE',
    headers: { token: instanceToken },
  });
}
