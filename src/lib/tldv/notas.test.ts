import { describe, expect, it } from "vitest";

import { linhasDasNotas, partesDaLinha } from "./notas";

/** Trecho no FORMATO das notas de uma reunião (09/09/2026; dados trocados por fictícios), com os carimbos de tempo como link relativo. */
const NOTAS = `## 1. Resumo da situação

- Diego é de Cidade Exemplo e está enfrentando problemas com débitos [02:31](/app/meetings/000000000000000000000001?t=151)
- A primeira empresa, **Empresa Exemplo** (CNPJ 00000-000-0000), parou [03:05](/app/meetings/000000000000000000000001?t=185)

## 2. Problema
Texto solto com [link externo](https://exemplo.example/x) e [sem destino](javascript:void).`;

describe("linhasDasNotas", () => {
  it("separa título, itens e texto; o carimbo de tempo vira link para o app do tl;dv", () => {
    const linhas = linhasDasNotas(NOTAS);
    expect(linhas.map((l) => l.tipo)).toEqual(["titulo", "item", "item", "titulo", "texto"]);
    expect(linhas[0].partes).toEqual([{ texto: "1. Resumo da situação" }]);
    expect(linhas[1].partes).toEqual([
      { texto: "Diego é de Cidade Exemplo e está enfrentando problemas com débitos " },
      { texto: "02:31", href: "https://tldv.io/app/meetings/000000000000000000000001?t=151" },
    ]);
  });

  it("tira a ênfase `**` e mantém link absoluto; destino que não é http nem relativo vira só texto", () => {
    expect(partesDaLinha("**Empresa Exemplo** parou")).toEqual([{ texto: "Empresa Exemplo parou" }]);
    const ultima = linhasDasNotas(NOTAS).at(-1)!;
    expect(ultima.partes).toEqual([
      { texto: "Texto solto com " },
      { texto: "link externo", href: "https://exemplo.example/x" },
      { texto: " e " },
      { texto: "sem destino" },
      { texto: "." },
    ]);
  });

  it("linhas vazias somem; CRLF é aceito", () => {
    expect(linhasDasNotas("a\r\n\r\n- b\r\n")).toEqual([
      { tipo: "texto", partes: [{ texto: "a" }] },
      { tipo: "item", partes: [{ texto: "b" }] },
    ]);
  });
});
