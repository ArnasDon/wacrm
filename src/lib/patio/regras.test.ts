import { describe, it, expect } from "vitest";
import { avaliar, frase, validar, type Regra } from "./regras";

const regra = (o: Partial<Regra>): Regra => ({ id: "r", nome: "R", ativo: true, gatilho: "carro", condicoes: [], acoes: [{ tipo: "alerta_hoje" }], ...o });

describe("regras", () => {
  const itens = {
    carro: [
      { id: "a", nome: "Song", href: "/patio/a", valores: { dias_no_patio: 60, conversas_30d: 0, tem_anuncio: 0 } },
      { id: "b", nome: "Nivus", href: "/patio/b", valores: { dias_no_patio: 20, conversas_30d: 5, tem_anuncio: 1 } },
    ],
    campanha: [{ id: "c", nome: "Hilux", href: "/trafego/campanhas", valores: { carro_vendido: 1, gasto: 100 } }],
    conversa: [],
  };
  it("todas as condições precisam bater", () => {
    const r = avaliar([regra({ condicoes: [{ campo: "dias_no_patio", op: ">", valor: 45 }, { campo: "conversas_30d", op: "=", valor: 0 }] })], itens);
    expect(r).toHaveLength(1);
    expect(r[0].itens.map((i) => i.id)).toEqual(["a"]);
  });
  it("regra desligada ou sem condição não dispara", () => {
    expect(avaliar([regra({ ativo: false, condicoes: [{ campo: "dias_no_patio", op: ">", valor: 1 }] }), regra({})], itens)).toEqual([]);
  });
  it("campo sem valor não dispara", () => {
    expect(avaliar([regra({ condicoes: [{ campo: "preco", op: ">", valor: 1 }] })], itens)).toEqual([]);
  });
  it("campanhas de carro vendido", () => {
    const r = avaliar([regra({ gatilho: "campanha", condicoes: [{ campo: "carro_vendido", op: "=", valor: 1 }, { campo: "gasto", op: ">=", valor: 50 }] })], itens);
    expect(r[0].itens[0].id).toBe("c");
  });
  it("frase e validação", () => {
    expect(frase(regra({ condicoes: [{ campo: "dias_no_patio", op: ">", valor: 45 }] }))).toBe("Quando um carro do pátio tiver dias no pátio maior que 45: avisar em Hoje.");
    expect(validar({ nome: "", gatilho: "carro" })).toMatchObject({ ok: false });
    expect(validar({ nome: "x", gatilho: "carro", condicoes: [{ campo: "inventado", op: ">", valor: 1 }], acoes: [{ tipo: "alerta_hoje" }] })).toMatchObject({ ok: false });
    expect(validar({ nome: "x", gatilho: "carro", condicoes: [{ campo: "dias_no_patio", op: ">", valor: "45" as unknown as number }], acoes: [{ tipo: "whatsapp_grupo", grupo: "" }] })).toMatchObject({ ok: false });
    const v = validar({ nome: " Parado ", gatilho: "carro", condicoes: [{ campo: "dias_no_patio", op: ">", valor: "45" as unknown as number }], acoes: [{ tipo: "alerta_hoje" }] });
    expect(v).toMatchObject({ ok: true, regra: { nome: "Parado", condicoes: [{ valor: 45 }] } });
  });
});
