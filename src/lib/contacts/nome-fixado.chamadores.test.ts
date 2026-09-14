import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Todo escritor de `contacts.name` declara, por escrito, o que faz com a
// marca `nome_fixado_em` (999):
//
//   · RESPEITA — `.is('nome_fixado_em', null)` no próprio UPDATE. São os
//     caminhos automáticos que trocam o nome pelo perfil do WhatsApp.
//   · GRAVA — a marca vai junto (`nome_fixado_em:`, `marcaDoNomeManual`,
//     `escritaDoNomeManual`). O agendamento do Calendly, o passo de automação
//     que atualiza o nome e as telas onde GENTE escreve o nome (decisão do
//     operador em 14/09/2026: a escrita à mão também fixa).
//   · SEM MARCA — nem uma coisa nem outra, e cada caso tem o motivo escrito
//     no manifesto abaixo. É a categoria que precisa de decisão: um UPDATE
//     sem marca sobrescreve o nome escolhido; um INSERT sem marca cria a
//     ficha com um nome que a próxima mensagem troca.
//
// Até a 999, três caminhos automáticos trocavam o nome da ficha pelo do
// perfil do WhatsApp a cada mensagem — e o nome que o cliente digitou no
// agendamento do Calendly durava até a mensagem seguinte dele. A guarda mora
// dentro do UPDATE, e nada no typecheck nem num teste unitário acusa quando
// ela some (o webhook da Meta é arquivo do UPSTREAM: um merge o traz cru).
//
// Como funciona: o conjunto é EXATO (deep-equal). Escritor novo entra aqui
// por decisão visível no diff.
//
// ⚠️ Alcance, e por que ele foi alargado (revisão do PR #208): a primeira
// versão só enxergava `.update({ ... name ... })` com objeto LITERAL, e por
// isso não viu o passo `update_contact_field` do motor (chave COMPUTADA,
// `[cfg.field]`) — justamente o que a automação ativa do Calendly usa. Agora
// entra toda escrita em `contacts` (update, insert, upsert) cujo objeto:
// tem a chave `name`; tem chave computada; espalha algo (`...x`); ou nem é
// literal (`.update(patch)`), porque aí não há como ver as chaves. A classe
// de um objeto montado é lida nos ~1200 caracteres ANTES da cadeia.
// ============================================================

const SRC = path.resolve(__dirname, "..", "..");

type Classe = "respeita" | "grava" | "sem-marca";
type Op = "update" | "insert" | "upsert";

/** Manifesto: arquivo → cada escrita de nome dele, como `op:classe`, em ordem. */
const ESCRITORES: Record<string, string[]> = {
  // ---- Gente escrevendo o nome: grava a marca ----
  // O painel e a ficha só mandam o nome quando ele MUDOU (escritaDoNomeManual).
  "components/contacts/contact-detail-view.tsx": ["update:grava"],
  "components/contacts/contact-form.tsx": ["update:grava", "insert:grava"],
  "components/inbox/painel/painel-do-contato.tsx": ["update:grava"],
  // O nome digitado ao abrir conversa com um número novo.
  "app/api/cb/conversas/abrir/route.ts": ["insert:grava"],

  // ---- Fontes deliberadas: gravam a marca ----
  "lib/calendly/processar.ts": ["update:grava"],
  // O 1º é o ramo do NOME do `update_contact_field` (grava fixado, e valor que
  // não é nome não sobrescreve). O 2º é o mesmo passo para e-mail e empresa:
  // a chave computada ainda aparece, mas o nome já saiu antes dela.
  "lib/automations/engine.ts": ["update:grava", "update:sem-marca"],

  // ---- Automáticos, o nome do perfil do WhatsApp: respeitam no UPDATE ----
  // O INSERT cria a ficha com o nome do perfil (ou o telefone): nome que
  // ninguém escolheu, então nasce sem marca e a próxima mensagem pode trocar.
  "app/api/whatsapp/webhook/route.ts": ["update:respeita", "insert:sem-marca"],
  "lib/whatsapp/inbound-store.ts": ["update:respeita", "insert:sem-marca"],
  "lib/whatsapp/resolve-conversation.ts": ["update:respeita", "insert:sem-marca"],

  // ---- Sem marca, por enquanto SEM DECISÃO do operador (14/09/2026) ----
  // PATCH da API v1: o integrador troca o nome e não fixa. Deliberado, mas não
  // é "gente escrevendo à mão" — a decisão fica para quando houver integrador.
  "app/api/v1/contacts/[id]/route.ts": ["update:sem-marca"],
  // Criação pela API v1, pela importação de CSV (tela e disparo), pela
  // integração do Asaas e pelo `send_to_number`/webhook de entrada
  // (destinatario.ts): a ficha nasce com o nome da fonte, sem marca — como
  // era antes da 999. (O Calendly cria por destinatario.ts e FIXA logo em
  // seguida, em processar.ts.)
  "lib/api/v1/contacts.ts": ["insert:sem-marca"],
  "components/contacts/import-modal.tsx": ["insert:sem-marca", "insert:sem-marca"],
  "hooks/use-broadcast-sending.ts": ["insert:sem-marca"],
  "lib/asaas/criar-ficha.ts": ["insert:sem-marca"],
  "lib/automations/destinatario.ts": ["insert:sem-marca"],
  // O perfil do Instagram só preenche o nome quando a ficha NÃO TEM nenhum
  // (`nomeAtual ? null : …`): nunca sobrescreve um nome, fixado ou não.
  "lib/instagram/perfil.ts": ["update:sem-marca"],
};

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

const RESPEITA = /\.is\(\s*['"]nome_fixado_em['"]\s*,\s*null\s*\)/;
const GRAVA = /\bnome_fixado_em\s*:|marcaDoNomeManual\(|escritaDoNomeManual\(/;

function escritasDeNome(): Escrita[] {
  const achadas: Escrita[] = [];
  for (const abs of arquivos(SRC)) {
    const fonte = fs.readFileSync(abs, "utf8");
    const re = /from\(\s*['"]contacts['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      // A cadeia vai até a PRÓXIMA consulta (ou 1200 caracteres): sem o
      // corte, a guarda de outra cadeia logo abaixo faria esta passar.
      let fim = fonte.indexOf("from(", m.index + 5);
      if (fim === -1 || fim > m.index + 1200) fim = m.index + 1200;
      const cadeia = fonte.slice(m.index, fim);
      const op = cadeia.match(/\.(update|insert|upsert)\(\s*/);
      if (!op || op.index === undefined) continue;

      const argumento = cadeia.slice(op.index + op[0].length);
      const literal = objetoLiteral(argumento);
      const escreveNome =
        literal === null ||
        /(^|[\s,{])name\s*[:,}]/.test(literal) ||
        /\[[^\]]+\]\s*:/.test(literal) ||
        /\.\.\.\s*[\w(]/.test(literal);
      if (!escreveNome) continue;

      const respeita = RESPEITA.test(cadeia);
      // Objeto literal: a marca tem de estar NELE. Objeto montado: no trecho
      // que o monta, logo antes da cadeia.
      const onde = literal ?? fonte.slice(Math.max(0, m.index - 1200), m.index);
      const grava = GRAVA.test(onde);
      achadas.push({
        arquivo: path.relative(SRC, abs).split(path.sep).join("/"),
        linha: fonte.slice(0, m.index).split("\n").length,
        op: op[1] as Op,
        // As duas juntas não fazem sentido (gravar a marca só onde ela já é
        // nula) — quem aparecer assim reprova como classe nula.
        classe: respeita && grava ? null : respeita ? "respeita" : grava ? "grava" : "sem-marca",
      });
    }
  }
  return achadas;
}

describe("escritores de contacts.name × nome fixado (999)", () => {
  const achadas = escritasDeNome();

  it("CRÍTICO: nenhum escritor respeita E grava a marca ao mesmo tempo", () => {
    const soltos = achadas.filter((e) => e.classe === null).map((e) => `${e.arquivo}:${e.linha}`);
    expect(soltos).toEqual([]);
  });

  it("CRÍTICO: o conjunto de escritores é EXATO — escritor novo é decisão escrita neste arquivo", () => {
    const porArquivo: Record<string, string[]> = {};
    for (const e of achadas) (porArquivo[e.arquivo] ??= []).push(`${e.op}:${e.classe}`);
    // Quem aparecer aqui sem estar no manifesto ou troca o nome escolhido pelo
    // do perfil do WhatsApp, ou salva um nome deliberado que a mensagem
    // seguinte desfaz. Automático leva `.is('nome_fixado_em', null)`; gente e
    // fonte deliberada gravam a marca; o resto escreve o motivo acima.
    expect(porArquivo).toEqual(ESCRITORES);
  });

  it("o scanner enxerga chave computada, objeto montado e espalhamento (os pontos cegos da 1ª versão)", () => {
    const de = (arquivo: string) => achadas.filter((e) => e.arquivo === arquivo);
    // chave computada: o passo de automação
    expect(de("lib/automations/engine.ts").length).toBeGreaterThanOrEqual(2);
    // objeto montado: o PATCH da v1
    expect(de("app/api/v1/contacts/[id]/route.ts")).toHaveLength(1);
    // espalhamento: a ficha de /contatos
    expect(de("components/contacts/contact-detail-view.tsx")).toHaveLength(1);
  });
});
