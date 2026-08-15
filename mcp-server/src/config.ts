// ============================================================
// Configuration — read once at startup from the environment.
//
// The server needs the URL of a wacrm instance and an API key.
// Two opt-in flags decide whether write / broadcast tools are
// registered at all: by default the server is READ-ONLY, so an
// MCP client can never see a tool that mutates data or sends a
// message unless the operator turns it on deliberately. The API
// key's own scopes are still enforced server-side on top of this —
// this is a second, client-side guard, not a replacement.
// ============================================================

export interface Config {
  baseUrl: string;
  apiKey: string;
  enableWrites: boolean;
  enableBroadcasts: boolean;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function loadConfig(): Config {
  const baseUrlRaw = process.env.WACRM_BASE_URL?.trim();
  const apiKey = process.env.WACRM_API_KEY?.trim();

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('WACRM_BASE_URL');
  if (!apiKey) missing.push('WACRM_API_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set WACRM_BASE_URL to your instance URL (e.g. https://crm.example.com) ` +
        `and WACRM_API_KEY to a key from Settings → API keys.`,
    );
  }

  // Normalise: strip a trailing slash so path joins are predictable.
  const baseUrl = baseUrlRaw!.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(
      `WACRM_BASE_URL must start with http:// or https:// (got "${baseUrl}").`,
    );
  }

  const enableWrites = truthy(process.env.WACRM_ENABLE_WRITES);
  const enableBroadcasts = truthy(process.env.WACRM_ENABLE_BROADCASTS);

  if (enableBroadcasts && !enableWrites) {
    throw new Error(
      'WACRM_ENABLE_BROADCASTS requires WACRM_ENABLE_WRITES to also be set.',
    );
  }

  return {
    baseUrl,
    apiKey: apiKey!,
    enableWrites,
    enableBroadcasts,
  };
}
