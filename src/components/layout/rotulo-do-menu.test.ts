import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Todo rótulo do menu lateral e do cabeçalho existe nos DOIS dicionários.
//
// `navItems` pede `t(item.labelKey)` e `pageTitles` pede `t(chave)` — chave
// MONTADA, que o portão `scripts/i18n-chaves-usadas.mjs` declara não
// alcançar (só conta as dinâmicas). Sem este pino, um item novo sem entrada
// no dicionário mostra `Sidebar.meuDia` cru no menu com o CI verde — foi
// assim com a seção Webhooks (CLAUDE.md). O molde é
// `src/components/settings/rotulo-da-secao.test.ts`.
// ============================================================

const RAIZ = path.resolve(__dirname, '..', '..', '..');

function fonte(relativo: string): string {
  return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

/** Só os blocos `navItems` e `bottomNavItems` — o `ROLE_META` também tem `labelKey`, noutro contexto. */
function blocosDoMenu(src: string): string {
  return ['const navItems', 'const bottomNavItems']
    .map((inicio) => {
      const de = src.indexOf(inicio);
      if (de < 0) return '';
      return src.slice(de, src.indexOf('];', de));
    })
    .join('\n');
}

const DO_MENU = [
  ...blocosDoMenu(fonte('src/components/layout/sidebar.tsx')).matchAll(
    /labelKey:\s*"(\w+)"/g
  ),
].map((m) => m[1]);
// Caminho com QUALQUER número de segmentos ("/settings/perfis" também): uma
// entrada pulada em silêncio é o modo de falha que o pino existe para impedir.
const DO_CABECALHO = [
  ...fonte('src/components/layout/header.tsx').matchAll(
    /"(\/[\w\-/]+)":\s*"(\w+)"/g
  ),
].map((m) => m[2]);

describe.each(['pt-BR.json', 'en.json'])(
  'rótulos do menu e do cabeçalho em %s',
  (arquivo) => {
    const dicionario = JSON.parse(
      fs.readFileSync(path.join(RAIZ, 'messages', arquivo), 'utf8')
    );

    it('a varredura acha as chaves (senão o pino passaria vazio)', () => {
      expect(DO_MENU.length).toBeGreaterThan(5);
      expect(DO_CABECALHO.length).toBeGreaterThan(5);
      expect(DO_MENU).toContain('meuDia');
      expect(DO_CABECALHO).toContain('meuDia');
    });

    it('todo `labelKey` do menu existe em `Sidebar`', () => {
      const faltam = DO_MENU.filter(
        (k) => typeof dicionario.Sidebar?.[k] !== 'string'
      );
      expect(faltam).toEqual([]);
    });

    it('todo título do cabeçalho existe em `Header`', () => {
      const faltam = DO_CABECALHO.filter(
        (k) => typeof dicionario.Header?.[k] !== 'string'
      );
      expect(faltam).toEqual([]);
    });
  }
);
