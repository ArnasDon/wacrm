import { describe, expect, it } from 'vitest';

import {
  CHAVE_DA_TENTATIVA,
  ESPERAS_MS,
  PASSOS_DE_ENVIO,
  TENTATIVAS_MAX,
  decidirRetentativa,
  tentativasJaFeitas,
} from './retentativa';

const recusou = { recusou: true };
const incerto = { recusou: false };

describe('decidirRetentativa', () => {
  it('repete o envio que o provedor RECUSOU — nada saiu', () => {
    expect(
      decidirRetentativa({
        stepType: 'send_to_number',
        tentativa: 1,
        provedor: recusou,
      })
    ).toEqual({ repetir: true, esperaMs: ESPERAS_MS[0] });
  });

  it('⚠️ NÃO repete envio sem recusa comprovada — a mensagem pode ter saído', () => {
    expect(
      decidirRetentativa({
        stepType: 'send_message',
        tentativa: 1,
        provedor: incerto,
      })
    ).toEqual({ repetir: false, motivo: 'entrega_incerta' });
  });

  it('⚠️ NÃO repete erro que não veio do provedor — configuração não melhora sozinha', () => {
    expect(
      decidirRetentativa({
        stepType: 'send_message',
        tentativa: 1,
        provedor: null,
      })
    ).toEqual({ repetir: false, motivo: 'nao_e_do_provedor' });
  });

  it('⚠️ passo que não é de envio nunca repete, nem com recusa do provedor', () => {
    for (const stepType of [
      'add_tag',
      'move_deal_stage',
      'update_contact_field',
      'create_task',
      'send_webhook',
      'run_automation',
      'passo_que_ainda_nao_existe',
    ]) {
      expect(
        decidirRetentativa({ stepType, tentativa: 1, provedor: recusou })
      ).toEqual({ repetir: false, motivo: 'passo' });
    }
  });

  it('a segunda espera é mais longa que a primeira', () => {
    const primeira = decidirRetentativa({
      stepType: 'send_media',
      tentativa: 1,
      provedor: recusou,
    });
    const segunda = decidirRetentativa({
      stepType: 'send_media',
      tentativa: 2,
      provedor: recusou,
    });
    expect(primeira).toEqual({ repetir: true, esperaMs: ESPERAS_MS[0] });
    expect(segunda).toEqual({ repetir: true, esperaMs: ESPERAS_MS[1] });
    expect(ESPERAS_MS[1]).toBeGreaterThan(ESPERAS_MS[0]);
  });

  it('⚠️ o TETO vence tudo — nunca reenfileira para sempre', () => {
    expect(
      decidirRetentativa({
        stepType: 'send_to_number',
        tentativa: TENTATIVAS_MAX,
        provedor: recusou,
      })
    ).toEqual({ repetir: false, motivo: 'teto' });
  });

  it('há uma espera declarada para cada retentativa que o teto permite', () => {
    expect(ESPERAS_MS.length).toBe(TENTATIVAS_MAX - 1);
  });

  it('a lista de envio cobre os seis passos que falam com o provedor', () => {
    expect([...PASSOS_DE_ENVIO].sort()).toEqual([
      'send_buttons',
      'send_list',
      'send_media',
      'send_message',
      'send_template',
      'send_to_number',
    ]);
  });
});

describe('tentativasJaFeitas', () => {
  it('contexto sem a chave, vazio ou estranho vale zero', () => {
    expect(tentativasJaFeitas(undefined)).toBe(0);
    expect(tentativasJaFeitas(null)).toBe(0);
    expect(tentativasJaFeitas({})).toBe(0);
    expect(tentativasJaFeitas('nada disso')).toBe(0);
    expect(tentativasJaFeitas({ [CHAVE_DA_TENTATIVA]: 'dois' })).toBe(0);
    expect(tentativasJaFeitas({ [CHAVE_DA_TENTATIVA]: 1.5 })).toBe(0);
    expect(tentativasJaFeitas({ [CHAVE_DA_TENTATIVA]: -1 })).toBe(0);
  });

  it('lê o contador quando ele é inteiro positivo', () => {
    expect(tentativasJaFeitas({ [CHAVE_DA_TENTATIVA]: 2 })).toBe(2);
  });
});
