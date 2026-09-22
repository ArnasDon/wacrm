import { describe, expect, it } from 'vitest';

import type { Meeting } from '@/types';

import {
  TODOS,
  filtrarPorResponsavel,
  mostrarResponsavel,
  primeiroNome,
  responsaveisDistintos,
} from './responsaveis';

function reuniao(id: string, ownerId: string | null, ownerNome: string): Meeting {
  return {
    id,
    account_id: 'conta',
    owner_user_id: ownerId,
    owner_nome: ownerNome,
    contact_id: null,
    contato_nome: null,
    conversation_id: null,
    channel_id: null,
    titulo: `Reunião ${id}`,
    descricao: null,
    local: null,
    tipo: 'outra',
    starts_at: '2026-09-02T12:00:00.000Z',
    ends_at: '2026-09-02T13:00:00.000Z',
    status: 'agendada',
    google_event_id: null,
    google_calendar_id: null,
    google_sincronizado_em: null,
    google_erro: null,
    created_by: null,
    autor_nome: 'Autor',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

describe('responsaveisDistintos', () => {
  it('conta pessoas, não reuniões', () => {
    const r = [
      reuniao('a', 'u1', 'Leonardo'),
      reuniao('b', 'u1', 'Leonardo'),
      reuniao('c', 'u2', 'Gabriel'),
    ];
    expect(responsaveisDistintos(r)).toBe(2);
  });

  it('lista vazia não tem responsável', () => {
    expect(responsaveisDistintos([])).toBe(0);
  });

  it('⚠️ reunião órfã conta como responsável próprio', () => {
    // Advogado que saiu da conta deixa `owner_user_id` nulo, mas o nome
    // carimbado sobrevive — e a reunião dele ainda precisa ser distinguida.
    const r = [reuniao('a', 'u1', 'Leonardo'), reuniao('b', null, 'Quem Saiu')];
    expect(responsaveisDistintos(r)).toBe(2);
  });

  it('duas órfãs de pessoas diferentes contam separado', () => {
    const r = [reuniao('a', null, 'Fulano'), reuniao('b', null, 'Beltrano')];
    expect(responsaveisDistintos(r)).toBe(2);
  });
});

describe('mostrarResponsavel', () => {
  it('⚠️ esconde quando só há um responsável — o nome não distingue nada', () => {
    const r = [reuniao('a', 'u1', 'Leonardo'), reuniao('b', 'u1', 'Leonardo')];
    expect(mostrarResponsavel(r)).toBe(false);
  });

  it('mostra assim que aparece um segundo', () => {
    const r = [reuniao('a', 'u1', 'Leonardo'), reuniao('b', 'u2', 'Gabriel')];
    expect(mostrarResponsavel(r)).toBe(true);
  });

  it('agenda vazia não mostra nada', () => {
    expect(mostrarResponsavel([])).toBe(false);
  });
});

describe('primeiroNome', () => {
  it('pega o primeiro', () => {
    expect(primeiroNome('Rodrigo Tavares Monteiro')).toBe('Rodrigo');
    expect(primeiroNome('Gabriel')).toBe('Gabriel');
  });

  it('tolera espaço sobrando e nome vazio', () => {
    expect(primeiroNome('  Ana   Maria  ')).toBe('Ana');
    expect(primeiroNome('')).toBe('');
    expect(primeiroNome('   ')).toBe('');
  });
});

describe('filtrarPorResponsavel', () => {
  const lista = [
    reuniao('a', 'u1', 'Leonardo'),
    reuniao('b', 'u2', 'Gabriel'),
    reuniao('c', null, 'Quem Saiu'),
  ];

  it('recorta por pessoa', () => {
    expect(filtrarPorResponsavel(lista, 'u1').map((r) => r.id)).toEqual(['a']);
  });

  it('⚠️ vazio e TODOS não recortam nada', () => {
    // Mesma convenção do resto do projeto: escopo vazio significa "tudo",
    // nunca "nenhum".
    expect(filtrarPorResponsavel(lista, TODOS)).toHaveLength(3);
    expect(filtrarPorResponsavel(lista, '')).toHaveLength(3);
  });

  it('pessoa sem reunião devolve lista vazia, não a lista inteira', () => {
    expect(filtrarPorResponsavel(lista, 'u9')).toEqual([]);
  });

  it('não devolve a órfã ao filtrar por alguém', () => {
    expect(filtrarPorResponsavel(lista, 'u2').map((r) => r.id)).toEqual(['b']);
  });
});
