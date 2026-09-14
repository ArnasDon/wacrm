import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Todo UPDATE que escreve `contacts.name` ou RESPEITA a marca
// (`.is('nome_fixado_em', null)`, os caminhos automáticos) ou a GRAVA junto
// (o agendamento do Calendly e as três telas onde gente escreve o nome — a
// escrita à mão também fixa, decisão do operador em 14/09/2026). Não existe
// terceira categoria: um escritor que não faz nenhum dos dois ou desfaz o nome
// escolhido, ou deixa o nome que gente corrigiu voltar a ser o do WhatsApp.
//
// Até a 999, três caminhos automáticos trocavam o nome da ficha pelo do
// perfil do WhatsApp a cada mensagem — e com isso o nome que o cliente
// digitou no agendamento do Calendly durava até a mensagem seguinte dele,
// que costuma vir logo depois de agendar. A guarda mora dentro do UPDATE, e
// nada no typecheck nem no comportamento de um teste unitário acusa quando
// ela some.
//
// Por que estrutural: o webhook da Meta é arquivo do UPSTREAM, e o bloco que
// renomeia é dele — um merge que o traga cru apaga a guarda em silêncio. E
// quem escrever um quarto caminho automático de nome (outro transporte, outra
// integração) precisa decidir por escrito se ele respeita a marca.
//
// Como funciona: o conjunto de escritores é EXATO (deep-equal). Escritor novo
// entra aqui por decisão visível no diff.
//
// ⚠️ Alcance: acha `.update({ ... name ... })` com objeto LITERAL numa cadeia
// que parte de `from('contacts')`. UPDATE por objeto montado antes
// (`.update(patch)`) fica fora — é o caso do PATCH da API v1 (integrador, não
// grava a marca; hoje sem decisão) e do perfil do Instagram, que só preenche
// nome quando a ficha não tem nenhum (nunca sobrescreve). INSERT também fica
// fora: criar a ficha com o nome do WhatsApp é o comportamento certo — só o
// formulário de contato grava a marca na criação.
// ============================================================

const SRC = path.resolve(__dirname, "..", "..");

type Classe = "respeita" | "grava";

/** Manifesto: arquivo → o que cada UPDATE de nome dele faz com a marca. */
const ESCRITORES: Record<string, Classe[]> = {
  // Gente escrevendo o nome: grava a marca (só quando o nome mudou).
  "components/contacts/contact-detail-view.tsx": ["grava"],
  "components/contacts/contact-form.tsx": ["grava"],
  "components/inbox/painel/painel-do-contato.tsx": ["grava"],
  // O agendamento do Calendly: a fonte que fixa o nome.
  "lib/calendly/processar.ts": ["grava"],
  // Automáticos, o nome do perfil do WhatsApp: respeitam.
  "app/api/whatsapp/webhook/route.ts": ["respeita"],
  "lib/whatsapp/inbound-store.ts": ["respeita"],
  "lib/whatsapp/resolve-conversation.ts": ["respeita"],
};

function arquivos(dir: string, fora: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivos(p, fora);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) fora.push(p);
  }
  return fora;
}

interface Escrita {
  arquivo: string;
  linha: number;
  classe: Classe | null;
}

function escritasDeNome(): Escrita[] {
  const achadas: Escrita[] = [];
  for (const abs of arquivos(SRC)) {
    const fonte = fs.readFileSync(abs, "utf8");
    const re = /from\(\s*['"]contacts['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      // A cadeia vai até a PRÓXIMA consulta (ou 500 caracteres): sem o corte,
      // a guarda de outra cadeia logo abaixo faria esta passar.
      let fim = fonte.indexOf("from(", m.index + 5);
      if (fim === -1 || fim > m.index + 500) fim = m.index + 500;
      const cadeia = fonte.slice(m.index, fim);
      const op = cadeia.match(/\.update\(\s*\{([\s\S]*?)\}\s*\)/);
      if (!op || !/(^|[\s,{])name\s*[:,}]/.test(op[1])) continue;
      const respeita = /\.is\(\s*['"]nome_fixado_em['"]\s*,\s*null\s*\)/.test(cadeia);
      const grava = /\bnome_fixado_em\s*:|\.\.\.\s*marcaDoNomeManual\(/.test(op[1]);
      achadas.push({
        arquivo: path.relative(SRC, abs).split(path.sep).join("/"),
        linha: fonte.slice(0, m.index).split("\n").length,
        // As duas juntas não fazem sentido (gravar a marca só onde ela já é
        // nula) — quem aparecer assim reprova como classe nula.
        classe: respeita === grava ? null : respeita ? "respeita" : "grava",
      });
    }
  }
  return achadas;
}

describe("escritores de contacts.name × nome fixado (999)", () => {
  const achadas = escritasDeNome();

  it("CRÍTICO: todo escritor de nome ou respeita a marca ou a grava", () => {
    const soltos = achadas.filter((e) => e.classe === null).map((e) => `${e.arquivo}:${e.linha}`);
    // Quem aparecer aqui ou troca o nome escolhido pelo do perfil do WhatsApp,
    // ou salva um nome à mão que a mensagem seguinte desfaz. Automático leva
    // `.is('nome_fixado_em', null)`; gente espalha `marcaDoNomeManual(...)`.
    expect(soltos).toEqual([]);
  });

  it("o conjunto de escritores é EXATO — escritor novo é decisão escrita neste arquivo", () => {
    const porArquivo: Record<string, (Classe | null)[]> = {};
    for (const e of achadas) (porArquivo[e.arquivo] ??= []).push(e.classe);
    expect(porArquivo).toEqual(ESCRITORES);
  });
});
