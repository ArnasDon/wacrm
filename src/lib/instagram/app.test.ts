import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { APP_ID_VALIDO } from './app';

// `APP_ID_VALIDO` diz ser espelho do CHECK da 990. Divergindo, um App ID que
// a rota aceita morre no banco como 500 "Não foi possível salvar" — que não
// diz nada ao operador. Mesmo molde de `anexo-declarado.test.ts` (986).
describe('APP_ID_VALIDO', () => {
  it('é a MESMA expressão do CHECK de cb_instagram_config (990)', () => {
    const sql = readFileSync('supabase/migrations/0990_cb_instagram_config.sql', 'utf8');
    const noSql = /ig_app_id\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*ig_app_id\s*~\s*'([^']+)'\s*\)/.exec(sql);
    expect(noSql).not.toBeNull();
    expect(noSql![1]).toBe(APP_ID_VALIDO.source);
  });

  it('aceita só dígitos, entre 5 e 32', () => {
    expect(APP_ID_VALIDO.test('1611401280593179')).toBe(true);
    expect(APP_ID_VALIDO.test('1234')).toBe(false);
    expect(APP_ID_VALIDO.test('16114 01280')).toBe(false);
    expect(APP_ID_VALIDO.test('Ins-ta CRM CB')).toBe(false);
  });
});
