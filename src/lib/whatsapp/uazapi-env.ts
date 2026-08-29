// ============================================================
// Env e resolução de URL para o provisionamento UAZAPI.
//
// server-only por construção: só as rotas de `/api/whatsapp/connections`
// chamam estes helpers, e nunca em import de módulo (para não derrubar o
// build de quem não usa UAZAPI). O admin token governa TODAS as
// instâncias do servidor do operador — nunca é enviado ao cliente nem
// logado.
// ============================================================

export function uazapiEnv(): { baseUrl: string; adminToken: string } {
  const baseUrl = process.env.UAZAPI_BASE_URL?.trim().replace(/\/+$/, '');
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN?.trim();
  if (!baseUrl) {
    throw new Error(
      'UAZAPI_BASE_URL is not set — required to provision UAZAPI connections',
    );
  }
  if (!adminToken) {
    throw new Error(
      'UAZAPI_ADMIN_TOKEN is not set — required to provision UAZAPI connections',
    );
  }
  return { baseUrl, adminToken };
}

export function resolveAppBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const headers = request.headers;
  const fwdHost = headers.get('x-forwarded-host');
  const host = fwdHost || headers.get('host');
  if (!host) throw new Error('cannot resolve app base URL: no host header');

  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}
