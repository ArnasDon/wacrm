import { enUS, es, ko, ptBR } from 'date-fns/locale';
import type { Locale } from 'date-fns';

const dateLocales: Record<string, Locale> = { en: enUS, pt: ptBR, es, ko };

/** Match date-fns labels to the app catalogue, including Brazilian Portuguese. */
export function getDateLocale(locale: string): Locale {
  return dateLocales[locale] ?? enUS;
}
