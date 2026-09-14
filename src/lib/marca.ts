// ============================================================
// A MARCA, num lugar só.
//
// Até 2026-09-08 o nome do produto estava escrito em TRÊS fontes que
// podiam discordar: `src/app/layout.tsx` (literal no código, no `title` e
// na `description`), o dicionário (`Sidebar.title`, `SignupPage.
// description`) e sete frases que citavam o nome do projeto ORIGINAL —
// herdadas do upstream e nunca traduzidas para o nosso. Quem instalasse
// isto em outro escritório trocaria o nome em três lugares e ainda
// encontraria o quarto meses depois, numa tela de Configurações.
//
// Agora é uma variável.
//
// ⚠️ `NEXT_PUBLIC_*` é INLINADO NO BUNDLE EM TEMPO DE BUILD — mudar o
// `crm.env` da VPS não muda nada aqui. Trocar o nome exige rebuildar a
// imagem. É o mesmo comportamento (e a mesma armadilha) do
// `NEXT_PUBLIC_APP_LOCALE`, registrada no CLAUDE.md; e é aceitável
// porque cada instalação constrói a própria imagem de qualquer forma:
// a URL e a chave anônima do Supabase também são inlinadas, então não
// existe uma imagem única servindo instalações diferentes.
//
// O prefixo `NEXT_PUBLIC_` é OBRIGATÓRIO aqui, ao contrário do que
// acontece com a URL do site: o nome é lido pelo `sidebar.tsx`, que é
// componente de cliente. Sem o prefixo ele chegaria `undefined` no
// navegador e a barra lateral ficaria com o nome de queda.
// ============================================================

/**
 * Nome de queda, deliberadamente genérico.
 *
 * ⚠️ Não escreva o nome de nenhum escritório aqui. Este arquivo VIAJA
 * para quem instalar o sistema, e um padrão com nome de gente faz a
 * instalação de outra pessoa nascer se apresentando como a nossa. Quem
 * quer um nome próprio define `NEXT_PUBLIC_APP_NAME` no build.
 */
const NOME_DE_QUEDA = 'CRM'

/** O nome do produto, como aparece na aba do navegador e na barra lateral. */
export const NOME_DO_APP =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || NOME_DE_QUEDA

/**
 * Logo opcional. Quando definido, a barra lateral desenha esta imagem no
 * lugar do símbolo padrão. O caminho é servido como está — o normal é
 * pôr o arquivo em `public/` e apontar para `/marca/logo.svg`.
 *
 * Vazio (o padrão) mantém o símbolo genérico: instalação sem logo não
 * pode quebrar a barra lateral por causa de um arquivo que não existe.
 */
export const LOGO_DO_APP = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || null

/**
 * Nome curto: o que aparece embaixo do ícone quando o sistema é instalado
 * na Tela de Início do celular. O iPhone corta nome comprido embaixo do
 * ícone, então quem quer o nome inteiro ali define
 * `NEXT_PUBLIC_APP_SHORT_NAME` no build. Sem ele, vale o nome do produto.
 */
export const NOME_CURTO_DO_APP =
  process.env.NEXT_PUBLIC_APP_SHORT_NAME?.trim() || NOME_DO_APP

/**
 * Tamanhos do ícone do app instalado: 180 é o que o iPhone usa; 192 e 512,
 * os que o Android exige no manifesto. `apple-icon.tsx` gera um arquivo por
 * tamanho e `manifest.ts` aponta para eles — os dois leem daqui para não
 * divergirem (um tamanho que só um lado conhece vira ícone quebrado, sem
 * erro nenhum).
 */
export const TAMANHOS_DO_ICONE = [180, 192, 512] as const
