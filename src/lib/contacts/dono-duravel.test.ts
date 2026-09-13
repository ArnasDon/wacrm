import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `contacts.user_id`, `conversations.user_id` e `custom_fields.user_id`
// referenciam `auth.users` com **ON DELETE CASCADE** (001:38, 001:142; a
// 948 herdou a forma), e `conversations.contact_id` cascateia de novo.
// Quem for gravado ali leva, quando o LOGIN dele for apagado (dashboard do
// Supabase / admin API — o passo normal de offboarding; `remove_account_member`
// só realoca o perfil), o contato + a conversa + todas as mensagens daquele
// cliente — que são do escritório, não do operador.
//
// O erro é fácil e invisível: o código já tem o `user` autenticado em mão,
// `user_id: user.id` parece a coisa óbvia, o typecheck aprova e a tela
// funciona. Por isso a regra é verificada no FONTE do repositório INTEIRO,
// e não por comportamento. (Nasceu no PR #80 cobrindo um arquivo só; a
// revisão de 31/08 mediu que o teste antigo ficava VERDE sob três mutações
// reais — inclusive `?? user.id` — e que a regra valia em 1 de 4 caminhos.)
//
// Como funciona:
//   1. O conjunto de call sites que inserem nessas tabelas é EXATO
//      (deep-equal). Insert novo => declarar aqui a fonte durável, e o
//      revisor vê a mudança neste arquivo, que documenta a regra.
//   2. Todo `user_id:` gravado sob uma tabela protegida usa a FONTE
//      declarada do arquivo — nunca `user.id`/`userId` do chamador.
//   3. A fonte tem ORIGEM amarrada: nas rotas, atribuição a partir de
//      `owner_user_id` SEM fallback (`??`/`||`); no client, o
//      `ownerUserId` do `useAuth()`, sem redeclaração que o sombreie.
//   4. Shorthand (`user_id,` sem dois-pontos) é proibido no objeto
//      inserido — era a mutação que escondia o valor do teste antigo.
// ============================================================

const SRC = path.resolve(__dirname, '..', '..');

const TABELAS_PROTEGIDAS = ['contacts', 'conversations', 'custom_fields'];

/**
 * Manifesto: todo arquivo que insere nas tabelas protegidas, com a fonte
 * durável que ele usa e quantos call sites tem.
 *
 * `viaVariavel`: o insert recebe um identificador (`rows`/`chunk`)
 * construído acima — o `user_id:` mora na construção, não no argumento.
 */
const UNIVERSO: Record<
  string,
  { fontes: string[]; callSites: number; viaVariavel?: boolean }
> = {
  'app/api/cb/conversas/abrir/route.ts': { fontes: ['donoDaConta'], callSites: 2 },
  'app/api/whatsapp/send/route.ts': { fontes: ['donoDaConta'], callSites: 1 },
  'app/api/whatsapp/webhook/route.ts': {
    // Dono da config do WhatsApp — a ingestão sempre atribuiu a ele
    // ("stable default"); é durável do mesmo jeito (dono da conexão).
    fontes: ['configOwnerUserId'],
    callSites: 2,
  },
  'components/contacts/contact-form.tsx': { fontes: ['ownerUserId'], callSites: 1 },
  'components/contacts/custom-fields-manager.tsx': {
    fontes: ['ownerUserId'],
    callSites: 2,
  },
  'components/contacts/import-modal.tsx': {
    fontes: ['ownerUserId'],
    callSites: 2,
    viaVariavel: true,
  },
  'hooks/use-broadcast-sending.ts': {
    fontes: ['ownerUserId'],
    callSites: 1,
    viaVariavel: true,
  },
  'lib/asaas/criar-ficha.ts': {
    // A ficha que NASCE do Asaas (D2 de docs/PLANO-integracao-asaas.md): o
    // cliente com telefone e sem ficha ganha o contato — e só ele. `dono`
    // vem de `accounts.owner_user_id`, resolvido sem fallback.
    fontes: ['dono'],
    callSites: 1,
  },
  'lib/automations/destinatario.ts': {
    // O passo `send_to_number` (977) cria a ficha e a conversa do número
    // avisado. `donoDaConta` vem de `accounts.owner_user_id`, resolvido sem
    // fallback; o autor da automação nunca entra.
    fontes: ['dono'],
    callSites: 2,
  },
  'lib/api/v1/contacts.ts': {
    // `resolveApiAuthor` (authorship.ts): usuário de auditoria da v1 com
    // queda para o dono da conta — nunca um membro comum.
    fontes: ['auditUserId'],
    callSites: 1,
  },
  'lib/cb-groups/persist.ts': { fontes: ['ownerUserId'], callSites: 1 },
  'lib/instagram/persistir.ts': { fontes: ['ownerUserId'], callSites: 1 },
  'lib/whatsapp/inbound-store.ts': { fontes: ['ownerUserId'], callSites: 2 },
  'lib/whatsapp/resolve-conversation.ts': { fontes: ['ownerUserId'], callSites: 2 },
};

function* todosOsFontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* todosOsFontes(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const RE_CALL_SITE = new RegExp(
  `\\.from\\(\\s*['"](${TABELAS_PROTEGIDAS.join('|')})['"]\\s*\\)\\s*\\.\\s*(insert|upsert)\\s*\\(`,
  'g',
);

/** Argumento do insert/upsert, por balanceamento de parênteses. */
function extrairArgumento(src: string, aberturaIdx: number): string {
  let depth = 1;
  let i = aberturaIdx;
  while (depth > 0 && i < src.length - 1) {
    i++;
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
  }
  return src.slice(aberturaIdx + 1, i);
}

interface CallSite {
  arquivo: string;
  tabela: string;
  argumento: string;
}

function coletar(): { porArquivo: Map<string, CallSite[]>; fontesDe: Map<string, string> } {
  const porArquivo = new Map<string, CallSite[]>();
  const fontesDe = new Map<string, string>();
  for (const abs of todosOsFontes(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    const src = semComentarios(fs.readFileSync(abs, 'utf8'));
    fontesDe.set(rel, src);
    let m: RegExpExecArray | null;
    RE_CALL_SITE.lastIndex = 0;
    while ((m = RE_CALL_SITE.exec(src)) !== null) {
      const argumento = extrairArgumento(src, m.index + m[0].length - 1);
      const lista = porArquivo.get(rel) ?? [];
      lista.push({ arquivo: rel, tabela: m[1], argumento });
      porArquivo.set(rel, lista);
    }
  }
  return { porArquivo, fontesDe };
}

const { porArquivo, fontesDe } = coletar();

describe('dono durável: quem cria contato/conversa/campo grava o dono da conta', () => {
  it('o conjunto de arquivos que inserem nas tabelas protegidas é exatamente o declarado', () => {
    const achado = [...porArquivo.entries()]
      .map(([arquivo, sites]) => `${arquivo} ×${sites.length}`)
      .sort();
    const esperado = Object.entries(UNIVERSO)
      .map(([arquivo, r]) => `${arquivo} ×${r.callSites}`)
      .sort();
    // Divergiu? Um insert novo em contacts/conversations/custom_fields
    // nasceu (ou sumiu). Declare-o no UNIVERSO acima COM a fonte durável —
    // e garanta que ele grava o dono da conta, nunca quem clicou. Ver o
    // cabeçalho deste teste e CLAUDE.md ("Iniciar conversa pelo CRM").
    expect(achado).toEqual(esperado);
  });

  it('todo `user_id` gravado sob tabela protegida usa a fonte durável do arquivo', () => {
    for (const [arquivo, { fontes }] of Object.entries(UNIVERSO)) {
      const src = fontesDe.get(arquivo);
      expect(src, `${arquivo} sumiu`).toBeDefined();
      if (!src) continue;
      // Para cada `user_id: <valor>`, a tabela "vigente" é o último
      // `.from('...')` antes dele no texto. Sob tabela protegida, o valor
      // tem de ser uma fonte declarada (pega também as construções de
      // `rows` fora do argumento, e ignora o `user_id` legítimo de outras
      // tabelas — ex.: a autoria do insert de `broadcasts`).
      const gravacoes = [...src.matchAll(/user_id\s*:\s*([A-Za-z0-9_.?]+)/g)];
      expect(gravacoes.length, `${arquivo}: nenhum user_id gravado?`).toBeGreaterThan(0);
      for (const g of gravacoes) {
        const antes = src.slice(0, g.index);
        const froms = [...antes.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)];
        const vigente = froms.length ? froms[froms.length - 1][1] : null;
        const protegida = vigente === null || TABELAS_PROTEGIDAS.includes(vigente);
        if (!protegida) continue;
        expect(
          fontes,
          `${arquivo}: user_id gravado de "${g[1]}" sob a tabela "${vigente}" — ` +
            `use a fonte durável (${fontes.join('/')}), nunca a identidade de quem clicou`,
        ).toContain(g[1]);
      }
    }
  });

  it('o objeto inserido carrega `user_id:` explícito, sem shorthand', () => {
    for (const [arquivo, { viaVariavel }] of Object.entries(UNIVERSO)) {
      for (const site of porArquivo.get(arquivo) ?? []) {
        // Shorthand (`{ user_id, … }`) esconderia o valor deste teste — é a
        // mutação nº 3 medida na revisão. Vale também nos `viaVariavel`.
        expect(
          /[{,]\s*user_id\s*[,}]/.test(site.argumento),
          `${arquivo}: shorthand \`user_id,\` no insert de ${site.tabela}`,
        ).toBe(false);
        if (!viaVariavel) {
          expect(
            /user_id\s*:/.test(site.argumento),
            `${arquivo}: o insert de ${site.tabela} não grava user_id inline — ` +
              `se passou a montar as linhas fora, marque \`viaVariavel\` no UNIVERSO`,
          ).toBe(true);
        }
      }
      if (viaVariavel) {
        const src = fontesDe.get(arquivo) ?? '';
        expect(
          /user_id\s*:\s*ownerUserId/.test(src),
          `${arquivo}: a construção das linhas não grava \`user_id: ownerUserId\``,
        ).toBe(true);
      }
    }
  });

  it('as rotas resolvem `donoDaConta` de accounts.owner_user_id, sem fallback', () => {
    for (const arquivo of [
      'app/api/cb/conversas/abrir/route.ts',
      'app/api/whatsapp/send/route.ts',
    ]) {
      const src = fontesDe.get(arquivo) ?? '';
      const decl = src.match(/const\s+donoDaConta\s*=\s*([^\n;]+)/);
      expect(decl, `${arquivo}: cadê a declaração de donoDaConta?`).not.toBeNull();
      const rhs = decl![1];
      // A variável NASCE do select do dono — não de qualquer outro lugar do
      // arquivo que por acaso mencione owner_user_id (mutação nº 2).
      expect(rhs, `${arquivo}: donoDaConta não vem de owner_user_id`).toContain(
        'owner_user_id',
      );
      // `?? user.id` é o "amaciamento" que alguém escreve ao ver o 500 e
      // achar que não deve derrubar a ação do operador (mutação nº 1). O
      // 500 é o comportamento certo: sem dono resolvido, NADA é criado.
      expect(
        /\?\?|\|\|/.test(rhs),
        `${arquivo}: fallback na resolução do dono (${rhs.trim()}) — falhe fechado`,
      ).toBe(false);
    }
  });

  it('no client, `ownerUserId` vem do useAuth() e não é redeclarado', () => {
    for (const [arquivo, { fontes }] of Object.entries(UNIVERSO)) {
      if (!fontes.includes('ownerUserId')) continue;
      if (!arquivo.startsWith('components/') && !arquivo.startsWith('hooks/')) continue;
      const src = fontesDe.get(arquivo) ?? '';
      expect(
        /const\s*\{[^}]*\bownerUserId\b[^}]*\}\s*=\s*useAuth\(\)/.test(src),
        `${arquivo}: ownerUserId não vem do destructuring de useAuth()`,
      ).toBe(true);
      // `const ownerUserId = user.id` num escopo interno sombrearia a fonte
      // sem tocar no destructuring — proibido.
      expect(
        /(const|let|var)\s+ownerUserId\s*=/.test(src),
        `${arquivo}: redeclaração de ownerUserId sombreando o useAuth()`,
      ).toBe(false);
    }
  });

  it('o provider liga ownerUserId a accounts.owner_user_id (e a nada mais)', () => {
    const src = fontesDe.get('hooks/use-auth.tsx') ?? '';
    // O select da conta carrega a coluna…
    expect(/select\(\s*["'][^"']*owner_user_id[^"']*["']\s*\)/.test(src)).toBe(true);
    // …e o valor exposto é ela, com `?? null` (nulo = escritores falham
    // fechado). Qualquer outra forma — em especial uma queda para user.id —
    // reprova.
    expect(/ownerUserId:\s*account\?\.owner_user_id\s*\?\?\s*null/.test(src)).toBe(true);
    expect(/ownerUserId:[^,\n]*user\.id/.test(src)).toBe(false);
  });
});
