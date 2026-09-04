import { encrypt } from './encryption'

/**
 * Decide what `whatsapp_config.verify_token` should hold after a config save.
 *
 * Skeleton: mirrors the current behaviour in `config/route.ts` verbatim so
 * the regression test can go red first (assert-red, not import-red).
 */
export function resolveVerifyTokenForSave(
  incoming: string | null | undefined,
  existingEncrypted: string | null,
): string | null {
  void existingEncrypted
  return incoming ? encrypt(incoming) : null
}
