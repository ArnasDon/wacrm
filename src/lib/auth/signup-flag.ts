// ============================================================
// Flag de signup público — NEXT_PUBLIC_SIGNUP_ENABLED.
//
// Padrão: desabilitado. O deploy self-hosted também bloqueia no
// backend via GOTRUE_DISABLE_SIGNUP (deploy/docker-compose.yml);
// esta flag apenas controla a UI (página /signup e link "criar
// conta" no /login). Mantenha as duas coerentes no .env.
//
// Em bundles client o valor é inlinado no build; no deploy Docker
// a imagem é buildada com placeholder e o docker-entrypoint.sh o
// substitui por "true"/"false" no start do container.
// ============================================================

/**
 * Indica se o cadastro público (signup aberto) está habilitado.
 *
 * @returns `true` somente quando NEXT_PUBLIC_SIGNUP_ENABLED === "true".
 */
export function isSignupEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SIGNUP_ENABLED === "true";
}
