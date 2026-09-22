import { describe, expect, it } from "vitest";

import {
  decidir,
  elegivel,
  mesmosCandidatos,
  montarIndices,
  situacaoDoCliente,
  telefonesUteis,
  type ClienteParaVincular,
  type FichaDoCrm,
} from "./vinculo";

function cliente(extra: Partial<ClienteParaVincular>): ClienteParaVincular {
  return {
    asaas_customer_id: "cus_1",
    nome: "Maria Aparecida Silva",
    cpf_cnpj: "12345678901",
    email: null,
    celular: null,
    telefone: null,
    contact_id: null,
    vinculo_origem: null,
    contatos_recusados: [],
    candidatos: [],
    deleted: false,
    ...extra,
  };
}

const FICHAS: FichaDoCrm[] = [
  { id: "maria", nome: "Maria Silva", telefone: "5583980000016", email: null },
  // gravada SEM o nono dígito, com o número como nome (203 fichas assim na conta)
  { id: "numerica-sem-9", nome: "558380000099", telefone: "558380000099", email: null },
  { id: "joao", nome: "João Pedro Souza", telefone: "5583999990000", email: "joao@x.com" },
  { id: "ana", nome: "Ana Souza", telefone: "5511911112222", email: null },
  // outro DDD, mesmos 8 últimos dígitos da Maria
  { id: "sufixo", nome: "Outra Pessoa", telefone: "5521980000016", email: null },
  // a mesma pessoa gravada duas vezes, com e sem o 9
  { id: "dup-com-9", nome: "Pedro Dup", telefone: "5583977770000", email: null },
  { id: "dup-sem-9", nome: "Pedro Dup", telefone: "558377770000", email: null },
];

function indices(extra: { calendly?: Map<string, Set<string>>; conexoes?: string[]; ligados?: Parameters<typeof montarIndices>[3] } = {}) {
  return montarIndices(FICHAS, extra.calendly ?? new Map(), extra.conexoes ?? [], extra.ligados ?? []);
}

describe("elegível", () => {
  it("só quem não tem contato e cuja origem é nula ou da regra (criada inclusive)", () => {
    expect(elegivel(cliente({}))).toBe(true);
    expect(elegivel(cliente({ vinculo_origem: "telefone" }))).toBe(true);
    expect(elegivel(cliente({ vinculo_origem: "criada" }))).toBe(true);
    expect(elegivel(cliente({ vinculo_origem: "manual" }))).toBe(false);
    expect(elegivel(cliente({ vinculo_origem: "desvinculado" }))).toBe(false);
    expect(elegivel(cliente({ contact_id: "maria" }))).toBe(false);
    expect(elegivel(cliente({ deleted: true }))).toBe(false);
  });
});

describe("decidir — os sinais fortes", () => {
  it("telefone idêntico liga", () => {
    expect(decidir(cliente({ celular: "5583980000016" }), indices())).toEqual({ acao: "ligar", contactId: "maria", origem: "telefone" });
  });

  it("a irmã do nono dígito também é 'telefone' — nos dois sentidos", () => {
    const idx = montarIndices([{ id: "sem9", nome: "Maria Silva", telefone: "558380000016", email: null }], new Map(), [], []);
    expect(decidir(cliente({ celular: "5583980000016" }), idx)).toEqual({ acao: "ligar", contactId: "sem9", origem: "telefone" });
    const idx2 = montarIndices([{ id: "com9", nome: "Maria Silva", telefone: "5583980000016", email: null }], new Map(), [], []);
    expect(decidir(cliente({ celular: "558380000016" }), idx2)).toEqual({ acao: "ligar", contactId: "com9", origem: "telefone" });
  });

  it("duas fichas pelo telefone (com e sem o 9) é ambíguo, nunca vínculo", () => {
    const d = decidir(cliente({ celular: "5583977770000", nome: "Pedro Dup" }), indices());
    expect(d.acao).toBe("confirmar");
    if (d.acao === "confirmar") {
      expect(d.candidatos.map((k) => k.contact_id).sort()).toEqual(["dup-com-9", "dup-sem-9"]);
      expect(d.candidatos.map((k) => k.motivo)).toEqual(["ambiguo", "ambiguo"]);
    }
  });

  it("documento igual ao de um cliente já ligado liga ao mesmo contato (cadastro duplicado no Asaas)", () => {
    const idx = indices({ ligados: [{ asaas_customer_id: "cus_0", nome: "Maria A Silva", cpf_cnpj: "12345678901", contact_id: "maria" }] });
    expect(decidir(cliente({ asaas_customer_id: "cus_1" }), idx)).toEqual({ acao: "ligar", contactId: "maria", origem: "cpf" });
  });

  it("e-mail da ficha liga; sem ficha com o e-mail, a ponte do Calendly liga", () => {
    expect(decidir(cliente({ email: "joao@x.com", nome: "João Pedro Souza" }), indices())).toEqual({ acao: "ligar", contactId: "joao", origem: "email" });
    const calendly = new Map([["ana@y.com", new Set(["ana"])]]);
    expect(decidir(cliente({ email: "ana@y.com", nome: "Ana Souza" }), indices({ calendly }))).toEqual({ acao: "ligar", contactId: "ana", origem: "email" });
  });

  it("telefone dizendo A e e-mail dizendo B é conflito: pergunta com os dois", () => {
    const d = decidir(cliente({ celular: "5583980000016", email: "joao@x.com" }), indices());
    expect(d.acao).toBe("confirmar");
    if (d.acao === "confirmar") {
      expect(d.candidatos.map((k) => k.contact_id).sort()).toEqual(["joao", "maria"]);
      expect(d.candidatos.every((k) => k.motivo === "conflito")).toBe(true);
    }
  });
});

describe("decidir — as cercas", () => {
  it("contato desligado por gente nunca volta pela regra — nem como sugestão", () => {
    // Sem a recusa, a Maria ligaria pelo telefone. Recusada, sobra só o sufixo
    // de outro DDD como SUGESTÃO — e a própria Maria não aparece nem ali.
    const d = decidir(cliente({ celular: "5583980000016", contatos_recusados: ["maria"] }), indices());
    expect(d).toEqual({ acao: "confirmar", candidatos: [{ contact_id: "sufixo", motivo: "sufixo" }] });
    const d2 = decidir(cliente({ celular: "5583980000016", contatos_recusados: ["maria", "sufixo"] }), indices());
    expect(d2).toEqual({ acao: "criar", telefone: "5583980000016" });
  });

  it("um contato, um CPF: contato já ligado a outro cliente de documento diferente vira pergunta", () => {
    const idx = indices({ ligados: [{ asaas_customer_id: "cus_0", nome: "Empresa Ltda", cpf_cnpj: "11222333000181", contact_id: "maria" }] });
    const d = decidir(cliente({ celular: "5583980000016" }), idx);
    expect(d).toEqual({ acao: "confirmar", candidatos: [{ contact_id: "maria", motivo: "contato_ja_ligado" }] });
  });

  it("mesmo cliente do Asaas já ligado ao contato (recomputo) não é 'contato já ligado'", () => {
    const idx = indices({ ligados: [{ asaas_customer_id: "cus_1", nome: "Maria", cpf_cnpj: "12345678901", contact_id: "maria" }] });
    expect(decidir(cliente({ celular: "5583980000016" }), idx)).toEqual({ acao: "ligar", contactId: "maria", origem: "telefone" });
  });

  it("a esposa que paga a conta: telefone bate, nome de gente não compartilha nada → pergunta", () => {
    const d = decidir(cliente({ celular: "5583999990000", nome: "Carla Mendes Lima" }), indices());
    expect(d).toEqual({ acao: "confirmar", candidatos: [{ contact_id: "joao", motivo: "nome_diferente" }] });
  });

  it("ficha de nome numérico não aciona a cerca do nome", () => {
    expect(decidir(cliente({ celular: "5583980000099", nome: "Carla Mendes Lima" }), indices())).toEqual({
      acao: "ligar",
      contactId: "numerica-sem-9",
      origem: "telefone",
    });
  });

  it("telefone igual ao de uma conexão da conta não liga nem cria ficha", () => {
    const idx = indices({ conexoes: ["+55 83 98000-0016"] });
    const d = decidir(cliente({ celular: "5583980000016" }), idx);
    expect(d.acao).toBe("sem_ficha");
    expect(telefonesUteis({ celular: "5583980000016", telefone: null }, idx.telefonesDasConexoes)).toEqual([]);
  });
});

describe("decidir — sugestões e criação", () => {
  it("só o sufixo de 8 batendo vira sugestão, nunca vínculo nem ficha nova", () => {
    const d = decidir(cliente({ celular: "5531980000016", nome: "Fulano de Tal" }), indices());
    expect(d.acao).toBe("confirmar");
    if (d.acao === "confirmar") expect(d.candidatos.map((k) => k.contact_id).sort()).toEqual(["maria", "sufixo"]);
  });

  it("com telefone e sem ninguém parecido: cria a ficha (D2), pelo celular", () => {
    expect(decidir(cliente({ celular: "5584900001111", telefone: "5584300001111" }), indices())).toEqual({ acao: "criar", telefone: "5584900001111" });
  });

  it("origem 'criada' sem ficha sobrevivente NÃO recria: vai para 'Sem ficha' sem sugestão", () => {
    expect(decidir(cliente({ celular: "5584900001111", vinculo_origem: "criada" }), indices())).toEqual({ acao: "sem_ficha", candidatos: [] });
  });

  it("origem 'telefone'/'cpf'/'email' com a ficha APAGADA também não recria: a decisão de gente foi tirar", () => {
    expect(decidir(cliente({ celular: "5584900001111", vinculo_origem: "telefone" }), indices())).toEqual({ acao: "sem_ficha", candidatos: [] });
    expect(decidir(cliente({ celular: "5584900001111", vinculo_origem: "email" }), indices())).toEqual({ acao: "sem_ficha", candidatos: [] });
    // e a sugestão por nome também não volta para ela
    expect(decidir(cliente({ nome: "Maria Aparecida Silva", vinculo_origem: "cpf" }), indices())).toEqual({ acao: "sem_ficha", candidatos: [] });
  });

  it("origem 'criada' ainda liga pelo telefone à ficha sobrevivente (fusão)", () => {
    expect(decidir(cliente({ celular: "5583980000016", vinculo_origem: "criada" }), indices())).toEqual({ acao: "ligar", contactId: "maria", origem: "telefone" });
  });

  it("sem telefone nenhum: só o nome aproximado, como sugestão pontuada", () => {
    const d = decidir(cliente({ nome: "Maria Aparecida Silva" }), indices());
    expect(d).toEqual({ acao: "sem_ficha", candidatos: [{ contact_id: "maria", motivo: "nome_aproximado", pontuacao: 1 }] });
  });

  it("sugestão por nome respeita os recusados", () => {
    expect(decidir(cliente({ nome: "Maria Aparecida Silva", contatos_recusados: ["maria"] }), indices())).toEqual({ acao: "sem_ficha", candidatos: [] });
  });

  it("não elegível é 'nada'", () => {
    expect(decidir(cliente({ contact_id: "maria" }), indices())).toEqual({ acao: "nada" });
    expect(decidir(cliente({ vinculo_origem: "manual" }), indices())).toEqual({ acao: "nada" });
  });
});

describe("situacaoDoCliente", () => {
  it("ligado, ignorado, manual órfão e os dois de candidatos", () => {
    expect(situacaoDoCliente(cliente({ contact_id: "x" }))).toBe("ligado");
    expect(situacaoDoCliente(cliente({ vinculo_origem: "desvinculado" }))).toBe("ignorado");
    expect(situacaoDoCliente(cliente({ vinculo_origem: "manual" }))).toBe("confirmar");
    expect(situacaoDoCliente(cliente({ candidatos: [{ contact_id: "a", motivo: "sufixo" }] }))).toBe("confirmar");
    expect(situacaoDoCliente(cliente({ candidatos: [{ contact_id: "a", motivo: "nome_aproximado", pontuacao: 1 }] }))).toBe("sem_ficha");
    expect(situacaoDoCliente(cliente({}))).toBe("sem_ficha");
  });
});

describe("mesmosCandidatos", () => {
  it("compara como conjunto", () => {
    const a = [{ contact_id: "1", motivo: "sufixo" as const }, { contact_id: "2", motivo: "nome_aproximado" as const, pontuacao: 0.5 }];
    expect(mesmosCandidatos(a, [...a].reverse())).toBe(true);
    expect(mesmosCandidatos(a, [a[0]])).toBe(false);
    expect(mesmosCandidatos(a, [a[0], { ...a[1], pontuacao: 0.6 }])).toBe(false);
  });
});
