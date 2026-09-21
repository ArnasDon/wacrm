import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pino da resolução de conflito do merge do upstream de 2026-09-05
// (upstream #532, upload de CSV no assistente de broadcast).
//
// Os dois lados mexeram no MESMO trecho de `upsertCsvContacts`:
//
// - o upstream passou a casar o CSV pelo número NORMALIZADO
//   (`phone_normalized`, a coluna gerada da 022) em vez do texto cru —
//   sem isso "+55 (11) 9…" e "5511 9…" viravam dois inserts e o segundo
//   morria em 23505, derrubando a campanha inteira;
// - nós gravamos o DONO DA CONTA (`ownerUserId`) no contato criado, nunca
//   quem clicou: `contacts.user_id` CASCADEia de `auth.users`, e o
//   offboarding do operador levaria os contatos do CSV com conversas e
//   mensagens. A versão do upstream grava `user.id` ali.
//
// O merge fica com os dois. O próximo merge do upstream vai reabrir esse
// trecho; este teste lê o fonte porque `upsertCsvContacts` é uma função
// interna do hook (não exportada) e o que precisa ficar travado é a FORMA
// do insert, não um comportamento observável em teste unitário.
// ============================================================

const fonte = fs.readFileSync(
  path.join(__dirname, 'use-broadcast-sending.ts'),
  'utf8'
);

function corpoDe(nomeDaFuncao: string): string {
  const inicio = fonte.indexOf(`async function ${nomeDaFuncao}(`);
  expect(inicio).toBeGreaterThan(-1);
  // Até a próxima função irmã do hook — o suficiente para cobrir o corpo.
  const fim = fonte.indexOf('\n  async function ', inicio + 1);
  return fonte.slice(inicio, fim === -1 ? undefined : fim);
}

describe('upsertCsvContacts: resolução do merge do upstream (2026-09-05)', () => {
  const corpo = corpoDe('upsertCsvContacts');

  it('casa o CSV pelo número normalizado, por CONTA (lado do upstream, #532)', () => {
    expect(corpo).toContain(".eq('account_id', accountId)");
    expect(corpo).toContain(".in('phone_normalized', fatia)");
    expect(corpo).not.toContain(".in('phone', ");
  });
});

describe('upsertCsvContacts: a MESMA PESSOA nas duas grafias do nono dígito (1024)', () => {
  // Desde a 1024 a chave única de `contacts` é a grafia canônica: o CSV que
  // trouxesse "5583988745316" para a ficha gravada como "558388745316" (o
  // JID do WhatsApp) não a achava pela busca exata, ia para o INSERT e o
  // lote inteiro levava 23505 — a campanha não saía. Três peças, e o teste
  // cobra as três.
  const corpo = corpoDe('upsertCsvContacts');

  it('deduplica e mapeia por pessoa (`chaveDePessoa`), nunca pela grafia', () => {
    expect(fonte).toContain(
      "import { chaveDePessoa, isUniqueViolation } from '@/lib/contacts/dedupe'"
    );
    expect(corpo).toContain('chaveDePessoa(row.phone)');
    expect(corpo).not.toContain('normalizeKey(');
  });

  it('busca as DUAS grafias de cada número, em fatias (teto de mil linhas)', () => {
    expect(corpo).toContain('variantesDoNonoDigito(k)');
    expect(corpo).toMatch(/grafias\.slice\(i, i \+ LOOKUP_CHUNK\)/);
  });

  it('a corrida (23505 no lote) relê e insere um a um, sem derrubar a campanha', () => {
    expect(corpo).toContain('isUniqueViolation(insertErr)');
    expect(corpo).toContain('isUniqueViolation(erroDeUm)');
  });

  it('grava o dono da conta no contato novo, com falha fechada (lado nosso)', () => {
    expect(corpo).toContain('user_id: ownerUserId');
    expect(corpo).toContain('if (!ownerUserId) {');
    // A forma que o merge do upstream traz de volta.
    expect(corpo).not.toContain('user_id: user.id');
  });
});
