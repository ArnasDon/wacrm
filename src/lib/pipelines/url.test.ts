import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  lerUrlDoFunil,
  origemDoConstrutor,
  urlDoConstrutor,
  voltaDoConstrutor,
} from "./url";

/** A query de uma URL montada, como o `useSearchParams()` a entregaria. */
const query = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");

describe("urlDoConstrutor", () => {
  it("sem origem, as URLs de sempre", () => {
    expect(urlDoConstrutor({})).toBe("/automations/new");
    expect(urlDoConstrutor({ etapa: "s1" })).toBe("/automations/new?stage=s1");
    expect(urlDoConstrutor({ id: "a1" })).toBe("/automations/a1/edit");
  });

  it("com origem, carrega de=funil e o funil", () => {
    const origem = { funil: "p1" };
    expect(urlDoConstrutor({ etapa: "s1", origem })).toBe(
      "/automations/new?stage=s1&de=funil&funil=p1",
    );
    expect(urlDoConstrutor({ id: "a1", origem })).toBe(
      "/automations/a1/edit?de=funil&funil=p1",
    );
  });

  it("origem sem funil ainda marca de=funil", () => {
    expect(urlDoConstrutor({ id: "a1", origem: { funil: null } })).toBe(
      "/automations/a1/edit?de=funil",
    );
  });

  it("⚠️ id VENCE etapa — a tela de edição não lê `stage`", () => {
    expect(urlDoConstrutor({ id: "a1", etapa: "s1", origem: { funil: "p1" } })).toBe(
      "/automations/a1/edit?de=funil&funil=p1",
    );
  });

  it("valores passam por encodeURIComponent", () => {
    expect(urlDoConstrutor({ etapa: "a&b", origem: { funil: "c d" } })).toBe(
      "/automations/new?stage=a%26b&de=funil&funil=c%20d",
    );
  });
});

describe("origemDoConstrutor", () => {
  it("só de=funil conta como origem", () => {
    expect(origemDoConstrutor(query("/x?de=funil&funil=p1"))).toEqual({ funil: "p1" });
    expect(origemDoConstrutor(query("/x?de=funil"))).toEqual({ funil: null });
    expect(origemDoConstrutor(query("/x?de=funil&funil="))).toEqual({ funil: null });
    expect(origemDoConstrutor(query("/x?funil=p1"))).toBeNull();
    expect(origemDoConstrutor(query("/x?de=inbox&funil=p1"))).toBeNull();
    expect(origemDoConstrutor(query("/x"))).toBeNull();
  });
});

describe("voltaDoConstrutor", () => {
  it("sem origem, a tela de Automações — o comportamento de sempre", () => {
    expect(voltaDoConstrutor(null)).toBe("/automations");
  });

  it("do funil, a aba de automações do MESMO funil", () => {
    expect(voltaDoConstrutor({ funil: "p1" })).toBe("/pipelines?vista=automacoes&funil=p1");
    expect(voltaDoConstrutor({ funil: null })).toBe("/pipelines?vista=automacoes");
  });
});

describe("lerUrlDoFunil", () => {
  it("aceita as abas que existem e nada mais", () => {
    expect(lerUrlDoFunil(query("/pipelines?vista=saude"))).toEqual({ funil: null, vista: "saude" });
    expect(lerUrlDoFunil(query("/pipelines?vista=kanban"))).toEqual({ funil: null, vista: null });
    expect(lerUrlDoFunil(query("/pipelines?funil="))).toEqual({ funil: null, vista: null });
    expect(lerUrlDoFunil(query("/pipelines"))).toEqual({ funil: null, vista: null });
  });
});

describe("a jornada inteira, pelos dois lados de cada URL", () => {
  // O elo entre quem ESCREVE e quem LÊ é o nome do parâmetro: um erro de
  // digitação num lado não estoura em lugar nenhum — o voltar só passaria a
  // cair na tela de Automações de novo.
  it("grade → construtor → (criar) → edição → funil, sem perder a origem", () => {
    const origem = { funil: "p 1" };

    const aoCriar = urlDoConstrutor({ etapa: "s1", origem });
    const lidaNaCriacao = origemDoConstrutor(query(aoCriar));
    expect(lidaNaCriacao).toEqual(origem);

    // O `router.replace` depois de salvar o rascunho.
    const aoEditar = urlDoConstrutor({ id: "a1", origem: lidaNaCriacao });
    const lidaNaEdicao = origemDoConstrutor(query(aoEditar));
    expect(lidaNaEdicao).toEqual(origem);

    expect(lerUrlDoFunil(query(voltaDoConstrutor(lidaNaEdicao)))).toEqual({
      funil: "p 1",
      vista: "automacoes",
    });
  });
});

describe("pino: quem abre e quem fecha o construtor passa por aqui", () => {
  // Um merge do upstream devolve o `router.push("/automations")` cru ao
  // construtor sem conflito nenhum — e o voltar volta a esquecer o funil.
  const fonte = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

  it("o construtor volta e se reescreve pela origem", () => {
    const construtor = fonte("src/components/automations/automation-builder.tsx");
    expect(construtor).toContain("voltaDoConstrutor(origem)");
    expect(construtor).toContain("urlDoConstrutor({ id: body.automation.id, origem })");
    expect(construtor).not.toContain('router.push("/automations")');
  });

  it("a tela de edição que falhou ao carregar também", () => {
    const edicao = fonte("src/app/(dashboard)/automations/[id]/edit/page.tsx");
    expect(edicao).toContain("voltaDoConstrutor(origem)");
    expect(edicao).not.toContain('router.push("/automations")');
  });

  it("a grade do funil abre o construtor COM a origem", () => {
    const grade = fonte("src/components/pipelines/automations-board.tsx");
    expect(grade.match(/urlDoConstrutor\(\{[^}]*origem/g)).toHaveLength(2);
    expect(grade).not.toContain("router.push(`/automations");
  });
});
