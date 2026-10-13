import { randomBytes } from 'node:crypto'

/** Placeholder the Apps Script prefills into the "Código de alta" field. */
export const TOKEN_PLACEHOLDER = 'TOKEN_SANDIA'

export function newIntakeToken(): string {
  return randomBytes(9).toString('hex')
}

export function intakeLink(prefillUrl: string, token: string): string {
  return prefillUrl.replace(TOKEN_PLACEHOLDER, token)
}
