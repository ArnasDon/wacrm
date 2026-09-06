/**
 * Map a Supabase Auth error from `inviteUserByEmail` /
 * `resetPasswordForEmail` into a clear HTTP response for the platform
 * admin, instead of the opaque 502 the invite route used to return
 * (which EasyPanel's proxy then rewrites into an HTML error page, so
 * the real cause never reaches the operator).
 *
 * The common failure in practice is Supabase's built-in email service
 * hitting its low hourly send limit — `over_email_send_rate_limit`.
 */

interface AuthErrorish {
  message?: string;
  code?: string;
  status?: number;
}

export interface MappedInviteError {
  status: number;
  message: string;
}

export function mapInviteError(err: unknown): MappedInviteError {
  const e = (err ?? {}) as AuthErrorish;
  const msg = typeof e.message === 'string' ? e.message : '';

  const isRateLimit =
    e.code === 'over_email_send_rate_limit' ||
    e.status === 429 ||
    /rate limit|too many requests|429/i.test(msg);
  if (isRateLimit) {
    return {
      status: 429,
      message:
        'Supabase alcanzó su límite de correos por hora. Espera unos minutos, o (recomendado para el SaaS) configura un servidor SMTP propio en Supabase → Authentication → SMTP y sube el límite de envío de correos.',
    };
  }

  const isConflict =
    e.code === 'email_exists' ||
    e.status === 422 ||
    /already|registered|exists/i.test(msg);
  if (isConflict) {
    return { status: 409, message: 'Este correo ya pertenece a un usuario' };
  }

  return {
    status: 422,
    message: `No se pudo enviar el correo: ${msg || 'error del proveedor de correo'}`,
  };
}
