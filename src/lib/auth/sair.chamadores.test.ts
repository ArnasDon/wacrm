import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Todo `auth.signOut(` em `src/` declara o ESCOPO por escrito.
//
// O padrão da biblioteca é `'global'` — revoga a sessão em todos os
// aparelhos da pessoa —, e ele é INVISÍVEL: `signOut()` sem argumento parece
// inofensivo, compila e funciona. Foi assim que o "Sair" do menu passou meses
// derrubando o celular do advogado junto com a aba do escritório sem ninguém
// ter decidido isso. A tela de entrada do Meu dia ganhou um "Não é você?
// Sair" para computador compartilhado, que tem de ser LOCAL; sem este pino,
// um refactor que trocasse o helper pelo `signOut` do `useAuth` voltaria a
// derrubar todos os aparelhos, sem erro nenhum.
//
// Como funciona: o conjunto de call sites é EXATO (deep-equal), com o escopo
// que cada um declara. Chamada nova => declarar aqui, e a revisão vê a
// decisão no diff — nunca por esquecimento.
// ============================================================

const SRC = path.resolve(__dirname, '..', '..');

/** Manifesto: arquivo → escopo declarado em cada chamada. */
const CHAMADORES: Record<string, string[]> = {
  // O botão do menu passou a sair SÓ deste aparelho pelo helper
  // `sairDesteAparelho` (D4, 12/09/2026) — não chama `.signOut(` direto.
  // "Sair e tentar com outra conta" do convite.
  'app/join/[token]/page.tsx': ['global'],
  // "Sair de todos os aparelhos", em Configurações → Segurança.
  'components/settings/sessions-card.tsx': ['global'],
  // O helper da tela de entrada: só este aparelho.
  'lib/auth/sair.ts': ['local'],
};

function arquivosDoSrc(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivosDoSrc(caminho));
    else if (
      /\.(ts|tsx)$/.test(entrada.name) &&
      !/\.test\.(ts|tsx)$/.test(entrada.name)
    )
      saida.push(caminho);
  }
  return saida;
}

/** Fonte sem comentários — inclusive o de fim de linha, senão `foo(); // …signOut(`
 *  vira falso positivo e reprova o CI sem defeito. (A mesma forma de
 *  `reopen.chamadores.test.ts`.) */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Os argumentos da chamada que abre logo depois do "(" em `inicio`. */
function argumentos(texto: string, inicio: number): string {
  let nivel = 1;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')') {
      nivel--;
      if (nivel === 0) return texto.slice(inicio, i);
    }
  }
  return texto.slice(inicio);
}

function escoposDeclarados(): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const arquivo of arquivosDoSrc(SRC)) {
    const fonte = semComentarios(fs.readFileSync(arquivo, 'utf8'));
    const relativo = path.relative(SRC, arquivo);
    for (const m of fonte.matchAll(/\.signOut\(/g)) {
      const args = argumentos(fonte, (m.index ?? 0) + m[0].length);
      const escopo =
        /scope\s*:\s*['"](local|global|others)['"]/.exec(args)?.[1] ??
        'SEM ESCOPO';
      (saida[relativo] ??= []).push(escopo);
    }
  }
  return saida;
}

describe('todo signOut declara o escopo', () => {
  const encontrados = escoposDeclarados();

  it('a varredura acha as chamadas (senão o pino passaria vazio)', () => {
    expect(Object.keys(encontrados).length).toBeGreaterThan(0);
  });

  it('o conjunto de chamadores e seus escopos é exatamente o manifesto', () => {
    expect(encontrados).toEqual(CHAMADORES);
  });
});

describe('signOut nunca é desestruturado nem referenciado solto', () => {
  // `const { signOut } = createClient().auth; await signOut()` e
  // `const sair = auth.signOut` escapariam da varredura por `.signOut(` — e
  // são exatamente a forma que este pino existe para impedir.
  it('nenhum arquivo tira `signOut` de um objeto `auth` por desestruturação ou referência', () => {
    const infratores: string[] = [];
    for (const arquivo of arquivosDoSrc(SRC)) {
      const fonte = semComentarios(fs.readFileSync(arquivo, 'utf8'));
      const desestruturado =
        /\{[^}]*\bsignOut\b[^}]*\}\s*=\s*[^;\n]*\bauth\b/.test(fonte);
      const referenciado = /\.auth\.signOut\b(?!\s*\()/.test(fonte);
      if (desestruturado || referenciado)
        infratores.push(path.relative(SRC, arquivo));
    }
    expect(infratores).toEqual([]);
  });
});

describe('a porta de entrada sai só deste aparelho', () => {
  it('usa sairDesteAparelho e nunca o signOut do useAuth', () => {
    const porta = semComentarios(
      fs.readFileSync(
        path.join(SRC, 'components/entrada/porta-de-entrada.tsx'),
        'utf8'
      )
    );
    expect(porta).toContain('sairDesteAparelho');
    expect(porta).not.toMatch(/\bsignOut\b/);
  });
});
