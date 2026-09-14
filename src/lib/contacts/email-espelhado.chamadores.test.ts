import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Tela que grava `contacts.email` só manda o e-mail quando ele MUDOU (1000).
//
// O e-mail é também o campo personalizado espelhado, que salva sozinho na
// ficha e no painel da conversa. Uma tela aberta sobre uma foto velha do
// contato (a lista de /contatos não recarrega; a ficha carrega uma vez) que
// mande o e-mail em TODO salvamento regrava o valor antigo por cima da edição
// feita pelo campo — e o gatilho leva o antigo de volta ao campo, em silêncio.
// A revisão do PR #210 achou isso no formulário "Editar", depois de a ficha já
// ter sido corrigida: são dois escritores, e consertar um não conserta o outro.
//
// Alcance: UPDATE em `contacts` com a chave `email` em `src/components`. Os
// escritores de servidor (API v1, automação, importação) gravam o que
// receberam, e não têm foto velha para regravar.
// ============================================================

const RAIZ = path.resolve(__dirname, "..", "..", "components");

function arquivos(dir: string, fora: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivos(p, fora);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) fora.push(p);
  }
  return fora;
}

describe("telas que gravam contacts.email × campo espelhado (1000)", () => {
  const escritas: { arquivo: string; condicional: boolean }[] = [];
  for (const abs of arquivos(RAIZ)) {
    const fonte = fs.readFileSync(abs, "utf8");
    const re = /from\(\s*['"]contacts['"]\s*\)\s*\.update\(\s*\{([\s\S]*?)\}\s*\)\s*\./g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      if (!/(^|[\s,{])email\s*[:,}]/.test(m[1])) continue;
      escritas.push({
        arquivo: path.relative(RAIZ, abs).split(path.sep).join("/"),
        // Direto (`emailMudou(...) ? { email } : {}`) ou pela variável que o
        // guarda antes do UPDATE (`const mudouEmail = emailMudou(...)`).
        condicional: /emailMudou\(|mudouEmail\s*\?/.test(m[1]) && /emailMudou\(/.test(fonte),
      });
    }
  }

  it("CRÍTICO: nenhuma tela manda o e-mail sem conferir que ele mudou", () => {
    expect(escritas.filter((e) => !e.condicional).map((e) => e.arquivo)).toEqual([]);
  });

  it("o scanner acha os dois escritores conhecidos (ficha e formulário)", () => {
    expect(escritas.map((e) => e.arquivo).sort()).toEqual([
      "contacts/contact-detail-view.tsx",
      "contacts/contact-form.tsx",
    ]);
  });
});
