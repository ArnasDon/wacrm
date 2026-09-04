// ============================================================
// Email engine settings — the subset of listmonk's configuration
// that operators genuinely need, surfaced natively in the CRM so
// there is no second admin panel to visit.
//
// listmonk's own settings object has ~80 keys spanning S3 uploads,
// OIDC, bounce mailboxes, appearance and more. We deliberately
// expose only SMTP + sender identity: those are what stand between
// an install and working email. Everything else keeps its default,
// and is preserved untouched on save (see mergeSmtpSettings).
// ============================================================

/** One SMTP server as listmonk models it. */
export interface SmtpServer {
  uuid?: string;
  name?: string;
  enabled: boolean;
  host: string;
  port: number;
  auth_protocol: 'plain' | 'login' | 'cram' | 'none';
  username: string;
  password: string;
  tls_type: 'none' | 'STARTTLS' | 'TLS';
  tls_skip_verify: boolean;
  hello_hostname?: string;
  max_conns?: number;
  max_msg_retries?: number;
  idle_timeout?: string;
  wait_timeout?: string;
  email_headers?: unknown[];
  from_addresses?: unknown[];
}

/** The shape the CRM's settings form works with. */
export interface EmailSettings {
  fromEmail: string;
  siteName: string;
  rootUrl: string;
  smtp: SmtpServer;
}

/**
 * listmonk masks stored secrets on read, returning a run of U+2022
 * BULLET characters instead of the value. Writing that back would
 * literally set the password to "••••••••" — a silent, total
 * breakage of sending that looks like a successful save.
 *
 * listmonk's own contract is that an EMPTY password means "keep the
 * stored one" (matched by server UUID). So the mask must be
 * translated back to empty before any write.
 */
export function isMaskedSecret(value: string): boolean {
  return value.length > 0 && /^•+$/.test(value);
}

/** Empty out a masked password so listmonk retains the stored one. */
export function unmaskPassword(value: string): string {
  return isMaskedSecret(value) ? '' : value;
}

/**
 * Fold the operator's edits into the FULL settings object read back
 * from listmonk.
 *
 * This must be a merge, not a replacement: listmonk's PUT /api/settings
 * replaces the whole document, so posting only the handful of fields
 * this UI edits would wipe every other setting — upload config, bounce
 * mailboxes, appearance — back to empty.
 */
export function mergeSmtpSettings(
  current: Record<string, unknown>,
  edits: EmailSettings
): Record<string, unknown> {
  const existing = Array.isArray(current.smtp)
    ? (current.smtp as SmtpServer[])
    : [];

  // Edit the first server in place and leave any others alone. An
  // operator who configured a second relay directly in listmonk keeps
  // it; we only own slot 0.
  const [first, ...rest] = existing;
  const merged: SmtpServer = {
    ...(first ?? {}),
    enabled: true,
    host: edits.smtp.host.trim(),
    port: edits.smtp.port,
    auth_protocol: edits.smtp.auth_protocol,
    username: edits.smtp.username.trim(),
    password: unmaskPassword(edits.smtp.password),
    tls_type: edits.smtp.tls_type,
    tls_skip_verify: edits.smtp.tls_skip_verify,
  };

  return {
    ...current,
    'app.from_email': edits.fromEmail.trim(),
    'app.site_name': edits.siteName.trim(),
    'app.root_url': edits.rootUrl.trim(),
    smtp: [merged, ...rest],
  };
}

/** Pull the CRM-facing view out of listmonk's full settings object. */
export function toEmailSettings(raw: Record<string, unknown>): EmailSettings {
  const servers = Array.isArray(raw.smtp) ? (raw.smtp as SmtpServer[]) : [];
  const s = servers[0];

  return {
    fromEmail: String(raw['app.from_email'] ?? ''),
    siteName: String(raw['app.site_name'] ?? ''),
    rootUrl: String(raw['app.root_url'] ?? ''),
    smtp: {
      enabled: s?.enabled ?? true,
      host: s?.host ?? '',
      port: s?.port ?? 587,
      auth_protocol: s?.auth_protocol ?? 'plain',
      username: s?.username ?? '',
      password: s?.password ?? '',
      tls_type: s?.tls_type ?? 'STARTTLS',
      tls_skip_verify: s?.tls_skip_verify ?? false,
    },
  };
}
