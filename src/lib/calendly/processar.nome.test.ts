import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// O NOME DO AGENDAMENTO VIRA O NOME DA FICHA E DO NEGÓCIO (999, decisão do
// operador em 14/09/2026).
//
// O cliente muitas vezes fala pelo celular da empresa: o perfil do WhatsApp
// diz o nome da empresa, e quem agendou é a pessoa. O caso da tela: o card do
// funil dizia "Douglas" (o nome do agendamento, pelo `{{vars.agendamento_nome}}`
// do passo create_deal) e a conversa dizia "DOUGLAS BARBOSA" (o perfil).
// ============================================================

const busca = vi.hoisted(() => ({ findExistingContact: vi.fn() }));
vi.mock("@/lib/contacts/dedupe", () => busca);

const ordem = vi.hoisted(() => [] as string[]);
const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);

const destino = vi.hoisted(() => ({ resolverDestinatario: vi.fn() }));
vi.mock("@/lib/automations/destinatario", () => destino);

import { comAvisoDoNome, processarAgendamento } from "./processar";
import { EVENTO_AGENDADO, type Agendamento } from "./payload";

const AGENDAMENTO: Agendamento = {
  evento: EVENTO_AGENDADO,
  inviteeUri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  eventoUri: "https://api.calendly.com/event_types/T1",
  eventoNome: "Reunião com Advogado",
  eventoAgendadoUri: null,
  nome: "Douglas Barbosa",
  email: null,
  telefone: "5562993798909",
  telefoneOrigem: "sms",
  inicio: "2026-09-09T13:45:00Z",
  fim: null,
  link: null,
  local: null,
  cancelarUrl: null,
  remarcarUrl: null,
  reagendado: false,
  fusoDoConvidado: null,
  perguntas: [],
};

interface Escrita {
  tabela: string;
  valores: Record<string, unknown>;
  filtros: [string, unknown][];
}

interface Consulta {
  tabela: string;
  filtros: [string, unknown][];
  ordem: [string, unknown][];
  limite: number | null;
}

let escritas: Escrita[] = [];
let consultas: Consulta[] = [];
let erroPorTabela: Record<string, { message: string } | null> = {};
/** O negócio aberto mais recente que a busca do card devolve. */
let cardAberto: { id: string } | null = { id: "deal-recente" };
let erroNaBuscaDoCard: { message: string } | null = null;
const ESCUTA = [{ trigger_type: "calendly_booking", trigger_config: {}, is_active: true }];
let automacoes: unknown[] = ESCUTA;

const admin = {
  from(tabela: string) {
    let escrita: Escrita | null = null;
    const consulta: Consulta = { tabela, filtros: [], ordem: [], limite: null };
    const b: Record<string, unknown> = {
      select: () => {
        consultas.push(consulta);
        return b;
      },
      update: (valores: Record<string, unknown>) => {
        escrita = { tabela, valores, filtros: [] };
        escritas.push(escrita);
        ordem.push(`update:${tabela}`);
        return b;
      },
      eq: (coluna: string, valor: unknown) => {
        (escrita ? escrita.filtros : consulta.filtros).push([coluna, valor]);
        return b;
      },
      order: (coluna: string, opcoes: unknown) => {
        consulta.ordem.push([coluna, opcoes]);
        return b;
      },
      limit: (n: number) => {
        consulta.limite = n;
        return b;
      },
      maybeSingle: async () =>
        tabela === "deals"
          ? { data: erroNaBuscaDoCard ? null : cardAberto, error: erroNaBuscaDoCard }
          : { data: { id: "conv-1", channel_id: "canal-1" }, error: null },
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve(
          escrita
            ? { data: null, error: erroPorTabela[tabela] ?? null }
            : { data: tabela === "automations" ? automacoes : [], error: null },
        ).then(f),
    };
    return b;
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  escritas = [];
  consultas = [];
  erroPorTabela = {};
  cardAberto = { id: "deal-recente" };
  erroNaBuscaDoCard = null;
  automacoes = ESCUTA;
  ordem.length = 0;
  busca.findExistingContact.mockReset().mockResolvedValue({ contato: { id: "c1", phone: "5562993798909" }, falhou: false });
  destino.resolverDestinatario.mockReset().mockResolvedValue({ contactId: "novo-1", conversationId: "conv-nova", criouContato: true });
  motor.dispararAutomacoes.mockReset().mockImplementation(async () => {
    ordem.push("disparo");
    return { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 };
  });
});

const daTabela = (t: string) => escritas.filter((e) => e.tabela === t);

describe("processarAgendamento — o nome do agendamento", () => {
  it("CRÍTICO: grava o nome na ficha JUNTO com a marca que o protege do WhatsApp", async () => {
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    const [ficha] = daTabela("contacts");
    expect(ficha.valores.name).toBe("Douglas Barbosa");
    // Sem a marca, a próxima mensagem do cliente devolveria o nome do perfil.
    expect(typeof ficha.valores.nome_fixado_em).toBe("string");
    expect(ficha.filtros).toEqual([
      ["id", "c1"],
      ["account_id", "acct-1"],
    ]);
  });

  it("CRÍTICO: renomeia SÓ o negócio ABERTO do contato — o card fechado pode ser de outra pessoa", async () => {
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    const busca = consultas.find((c) => c.tabela === "deals");
    expect(busca?.filtros).toEqual([
      ["account_id", "acct-1"],
      ["contact_id", "c1"],
      ["status", "open"],
    ]);
    const [negocio] = daTabela("deals");
    expect(negocio.valores).toEqual({ title: "Douglas Barbosa" });
    expect(negocio.filtros).toContainEqual(["status", "open"]);
  });

  it("CRÍTICO: com MAIS DE UM negócio aberto, renomeia só o mais RECENTE — o título que o advogado escreveu noutro funil fica", async () => {
    // Revisão do PR #208: o UPDATE por contato trocava TODOS os títulos
    // abertos, e a trilha da 912 não guarda título. A régua é a de
    // `negocioAlvo` (engine.ts): o aberto mais recente, UM.
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    const busca = consultas.find((c) => c.tabela === "deals");
    expect(busca?.ordem).toEqual([["created_at", { ascending: false }]]);
    expect(busca?.limite).toBe(1);
    const escritasDeCard = daTabela("deals");
    expect(escritasDeCard).toHaveLength(1);
    expect(escritasDeCard[0].filtros).toEqual([
      ["id", "deal-recente"],
      ["account_id", "acct-1"],
      ["status", "open"],
    ]);
  });

  it("contato sem negócio aberto: nada a renomear, e nada a avisar", async () => {
    cardAberto = null;
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(daTabela("deals")).toEqual([]);
    expect(r.detalhe).not.toContain("·");
  });

  it("falha ao BUSCAR o negócio vira aviso, sem renomear nada nem derrubar o disparo", async () => {
    erroNaBuscaDoCard = { message: "timeout" };
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("disparado");
    expect(daTabela("deals")).toEqual([]);
    expect(r.detalhe).toContain("o título do negócio não foi atualizado");
  });

  it("CRÍTICO: a FICHA antes do disparo (a automação fala com o nome novo), o CARD depois", async () => {
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(ordem).toEqual(["update:contacts", "disparo", "update:deals"]);
  });

  it("CRÍTICO: o card que a PRÓPRIA automação cria (create_deal) também sai com o nome do agendamento", async () => {
    // O caso do Codex no PR #208: contato sem card, o `create_deal` do disparo
    // cria o card com o título configurado no passo — que é livre. Renomeando
    // antes, o UPDATE não achava card nenhum e o novo nascia com outro nome.
    busca.findExistingContact.mockResolvedValue({ contato: null, falhou: false });
    let cardsNoBanco = 0;
    motor.dispararAutomacoes.mockImplementation(async () => {
      cardsNoBanco = 1; // o passo create_deal gravou o card, com o título dele
      ordem.push("disparo");
      return { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 };
    });

    await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    const iDisparo = ordem.indexOf("disparo");
    const iCard = ordem.indexOf("update:deals");
    expect(cardsNoBanco).toBe(1);
    expect(iCard).toBeGreaterThan(iDisparo);
    expect(consultas.find((c) => c.tabela === "deals")?.filtros).toContainEqual(["contact_id", "novo-1"]);
    expect(daTabela("deals")[0]).toMatchObject({ valores: { title: "Douglas Barbosa" } });
  });

  it("ficha recém-criada pelo agendamento também sai com o nome fixado", async () => {
    busca.findExistingContact.mockResolvedValue({ contato: null, falhou: false });
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    const [ficha] = daTabela("contacts");
    expect(ficha.filtros).toContainEqual(["id", "novo-1"]);
    expect(typeof ficha.valores.nome_fixado_em).toBe("string");
  });

  it("CRÍTICO: nome que é um número não é gravado nem fixado, e o detalhe diz por quê", async () => {
    const r = await processarAgendamento(admin, "acct-1", { ...AGENDAMENTO, nome: "+55 62 99379-8909" });
    expect(escritas).toEqual([]);
    expect(r.resultado).toBe("disparado");
    expect(r.detalhe).toContain("parece um número");
  });

  it("nome ausente (linha antiga reprocessada) não mexe em nada e não vira aviso", async () => {
    const r = await processarAgendamento(admin, "acct-1", { ...AGENDAMENTO, nome: "" });
    expect(escritas).toEqual([]);
    expect(r.detalhe).not.toContain("·");
  });

  it("⚠️ falha ao gravar a ficha NÃO segura o aviso ao advogado — vira aviso no detalhe", async () => {
    erroPorTabela.contacts = { message: "column nome_fixado_em does not exist" };
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    expect(motor.dispararAutomacoes).toHaveBeenCalledTimes(1);
    expect(r.resultado).toBe("disparado");
    expect(r.detalhe).toContain("o nome da ficha não foi atualizado");
    // Ficha que não gravou não renomeia o card: os dois contariam nomes diferentes.
    expect(daTabela("deals")).toEqual([]);
  });

  it("falha ao renomear o negócio também vira aviso, sem derrubar o disparo", async () => {
    erroPorTabela.deals = { message: "timeout" };
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("disparado");
    expect(r.detalhe).toContain("o título do negócio não foi atualizado");
  });

  it("sem automação escutando, o nome NÃO muda — o agendamento não tocou em nada", async () => {
    automacoes = [];
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("sem_automacao");
    expect(escritas).toEqual([]);
  });
});

describe("comAvisoDoNome", () => {
  const base = { resultado: "disparado" as const, detalhe: "1 automação(ões) executada(s)", contactId: "c1" };

  it("sem aviso devolve o mesmo resultado", () => {
    expect(comAvisoDoNome(base, null)).toBe(base);
  });

  it("acrescenta ao detalhe existente, ou vira o detalhe quando não havia", () => {
    expect(comAvisoDoNome(base, "x").detalhe).toBe("1 automação(ões) executada(s) · x");
    expect(comAvisoDoNome({ ...base, detalhe: null }, "x").detalhe).toBe("x");
  });
});
