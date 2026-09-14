import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Todo UPDATE que escreve `contacts.name` é ou DELIBERADO (gente, ou a fonte
// que fixa o nome) ou GUARDADO por `.is('nome_fixado_em', null)` (999).
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
// (`.update(patch)`) fica fora — é o caso do PATCH da API v1, que é
// deliberado, e do perfil do Instagram, que só preenche nome quando a ficha
// não tem nenhum (nunca sobrescreve).
// ============================================================

const SRC = path.resolve(__dirname, "..", "..");

type Classe = "deliberado" | "guardado";

/** Manifesto: arquivo → o que cada UPDATE de nome dele é. */
const ESCRITORES: Record<string, Classe[]> = {
  // Gente escolhendo o nome: pode trocar mesmo um nome fixado.
  "components/contacts/contact-detail-view.tsx": ["deliberado"],
  "components/contacts/contact-form.tsx": ["deliberado"],
  "components/inbox/painel/painel-do-contato.tsx": ["deliberado"],
  // A fonte que FIXA o nome (e grava a marca na mesma escrita).
  "lib/calendly/processar.ts": ["deliberado"],
  // Automáticos: o nome do perfil do WhatsApp. Guardados.
  "app/api/whatsapp/webhook/route.ts": ["guardado"],
  "lib/whatsapp/inbound-store.ts": ["guardado"],
  "lib/whatsapp/resolve-conversation.ts": ["guardado"],
};

const DELIBERADOS = new Set(
  Object.entries(ESCRITORES)
    .filter(([, cs]) => cs.every((c) => c === "deliberado"))
    .map(([a]) => a),
);

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
  guardada: boolean;
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
      achadas.push({
        arquivo: path.relative(SRC, abs).split(path.sep).join("/"),
        linha: fonte.slice(0, m.index).split("\n").length,
        guardada: /\.is\(\s*['"]nome_fixado_em['"]\s*,\s*null\s*\)/.test(cadeia),
      });
    }
  }
  return achadas;
}

describe("escritores de contacts.name × nome fixado (999)", () => {
  const achadas = escritasDeNome();

  it("CRÍTICO: todo escritor automático respeita o nome fixado", () => {
    const soltos = achadas
      .filter((e) => !e.guardada && !DELIBERADOS.has(e.arquivo))
      .map((e) => `${e.arquivo}:${e.linha}`);
    // Quem aparecer aqui troca o nome escolhido pelo do perfil do WhatsApp.
    // Ou leva `.is('nome_fixado_em', null)`, ou é gente e entra em ESCRITORES.
    expect(soltos).toEqual([]);
  });

  it("o conjunto de escritores é EXATO — escritor novo é decisão escrita neste arquivo", () => {
    const porArquivo: Record<string, Classe[]> = {};
    for (const e of achadas) {
      (porArquivo[e.arquivo] ??= []).push(e.guardada ? "guardado" : "deliberado");
    }
    expect(porArquivo).toEqual(ESCRITORES);
  });
});
