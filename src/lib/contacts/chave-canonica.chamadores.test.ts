import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// TODO escritor de ficha trata o 23505 da chave canônica (1024) — travado
// estruturalmente, no desenho de `dono-duravel.test.ts`.
//
// Desde a 1024 a chave única de `contacts` é a grafia canônica do nono
// dígito: a segunda grafia do mesmo celular leva 23505 onde antes nascia
// uma ficha duplicada. Isso é bom SÓ SE todo escritor souber o que fazer com
// o 23505. Na ingestão, não saber é descartar a mensagem do cliente (o
// provedor já recebeu 200 e não reenvia) — a regra 18 do plano da Kommo. No
// CSV do disparo, era derrubar a campanha inteira.
//
// Escritor novo de `contacts` (INSERT, ou UPDATE que mexe no telefone)
// reprova aqui até alguém declarar, por escrito, como ele trata a colisão.
// ============================================================

const SRC = path.join(__dirname, '..', '..');

type Trato =
  // servidor: relê a ficha que VENCEU, com nova tentativa se a leitura falhar
  | 'releitura'
  // tela: aponta a ficha dona do número / conta como "já existia"
  | 'tela'
  // lote do CSV do disparo: relê e insere um a um, sem derrubar a campanha
  | 'lote-csv'
  // grava `phone: null` — fora do índice (a ficha só do Instagram)
  | 'sem-telefone';

const INSERTS: Record<string, { n: number; trato: Trato }> = {
  'app/api/cb/conversas/abrir/route.ts': { n: 1, trato: 'releitura' },
  'app/api/whatsapp/webhook/route.ts': { n: 1, trato: 'releitura' },
  'lib/api/v1/contacts.ts': { n: 1, trato: 'releitura' },
  'lib/asaas/criar-ficha.ts': { n: 1, trato: 'releitura' },
  'lib/automations/destinatario.ts': { n: 1, trato: 'releitura' },
  'lib/whatsapp/inbound-store.ts': { n: 1, trato: 'releitura' },
  'lib/whatsapp/resolve-conversation.ts': { n: 1, trato: 'releitura' },
  'components/contacts/contact-form.tsx': { n: 1, trato: 'tela' },
  'components/contacts/import-modal.tsx': { n: 2, trato: 'tela' },
  'hooks/use-broadcast-sending.ts': { n: 2, trato: 'lote-csv' },
  'lib/instagram/persistir.ts': { n: 1, trato: 'sem-telefone' },
};

// UPDATE que grava `phone` numa ficha existente: trocar para a irmã de OUTRA
// ficha agora é recusado.
const UPDATES_DE_TELEFONE: Record<string, { n: number; trato: 'tela' | 'correcao-descartada' }> = {
  // A pessoa vê o conflito ("já existe outra ficha com este número").
  'components/contacts/contact-form.tsx': { n: 1, trato: 'tela' },
  'components/contacts/contact-detail-view.tsx': { n: 1, trato: 'tela' },
  // A autocorreção pela variante de TRONCO depois que a Meta aceitou o envio
  // (erro 131030 do sandbox): o erro nem é lido, a mensagem já saiu, e a
  // variante de tronco não gera a irmã do nono dígito — descartar a correção
  // é inofensivo.
  'lib/whatsapp/send-message.ts': { n: 1, trato: 'correcao-descartada' },
  'lib/automations/meta-send.ts': { n: 1, trato: 'correcao-descartada' },
  'lib/flows/meta-send.ts': { n: 3, trato: 'correcao-descartada' },
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

/** Argumento da chamada, por balanceamento de parênteses. */
function argumento(src: string, abertura: number): string {
  let depth = 1;
  let i = abertura;
  while (depth > 0 && i < src.length - 1) {
    i++;
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
  }
  return src.slice(abertura + 1, i);
}

const RE_INSERT = /\.from\(\s*['"]contacts['"]\s*\)\s*\.\s*(?:insert|upsert)\s*\(/g;
const RE_UPDATE = /\.from\(\s*['"]contacts['"]\s*\)\s*\.\s*update\s*\(/g;

const inserts = new Map<string, number>();
const updates = new Map<string, number>();
const fontes = new Map<string, string>();
for (const abs of todosOsFontes(SRC)) {
  const rel = path.relative(SRC, abs).split(path.sep).join('/');
  const src = semComentarios(fs.readFileSync(abs, 'utf8'));
  fontes.set(rel, src);
  const nIns = [...src.matchAll(RE_INSERT)].length;
  if (nIns) inserts.set(rel, nIns);
  let nUp = 0;
  for (const m of src.matchAll(RE_UPDATE)) {
    const arg = argumento(src, (m.index ?? 0) + m[0].length - 1);
    if (/\bphone\s*:/.test(arg)) nUp++;
  }
  if (nUp) updates.set(rel, nUp);
}

describe('chave canônica (1024): todo escritor de ficha trata o 23505', () => {
  it('o conjunto de INSERTs em contacts é exatamente o declarado', () => {
    const achado = [...inserts.entries()].map(([a, n]) => `${a} ×${n}`).sort();
    const esperado = Object.entries(INSERTS).map(([a, r]) => `${a} ×${r.n}`).sort();
    expect(achado).toEqual(esperado);
  });

  it('o conjunto de UPDATEs que gravam o telefone é exatamente o declarado', () => {
    const achado = [...updates.entries()].map(([a, n]) => `${a} ×${n}`).sort();
    const esperado = Object.entries(UPDATES_DE_TELEFONE).map(([a, r]) => `${a} ×${r.n}`).sort();
    expect(achado).toEqual(esperado);
  });

  for (const [arquivo, { trato }] of Object.entries(INSERTS)) {
    it(`${arquivo}: ${trato}`, () => {
      const src = fontes.get(arquivo) ?? '';
      if (trato === 'releitura') {
        // O 23505 relê a VENCEDORA — nunca desiste na primeira leitura que
        // falha (na ingestão, desistir é perder a mensagem do cliente).
        expect(src).toContain('isUniqueViolation(');
        expect(src).toContain('fichaQueVenceu(');
      } else if (trato === 'tela' || trato === 'lote-csv') {
        expect(src).toContain('isUniqueViolation(');
      } else {
        expect(src).toMatch(/phone:\s*null/);
      }
    });
  }

  for (const [arquivo, { trato }] of Object.entries(UPDATES_DE_TELEFONE)) {
    if (trato !== 'tela') continue;
    it(`${arquivo}: a troca de telefone para a irmã de outra ficha vira aviso de conflito`, () => {
      expect(fontes.get(arquivo) ?? '').toContain('isUniqueViolation(');
    });
  }
});
