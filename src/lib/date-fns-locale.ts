import { ko, ptBR } from 'date-fns/locale';
import type { Locale } from 'date-fns';

const DATE_FNS_LOCALES: Record<string, Locale> = {
  'pt-BR': ptBR,
  ko,
};

/** Maps the app's next-intl locale (from useLocale()) to a date-fns
 *  Locale for relative-time helpers like formatDistanceToNow, so
 *  "5 minutes ago" doesn't leak English into a pt-BR/ko deployment.
 *  Undefined falls back to date-fns' own English default. */
export function getDateFnsLocale(appLocale: string): Locale | undefined {
  return DATE_FNS_LOCALES[appLocale];
}
