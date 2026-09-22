import { describe, expect, it } from 'vitest';

import {
  prepararEscritaPorChave,
  serializeCustomFields,
} from './custom-fields';
import type { CustomField } from '@/types';

function campo(p: Partial<CustomField>): CustomField {
  return {
    id: 'id-1',
    user_id: 'u',
    account_id: 'a',
    field_name: 'Campo',
    field_type: 'text',
    field_key: 'campo',
    categoria: 'geral',
    created_at: '2026-01-01',
    ...p,
  };
}

describe('serializeCustomFields', () => {
  const fields = [
    campo({
      id: '1',
      field_key: 'utm_source',
      field_name: 'utm_source',
      categoria: 'tracking',
    }),
    campo({
      id: '2',
      field_key: 'origem',
      field_name: 'Origem da dívida',
      field_type: 'select',
      field_options: { opcoes: ['CPF', 'CNPJ'] },
    }),
    campo({
      id: '3',
      field_key: 'data_da_proposta',
      field_name: 'Data da Proposta',
    }),
  ];

  it('endereça pela CHAVE, com valor nulo quando o contato não tem', () => {
    const out = serializeCustomFields(fields, { '1': 'facebook' });
    expect(out.values).toEqual({
      utm_source: 'facebook',
      origem: null,
      data_da_proposta: null,
    });
    expect(out.fields[0]).toMatchObject({
      key: 'utm_source',
      category: 'tracking',
      value: 'facebook',
    });
  });

  it("'' gravado no banco sai como null no wire — vazio é null não importa quem escreveu", () => {
    // Desde 21/09/2026 a automação update_contact_field NÃO grava mais ''
    // quando a variável resolve vazia, mas o '' ainda pode estar no banco (e
    // outros escritores existem); a doc promete null para campo vazio.
    const out = serializeCustomFields(fields, { '1': '', '2': '   ' });
    expect(out.values).toEqual({
      utm_source: null,
      origem: null,
      data_da_proposta: null,
    });
  });

  it('options só aparece em campo select', () => {
    const out = serializeCustomFields(fields, {});
    expect(out.fields.find((f) => f.key === 'origem')?.options).toEqual([
      'CPF',
      'CNPJ',
    ]);
    expect(
      out.fields.find((f) => f.key === 'utm_source')?.options
    ).toBeUndefined();
  });
});

describe('prepararEscritaPorChave', () => {
  const fields = [
    { id: 'id-utm', field_key: 'utm_source', field_type: 'text' },
    { id: 'id-fb', field_key: 'fbclid', field_type: 'text' },
    { id: 'id-data', field_key: 'data_da_proposta', field_type: 'datetime' },
  ];

  it('traduz chave→id, apara string e coage número/booleano', () => {
    const r = prepararEscritaPorChave(fields, {
      utm_source: '  facebook  ',
      fbclid: 12345,
    });
    expect(r).toEqual({
      ok: true,
      porId: { 'id-utm': 'facebook', 'id-fb': '12345' },
    });
  });

  it('"" e null LIMPAM (viram \'\' — o upsert compartilhado deleta)', () => {
    const r = prepararEscritaPorChave(fields, { utm_source: '', fbclid: null });
    expect(r).toEqual({ ok: true, porId: { 'id-utm': '', 'id-fb': '' } });
  });

  it('chave desconhecida é ERRO com a lista — typo do n8n aparece na 1ª chamada', () => {
    const r = prepararEscritaPorChave(fields, { utm_sorce: 'x', fbclid: 'y' });
    expect(r).toEqual({
      ok: false,
      desconhecidas: ['utm_sorce'],
      invalidas: [],
      datasInvalidas: [],
      longas: [],
    });
  });

  it('datetime SEM offset (ou fora de ISO) é erro — e com offset grava NORMALIZADO em UTC', () => {
    // A armadilha das 3h (935): sem offset o Postgres/JS lê como UTC; formato
    // BR nem parseia — os dois respondiam 200 e viravam dado morto invisível.
    for (const ruim of [
      '31/12/2026',
      '2026-08-05 14:00',
      '2026-08-05T14:00:00',
      'amanhã',
    ]) {
      const r = prepararEscritaPorChave(fields, { data_da_proposta: ruim });
      expect(r).toMatchObject({
        ok: false,
        datasInvalidas: ['data_da_proposta'],
      });
    }
    const ok = prepararEscritaPorChave(fields, {
      data_da_proposta: '2026-08-30T14:00:00-03:00',
    });
    expect(ok).toEqual({
      ok: true,
      porId: { 'id-data': '2026-08-30T17:00:00.000Z' },
    });
    // Limpar não passa pela validação: null/'' seguem limpando campo de data.
    expect(prepararEscritaPorChave(fields, { data_da_proposta: null })).toEqual(
      {
        ok: true,
        porId: { 'id-data': '' },
      }
    );
  });

  it('valor acima de MAX_VALOR é erro de tamanho (nada de blob em coluna TEXT)', () => {
    const r = prepararEscritaPorChave(fields, { utm_source: 'x'.repeat(4001) });
    expect(r).toMatchObject({ ok: false, longas: ['utm_source'] });
    expect(
      prepararEscritaPorChave(fields, { utm_source: 'x'.repeat(4000) })
    ).toMatchObject({
      ok: true,
    });
  });

  it('só espaços também limpa — o trim esvazia antes do teste de vazio', () => {
    expect(prepararEscritaPorChave(fields, { utm_source: '   ' })).toEqual({
      ok: true,
      porId: { 'id-utm': '' },
    });
  });

  it('objeto/array como valor é erro de tipo', () => {
    const r = prepararEscritaPorChave(fields, { utm_source: { a: 1 } });
    expect(r).toEqual({
      ok: false,
      desconhecidas: [],
      invalidas: ['utm_source'],
      datasInvalidas: [],
      longas: [],
    });
  });
});
