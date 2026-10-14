import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import type { ResolvedTemplate } from './template-body';
import { isMessageTemplate } from './template-row-guard';
export async function resolveLocalTemplate(
  db: SqlConnection,
  accountId: string,
  name: string,
  language?: string | null
): Promise<ResolvedTemplate> {
  const rows = await queryRows<{ language?: string }>(
    db,
    'SELECT * FROM public.message_templates WHERE account_id=$1 AND name=$2 ORDER BY language,id',
    [accountId, name]
  );
  const base = (v: string) => v.toLowerCase().split(/[_-]/)[0];
  const chosen = language
    ? (rows.find((r) => r.language?.toLowerCase() === language.toLowerCase()) ??
      rows.find((r) => r.language && base(r.language) === base(language)))
    : (rows.find((r) => r.language === 'en_US') ??
      rows.find((r) => r.language === 'en') ??
      rows[0]);
  if (!chosen)
    return { row: null, malformed: false, language: language || 'en_US' };
  if (!isMessageTemplate(chosen))
    return { row: null, malformed: true, language: language || 'en_US' };
  return {
    row: chosen,
    malformed: false,
    language: language || chosen.language || 'en_US',
  };
}
