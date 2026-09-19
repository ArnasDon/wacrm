import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Todo escritor de `deals.title` declara, por escrito, o que faz com a marca
// `titulo_fixado_em` (1007):
//
//   · FIXA — a marca vai junto (`titulo_fixado_em:`, `tituloFixadoEm`,
//     `escritaDoTituloManual`). É quem escreve um título DIGITADO: o lápis do
//     card e a API v1.
//   · DERIVA — escreve um título tirado do nome de alguém, de propósito SEM
//     marca. É o que deixa o gatilho da 1007 manter o card em dia quando a
//     ficha ganhar um nome melhor.
//   · RESPEITA — `.is('titulo_fixado_em', null)` na própria cadeia.
//
// Por que um teste, e não confiança: o gatilho que renomeia o card mora no
// BANCO, e a única coisa que o segura é essa marca. Um caminho novo que grave
// título sem declarar o que faz cai num de dois buracos, e nenhum dos dois
// aparece no typecheck: ou congela para sempre um card que deveria seguir a
// ficha (marcando sem querer), ou deixa o robô apagar um título que uma
// pessoa escreveu (não marcando).
//
// Alcance: mesma varredura do irmão `nome-fixado.chamadores.test.ts` — entra
// toda escrita em `deals` (update, insert, upsert) cujo objeto tem a chave
// `title`, tem chave computada, espalha algo, ou nem é literal. O conjunto é
// EXATO (deep-equal): escritor novo entra aqui por decisão visível no diff.
// ============================================================

type Classe = "fixa" | "deriva" | "respeita";
type Op = "update" | "insert" | "upsert";

/** Manifesto: arquivo → cada escrita de título dele, como `op:classe`, em ordem. */
const ESCRITORES: Record<string, string[]> = {
  // ---- Gente (ou o integrador) digitou o título: FIXA ----
  // O formulário só manda o título quando ele MUDOU (escritaDoTituloManual);
  // na criação, o título digitado já nasce fixado.
  "components/pipelines/deal-form.tsx": ["update:fixa", "insert:fixa"],
  // PATCH da v1: quem mandou o campo quis mandá-lo.
  "app/api/v1/deals/[id]/route.ts": ["update:fixa"],
  // ⚠️ O nascimento de TODO card do servidor passa por aqui, e a decisão é do
  // CHAMADOR (`tituloFixadoEm`): o POST da v1 fixa, o roteador de conexão e o
  // passo `create_deal` do motor derivam. A varredura vê a coluna e lê "fixa";
  // quem chamar `createDeal` em código novo decide por escrito qual dos dois é.
  "lib/deals/create-deal.ts": ["insert:fixa"],

  // ---- Não escrevem título (objeto MONTADO: a varredura não vê as chaves) ----
  // O editor de negócio do painel da conversa manda etapa, valor e data — o
  // `patch` é `Partial<Deal>` e o título nunca entra nele. Se um dia entrar,
  // a decisão (fixa ou deriva) vem escrita para cá.
  "components/inbox/painel/painel-do-contato.tsx": ["update:deriva"],

  // ---- Título DERIVADO de um nome, sem marca, de propósito ----
  // O nome do agendamento vira o título do card aberto (999). Não olha a
  // marca: decisão do operador em 14/09/2026, reafirmada em 19/09 — quem
  // agendou manda, inclusive por cima de um título escrito à mão.
  "lib/calendly/processar.ts": ["update:deriva"],
};

const SRC = path.resolve(__dirname, "..", "..");

function arquivos(dir: string, fora: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivos(p, fora);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) fora.push(p);
  }
  return fora;
}

/** O conteúdo entre a `{` de abertura e a `}` que a fecha (sem as chaves). */
function objetoLiteral(texto: string): string | null {
  if (!texto.startsWith("{")) return null;
  let nivel = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}" && --nivel === 0) return texto.slice(1, i);
  }
  return null;
}

interface Escrita {
  arquivo: string;
  linha: number;
  op: Op;
  classe: Classe | null;
}

const RESPEITA = /\.is\(\s*['"]titulo_fixado_em['"]\s*,\s*null\s*\)/;
const FIXA = /\btitulo_fixado_em\s*:|\btituloFixadoEm\b|escritaDoTituloManual\(/;

function escritasDeTitulo(): Escrita[] {
  const achadas: Escrita[] = [];
  for (const abs of arquivos(SRC)) {
    const fonte = fs.readFileSync(abs, "utf8");
    const re = /from\(\s*['"]deals['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      // A cadeia vai até a PRÓXIMA consulta (ou 1200 caracteres): sem o corte,
      // a marca de outra cadeia logo abaixo faria esta passar.
      let fim = fonte.indexOf("from(", m.index + 5);
      if (fim === -1 || fim > m.index + 1200) fim = m.index + 1200;
      const cadeia = fonte.slice(m.index, fim);
      const op = cadeia.match(/\.(update|insert|upsert)\(\s*/);
      if (!op || op.index === undefined) continue;

      const argumento = cadeia.slice(op.index + op[0].length);
      const literal = objetoLiteral(argumento);
      const escreveTitulo =
        literal === null ||
        /(^|[\s,{])title\s*[:,}]/.test(literal) ||
        /\[[^\]]+\]\s*:/.test(literal) ||
        /\.\.\.\s*[\w(]/.test(literal);
      if (!escreveTitulo) continue;

      const respeita = RESPEITA.test(cadeia);
      // Objeto literal: a marca tem de estar NELE. Objeto montado: no corpo
      // da FUNÇÃO que o monta — o PATCH da v1 monta o `update` no começo da
      // rota e só escreve dezenas de linhas depois, fora de qualquer janela
      // de caracteres razoável. Preço da folga: duas escritas na mesma função,
      // uma fixando e outra não, passariam as duas como "fixa". Não há
      // nenhuma hoje, e o conjunto exato abaixo mostra quando houver.
      const daFuncao = fonte.lastIndexOf("function ", m.index);
      const onde = literal ?? fonte.slice(daFuncao === -1 ? 0 : daFuncao, m.index);
      const fixa = FIXA.test(onde);
      achadas.push({
        arquivo: path.relative(SRC, abs).split(path.sep).join("/"),
        linha: fonte.slice(0, m.index).split("\n").length,
        op: op[1] as Op,
        // As duas juntas não fazem sentido (marcar só onde a marca já é nula).
        classe: respeita && fixa ? null : respeita ? "respeita" : fixa ? "fixa" : "deriva",
      });
    }
  }
  return achadas;
}

describe("escritores de deals.title × título fixado (1007)", () => {
  const achadas = escritasDeTitulo();

  it("CRÍTICO: nenhum escritor respeita E fixa a marca ao mesmo tempo", () => {
    const soltos = achadas.filter((e) => e.classe === null).map((e) => `${e.arquivo}:${e.linha}`);
    expect(soltos).toEqual([]);
  });

  it("CRÍTICO: o conjunto de escritores é EXATO — escritor novo é decisão escrita neste arquivo", () => {
    const porArquivo: Record<string, string[]> = {};
    for (const e of achadas) (porArquivo[e.arquivo] ??= []).push(`${e.op}:${e.classe}`);
    expect(porArquivo).toEqual(ESCRITORES);
  });

  it("o formulário do card manda o título SÓ quando ele mudou", () => {
    const form = fs.readFileSync(
      path.join(SRC, "components/pipelines/deal-form.tsx"),
      "utf8",
    );
    // O payload comum não pode carregar `title`: ele é reusado no update e no
    // insert, e um `title:` ali voltaria a regravar o título a cada salvamento.
    const payload = form.slice(form.indexOf("const payload = {"));
    expect(payload.slice(0, payload.indexOf("};"))).not.toMatch(/(^|[\s,{])title\s*:/);
    expect(form).toMatch(/escritaDoTituloManual\(deal\.title, title, agora\)/);
  });
});
