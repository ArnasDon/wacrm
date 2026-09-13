import { describe, expect, it } from "vitest";

import { matchesTypeFilter } from "./conversations";
import {
  aplicarFiltros,
  casaComABusca,
  casaComAEtapa,
  casaComOResponsavel,
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  mapaDeEtapasPorContato,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  funisDoRecorte,
  recorteTemDoisNiveis,
  type ContextoDosFiltros,
  type FiltrosDoInbox,
  casaComASituacao,
  digitosDeBuscaDeTelefone,
} from "./filtros";
import type { Conversation, Tag } from "@/types";

const etiqueta = (id: string): Tag => ({
  id,
  user_id: "u1",
  name: id,
  color: "#fff",
  created_at: "",
});

function conversa(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: {
      id: "ct1",
      user_id: "u1",
      account_id: "a1",
      phone: "5511999999999",
      name: "Ana Souza",
      created_at: "",
      updated_at: "",
    },
    ...patch,
  };
}

/** Conversa de grupo: sem contato, com `group_id` — o XOR da 906. */
function grupo(patch: Partial<Conversation> = {}): Conversation {
  return conversa({
    id: "g1",
    contact_id: null,
    contact: null,
    group_id: "grp1",
    group: {
      id: "grp1",
      account_id: "a1",
      channel_id: "ch1",
      jid: "123@g.us",
      subject: "Condomínio Rio Tucumã",
      alias: null,
      description: null,
      picture_url: null,
      owner_jid: null,
      participant_count: null,
      is_announce: null,
      we_are_admin: null,
      synced_at: null,
      created_at: "",
      updated_at: "",
    },
    ...patch,
  });
}

/** Um instante fixo, para o recorte de atraso não depender do relógio real. */
const AGORA = Date.parse("2026-09-09T12:00:00.000Z");

const ctx = (patch: Partial<ContextoDosFiltros> = {}): ContextoDosFiltros => ({
  favoritas: new Set<string>(),
  etapaPorContato: new Map<string, Set<string>>(),
  funilPorEtapa: new Map<string, string>(),
  busca: "",
  achadasNoTexto: new Set<string>(),
  recorteDeEtapaConfiavel: true,
  agoraMs: AGORA,
  inadimplentes: null,
  ...patch,
});

describe("matchesTypeFilter", () => {
  // A revisão prévia achou que esta função do multi-canal/grupos nunca teve
  // teste, apesar de o plano dizer que as funções puras eram testadas.
  it("'todas' deixa passar os dois", () => {
    expect(matchesTypeFilter(conversa(), "todas")).toBe(true);
    expect(matchesTypeFilter(grupo(), "todas")).toBe(true);
  });

  it("'diretas' tira grupo, 'grupos' tira 1:1", () => {
    expect(matchesTypeFilter(conversa(), "diretas")).toBe(true);
    expect(matchesTypeFilter(grupo(), "diretas")).toBe(false);
    expect(matchesTypeFilter(conversa(), "grupos")).toBe(false);
    expect(matchesTypeFilter(grupo(), "grupos")).toBe(true);
  });
});

describe("casaComABusca", () => {
  it("busca vazia deixa tudo passar", () => {
    expect(casaComABusca(conversa(), "")).toBe(true);
    expect(casaComABusca(conversa(), "   ")).toBe(true);
  });

  it("acha por nome e por telefone, sem diferenciar maiúscula", () => {
    expect(casaComABusca(conversa(), "ana")).toBe(true);
    expect(casaComABusca(conversa(), "SOUZA")).toBe(true);
    expect(casaComABusca(conversa(), "99999")).toBe(true);
  });

  it("acha GRUPO pelo nome — grupo não tem contato", () => {
    // Sem este ramo, buscar não acharia grupo nenhum: nome e telefone são
    // ambos vazios numa conversa de grupo.
    expect(casaComABusca(grupo(), "tucumã")).toBe(true);
    expect(casaComABusca(grupo(), "ana")).toBe(false);
  });

  it("acha pelo texto da última mensagem, sem os marcadores do WhatsApp", () => {
    const c = conversa({ last_message_text: "O *contrato* foi assinado" });
    expect(casaComABusca(c, "contrato foi")).toBe(true);
  });

  it("⚠️ ignora acento nos DOIS sentidos — a busca do banco também ignora", () => {
    // Sem isto, a mesma palavra digitada acharia a MENSAGEM que fala em "ação"
    // (o Postgres aplica `unaccent`) e não acharia o CONTATO chamado "Ação".
    // Duas regras diferentes no mesmo campo de texto, sem nada explicando qual
    // vale em cada linha.
    const c = conversa({ last_message_text: "Petição protocolada" });
    expect(casaComABusca(c, "peticao")).toBe(true);
    expect(casaComABusca(c, "PETIÇÃO")).toBe(true);

    const base = conversa();
    const comAcento = conversa({
      contact: { ...base.contact!, name: "Conceição Ramos" },
    });
    expect(casaComABusca(comAcento, "conceicao")).toBe(true);
    expect(casaComABusca(comAcento, "Conceição")).toBe(true);
  });
});

describe("casaComABusca — telefone escrito por gente (08/09/2026)", () => {
  // `contacts.phone` guarda só dígitos com DDI. Colar "(19) 98276-4080" — a
  // forma que o cliente manda, e a que o próprio CRM exibe — não achava
  // NADA, e a leitura do operador foi que o cliente não estava no CRM.
  const joel = conversa({
    contact: { ...conversa().contact!, phone: "5519982764080", name: "Joel" },
  });

  it("CRÍTICO: acha com o número formatado, com e sem DDI", () => {
    expect(casaComABusca(joel, "(19) 98276-4080")).toBe(true);
    expect(casaComABusca(joel, "+55 19 98276-4080")).toBe(true);
    expect(casaComABusca(joel, "19 98276 4080")).toBe(true);
  });

  it("o pedaço formatado também acha (é o que se cola do WhatsApp)", () => {
    expect(casaComABusca(joel, "98276-4080")).toBe(true);
    expect(casaComABusca(joel, "982764080")).toBe(true);
  });

  it("não passa a achar quem não tem aqueles dígitos", () => {
    expect(casaComABusca(conversa(), "(19) 98276-4080")).toBe(false);
  });
});

describe("casaComABusca — o nono dígito (09/09/2026)", () => {
  // O WhatsApp entrega o JID de número antigo SEM o 9; o operador lê o
  // número no celular COM o 9. Digitar o completo não achava a ficha, e a
  // busca virava exatidão onde deveria ser "contém".
  const semNove = conversa({
    contact: { ...conversa().contact!, phone: "558388745316", name: "Renato" },
  });
  const comNove = conversa({
    contact: { ...conversa().contact!, phone: "5583988745316", name: "Renato" },
  });

  it("CRÍTICO: o número COM o 9 acha a ficha gravada SEM ele", () => {
    expect(casaComABusca(semNove, "(83) 98874-5316")).toBe(true);
    expect(casaComABusca(semNove, "+55 83 98874-5316")).toBe(true);
    expect(casaComABusca(semNove, "83988745316")).toBe(true);
  });

  it("e o número SEM o 9 acha a ficha gravada COM ele", () => {
    expect(casaComABusca(comNove, "(83) 8874-5316")).toBe(true);
    expect(casaComABusca(comNove, "558388745316")).toBe(true);
  });

  it("o pedaço com o 9 na frente também acha (é 'contém', não exatidão)", () => {
    expect(casaComABusca(semNove, "98874-5316")).toBe(true);
    expect(casaComABusca(semNove, "9 8874")).toBe(true);
  });

  it("não passa a achar outro número por causa da variante", () => {
    expect(casaComABusca(semNove, "(83) 98874-5317")).toBe(false);
    expect(casaComABusca(comNove, "(84) 98874-5316")).toBe(false);
  });
});

describe("digitosDeBuscaDeTelefone", () => {
  it("aceita dígitos e a pontuação com que se escreve telefone", () => {
    expect(digitosDeBuscaDeTelefone("(19) 98276-4080")).toBe("19982764080");
    expect(digitosDeBuscaDeTelefone("+55 19 98276.4080")).toBe("5519982764080");
    expect(digitosDeBuscaDeTelefone(" 982764080 ")).toBe("982764080");
  });

  it("⚠️ termo com LETRA não é telefone — senão a busca por texto sujaria a de número", () => {
    expect(digitosDeBuscaDeTelefone("Rua 12")).toBeNull();
    expect(digitosDeBuscaDeTelefone("contrato 2026")).toBeNull();
    expect(digitosDeBuscaDeTelefone("")).toBeNull();
  });

  it("piso de 3 dígitos, o mesmo da busca do banco", () => {
    expect(digitosDeBuscaDeTelefone("19")).toBeNull();
    expect(digitosDeBuscaDeTelefone("(19)")).toBeNull();
    expect(digitosDeBuscaDeTelefone("199")).toBe("199");
  });
});

describe("casaComOResponsavel", () => {
  it("null não filtra nada", () => {
    expect(casaComOResponsavel(conversa(), null)).toBe(true);
    expect(
      casaComOResponsavel(conversa({ assigned_agent_id: "u9" }), null),
    ).toBe(true);
  });

  it("casa com a pessoa escolhida", () => {
    const c = conversa({ assigned_agent_id: "u9" });
    expect(casaComOResponsavel(c, "u9")).toBe(true);
    expect(casaComOResponsavel(c, "u1")).toBe(false);
  });

  it("SEM_RESPONSAVEL acha justamente quem não foi distribuído", () => {
    // É a pergunta da manhã: "o que ninguém pegou ainda?". Sem esta opção,
    // 63 das 64 conversas sumiriam de qualquer recorte por responsável.
    expect(casaComOResponsavel(conversa(), SEM_RESPONSAVEL)).toBe(true);
    expect(
      casaComOResponsavel(
        conversa({ assigned_agent_id: "u9" }),
        SEM_RESPONSAVEL,
      ),
    ).toBe(false);
  });
});

describe("mapaDeEtapasPorContato", () => {
  it("junta os negócios do mesmo contato num CONJUNTO de etapas", () => {
    // O índice único da 911 só cobre `source='channel'` — negócio manual ou
    // de automação duplica o contato, e ele fica em duas etapas ao mesmo
    // tempo. Tratar como valor único sumiria com o segundo.
    const mapa = mapaDeEtapasPorContato([
      { contact_id: "ct1", stage_id: "s1" },
      { contact_id: "ct1", stage_id: "s2" },
      { contact_id: "ct2", stage_id: "s1" },
    ]);
    expect(mapa.get("ct1")).toEqual(new Set(["s1", "s2"]));
    expect(mapa.get("ct2")).toEqual(new Set(["s1"]));
  });

  it("ignora negócio sem contato ou sem etapa", () => {
    // `deals.contact_id` é anulável desde a 004 (SET NULL ao apagar contato).
    const mapa = mapaDeEtapasPorContato([
      { contact_id: null, stage_id: "s1" },
      { contact_id: "ct1", stage_id: null },
    ]);
    expect(mapa.size).toBe(0);
  });
});

describe("casaComAEtapa", () => {
  // ct1 tem negócio em s1 (funil f1); ct2 em s3 (funil f2) E em s2 (f1) — o
  // contato com dois negócios não é hipótese: o índice único da 911 só cobre
  // `source='channel'`, então automação e criação à mão duplicam.
  const mapa = new Map([
    ["ct1", new Set(["s1"])],
    ["ct2", new Set(["s3", "s2"])],
  ]);
  const funis = new Map([
    ["s1", "f1"],
    ["s2", "f1"],
    ["s3", "f2"],
  ]);
  const recorte = (patch: Partial<FiltrosDoInbox> = {}) => ({
    funilId: null,
    etapaId: null,
    ...patch,
  });

  it("nada escolhido não filtra nada", () => {
    expect(casaComAEtapa(conversa(), recorte(), mapa, funis)).toBe(true);
  });

  it("casa com a etapa do negócio do contato", () => {
    expect(casaComAEtapa(conversa(), recorte({ etapaId: "s1" }), mapa, funis)).toBe(
      true,
    );
    expect(casaComAEtapa(conversa(), recorte({ etapaId: "s2" }), mapa, funis)).toBe(
      false,
    );
  });

  it("SEM_ETAPA acha quem não tem negócio nenhum", () => {
    expect(
      casaComAEtapa(
        conversa({ contact_id: "ct9" }),
        recorte({ etapaId: SEM_ETAPA }),
        mapa,
        funis,
      ),
    ).toBe(true);
    expect(
      casaComAEtapa(conversa(), recorte({ etapaId: SEM_ETAPA }), mapa, funis),
    ).toBe(false);
  });

  it("grupo cai em SEM_ETAPA — não tem contato, logo não tem negócio", () => {
    expect(
      casaComAEtapa(grupo(), recorte({ etapaId: SEM_ETAPA }), mapa, funis),
    ).toBe(true);
    expect(casaComAEtapa(grupo(), recorte({ etapaId: "s1" }), mapa, funis)).toBe(
      false,
    );
    // E some de qualquer recorte por funil, pelo mesmo motivo.
    expect(casaComAEtapa(grupo(), recorte({ funilId: "f1" }), mapa, funis)).toBe(
      false,
    );
  });

  it("só o funil acha quem tem negócio em QUALQUER etapa dele", () => {
    expect(casaComAEtapa(conversa(), recorte({ funilId: "f1" }), mapa, funis)).toBe(
      true,
    );
    expect(casaComAEtapa(conversa(), recorte({ funilId: "f2" }), mapa, funis)).toBe(
      false,
    );
  });

  it("contato com negócio em dois funis casa com os DOIS", () => {
    const ct2 = conversa({ contact_id: "ct2" });
    expect(casaComAEtapa(ct2, recorte({ funilId: "f1" }), mapa, funis)).toBe(true);
    expect(casaComAEtapa(ct2, recorte({ funilId: "f2" }), mapa, funis)).toBe(true);
  });

  it("⚠️ a ETAPA vence o funil quando os dois vêm preenchidos — somar os dois recortes repetiria a mesma pergunta, e um funil errado no estado esconderia a etapa escolhida", () => {
    expect(
      casaComAEtapa(conversa(), recorte({ funilId: "f2", etapaId: "s1" }), mapa, funis),
    ).toBe(true);
  });

  it("⚠️ etapa fora do mapa de funis não casa com funil nenhum — o mapa é a única fonte de 'esta etapa é de qual funil'", () => {
    expect(
      casaComAEtapa(conversa(), recorte({ funilId: "f1" }), mapa, new Map()),
    ).toBe(false);
  });

  it("⚠️ com o mapa VAZIO (deals ainda não carregados) conversa com contato reprova — é por isso que `recorteDeEtapaConfiavel` existe no ctx; sem a neutralização, o deep link ?etapa= abre 'nenhuma conversa' com cara de resposta certa", () => {
    expect(casaComAEtapa(conversa(), recorte({ etapaId: "s1" }), new Map(), funis)).toBe(
      false,
    );
  });

  it("⚠️ `recorteDeEtapaConfiavel: false` NEUTRALIZA os DOIS níveis dentro de aplicarFiltros — a lista nunca responde errado com o mapa incompleto", () => {
    const c1 = conversa({ id: "c1" });
    // Mapa vazio + filtro de etapa: sem a guarda, zero resultados.
    expect(
      aplicarFiltros(
        [c1],
        { ...FILTROS_VAZIOS, etapaId: "s1" },
        ctx({ recorteDeEtapaConfiavel: false }),
      ).map((c) => c.id),
    ).toEqual(["c1"]);
    // O nível do funil cai junto: é o mesmo mapa que falta.
    expect(
      aplicarFiltros(
        [c1],
        { ...FILTROS_VAZIOS, funilId: "f1" },
        ctx({ recorteDeEtapaConfiavel: false }),
      ).map((c) => c.id),
    ).toEqual(["c1"]);
    // Com dados confiáveis, o recorte vale normalmente.
    expect(
      aplicarFiltros(
        [c1],
        { ...FILTROS_VAZIOS, etapaId: "s1" },
        ctx({ recorteDeEtapaConfiavel: true }),
      ),
    ).toEqual([]);
  });

  it("o recorte por funil passa pelo aplicarFiltros com os dois mapas do ctx", () => {
    const c1 = conversa({ id: "c1" });
    expect(
      aplicarFiltros([c1], { ...FILTROS_VAZIOS, funilId: "f1" }, ctx({
        etapaPorContato: mapa,
        funilPorEtapa: funis,
      })).map((c) => c.id),
    ).toEqual(["c1"]);
    expect(
      aplicarFiltros([c1], { ...FILTROS_VAZIOS, funilId: "f2" }, ctx({
        etapaPorContato: mapa,
        funilPorEtapa: funis,
      })),
    ).toEqual([]);
  });
});

describe("funisDoRecorte / recorteTemDoisNiveis", () => {
  // Nomes ASCII de propósito: o `localeCompare` colaciona diferente entre a
  // versão de Node da máquina e a do CI (Node 20), e um teste de ordenação
  // com acento reprova só lá.
  const etapas = [
    { pipeline_id: "p2" },
    { pipeline_id: "p1" },
    { pipeline_id: "p2" },
  ];
  const nomes = new Map([
    ["p1", "Bancario"],
    ["p2", "Aereo"],
    ["p3", "Sem etapa nenhuma"],
  ]);

  it("um item por funil, ordenado por nome", () => {
    expect(funisDoRecorte(etapas, nomes)).toEqual([
      { id: "p2", nome: "Aereo" },
      { id: "p1", nome: "Bancario" },
    ]);
  });

  it("funil sem etapa carregada fica de fora — não teria o que oferecer no segundo nível", () => {
    expect(funisDoRecorte(etapas, nomes).map((f) => f.id)).not.toContain("p3");
  });

  it("⚠️ funil SEM NOME fica de fora: o seletor mostraria linha em branco e o operador escolheria às cegas", () => {
    expect(funisDoRecorte(etapas, new Map([["p1", "Bancario"]]))).toEqual([
      { id: "p1", nome: "Bancario" },
    ]);
    // Nomes indisponíveis (a consulta de `pipelines` falhou sozinha) derrubam
    // os dois níveis inteiros — volta a lista chapada, que é honesta.
    expect(recorteTemDoisNiveis(etapas, new Map())).toBe(false);
  });

  it("⚠️ dois níveis exigem DOIS funis nomeados — com um só, `funilId` fica sempre nulo e 'Qualquer etapa' segue significando 'não filtro por etapa'", () => {
    expect(recorteTemDoisNiveis(etapas, nomes)).toBe(true);
    expect(
      recorteTemDoisNiveis([{ pipeline_id: "p1" }], nomes),
    ).toBe(false);
    expect(recorteTemDoisNiveis([], nomes)).toBe(false);
  });
});

describe("contarFiltrosAtivos", () => {
  it("zero quando nada foi escolhido", () => {
    expect(contarFiltrosAtivos(FILTROS_VAZIOS)).toBe(0);
  });

  it("o modo da etiqueta NÃO conta como filtro", () => {
    // Ele não recorta nada sozinho — só muda como as etiquetas já escolhidas
    // se combinam. Contá-lo faria o distintivo mostrar "1" com a lista inteira
    // aparecendo.
    expect(
      contarFiltrosAtivos({ ...FILTROS_VAZIOS, modoDeEtiqueta: "todas" }),
    ).toBe(0);
  });

  it("conta 'não lidas' como faceta própria", () => {
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, naoLidas: true })).toBe(1);
  });

  it("⚠️ funil e etapa contam como UM filtro só — com etapa escolhida o funil vem junto, e somar dois faria o distintivo dizer '2' sobre uma escolha só", () => {
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, funilId: "f1" })).toBe(1);
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, etapaId: "s1" })).toBe(1);
    expect(
      contarFiltrosAtivos({ ...FILTROS_VAZIOS, funilId: "f1", etapaId: "s1" }),
    ).toBe(1);
  });

  it("soma um por faceta escolhida", () => {
    expect(
      contarFiltrosAtivos({
        ...FILTROS_VAZIOS,
        tipo: "grupos",
        favoritas: true,
        etiquetaIds: ["t1", "t2"],
      }),
    ).toBe(3);
  });
});

describe("aplicarFiltros — a busca somada com o que o banco achou", () => {
  /** Conversa cujo texto NÃO casa por nenhum campo que a lista tem na mão. */
  const antiga = () =>
    conversa({
      id: "c-antiga",
      last_message_text: "combinado, até segunda",
      contact: { ...conversa().contact!, name: "Bruno Lima", phone: "551188" },
    });

  it("⚠️ conversa achada SÓ pelo corpo entra no resultado", () => {
    // É a feature inteira: o termo não está no nome, nem no telefone, nem na
    // última mensagem — está numa mensagem antiga, que só o banco enxerga.
    const semAchado = aplicarFiltros([antiga()], FILTROS_VAZIOS, ctx({
      busca: "usucapião",
    }));
    expect(semAchado).toHaveLength(0);

    const comAchado = aplicarFiltros([antiga()], FILTROS_VAZIOS, ctx({
      busca: "usucapião",
      achadasNoTexto: new Set(["c-antiga"]),
    }));
    expect(comAchado).toHaveLength(1);
  });

  it("⚠️ o achado do banco NÃO atropela os outros filtros", () => {
    // O OU vale só entre as duas metades da BUSCA. Uma conversa achada pelo
    // corpo continua tendo de passar por status, responsável, favoritas etc.
    // Se a busca ganhasse do painel, ligar "Favoritas" e buscar devolveria
    // conversas não favoritas — e o operador leria isso como o filtro tendo
    // sido ignorado.
    const saida = aplicarFiltros(
      [antiga()],
      { ...FILTROS_VAZIOS, favoritas: true },
      ctx({ busca: "usucapião", achadasNoTexto: new Set(["c-antiga"]) }),
    );
    expect(saida).toHaveLength(0);
  });

  it("achado de OUTRA conversa não arrasta esta", () => {
    const saida = aplicarFiltros(
      [antiga()],
      FILTROS_VAZIOS,
      ctx({ busca: "usucapião", achadasNoTexto: new Set(["c-outra"]) }),
    );
    expect(saida).toHaveLength(0);
  });

  it("com busca vazia o conjunto do banco é irrelevante", () => {
    // Enquanto a resposta do banco não chega, `achadasNoTexto` pode estar
    // vazio; com a caixa vazia a lista tem de continuar inteira.
    const lista = [conversa(), grupo()];
    expect(
      aplicarFiltros(lista, FILTROS_VAZIOS, ctx({ busca: "" })),
    ).toHaveLength(2);
  });
});

describe("aplicarFiltros", () => {
  it("sem filtro nenhum devolve tudo", () => {
    const lista = [conversa(), grupo()];
    expect(aplicarFiltros(lista, FILTROS_VAZIOS, ctx())).toHaveLength(2);
  });

  it("combina os filtros com E, nunca com OU", () => {
    // A decisão do operador: marcar responsável e depois favoritas mostra AS
    // FAVORITAS DAQUELE responsável, não a soma das duas listas.
    const minha = conversa({ id: "c1", assigned_agent_id: "u9" });
    const dela = conversa({ id: "c2", assigned_agent_id: "u9" });
    const outra = conversa({ id: "c3", assigned_agent_id: "u1" });

    const saida = aplicarFiltros(
      [minha, dela, outra],
      { ...FILTROS_VAZIOS, responsavelId: "u9", favoritas: true },
      ctx({ favoritas: new Set(["c1", "c3"]) }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c1"]);
  });

  it("etiqueta em modo 'todas' exige as duas; 'qualquer' basta uma", () => {
    const vip = conversa({
      id: "c1",
      contact: { ...conversa().contact!, tags: [etiqueta("t1")] },
    });
    const ambas = conversa({
      id: "c2",
      contact: { ...conversa().contact!, tags: [etiqueta("t1"), etiqueta("t2")] },
    });

    const qualquer = aplicarFiltros(
      [vip, ambas],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"], modoDeEtiqueta: "qualquer" },
      ctx(),
    );
    expect(qualquer.map((c) => c.id)).toEqual(["c1", "c2"]);

    const todas = aplicarFiltros(
      [vip, ambas],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"], modoDeEtiqueta: "todas" },
      ctx(),
    );
    expect(todas.map((c) => c.id)).toEqual(["c2"]);
  });

  it("filtro de canal não engole conversa 1:1 sem carimbo", () => {
    // Conversa anterior à 903 tem `channel_id` nulo. Ela só aparece em
    // "Todos" — incluí-la em todo canal faria o filtro mentir sobre por qual
    // número aquela conversa correu.
    const semCarimbo = conversa({ id: "c1" });
    const doCanal = conversa({ id: "c2", channel_id: "ch1" });
    const saida = aplicarFiltros(
      [semCarimbo, doCanal],
      { ...FILTROS_VAZIOS, canalIds: ["ch1"] },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["c2"]);
  });

  it("⚠️ GRUPO tem o número em cb_groups, não na conversa", () => {
    // Este teste existe por causa de um achado da revisão: a versão anterior
    // lia `conversations.channel_id` direto, e `persist.ts` NUNCA grava essa
    // coluna em conversa de grupo. Resultado: escolher um número APAGAVA
    // TODOS OS GRUPOS daquele número, em silêncio — e o teste antigo dizia,
    // errado, que o nulo era coisa de conversa pré-903.
    const doCanal = grupo({ id: "g1" }); // group.channel_id = 'ch1'
    const deOutro = grupo({
      id: "g2",
      group: { ...grupo().group!, channel_id: "ch2" },
    });

    const saida = aplicarFiltros(
      [doCanal, deOutro],
      { ...FILTROS_VAZIOS, canalIds: ["ch1"] },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["g1"]);
  });

  it("grupo sem número conhecido não entra em recorte por número", () => {
    const semNumero = grupo({
      id: "g1",
      group: { ...grupo().group!, channel_id: null },
    });
    expect(
      aplicarFiltros([semNumero], { ...FILTROS_VAZIOS, canalIds: ["ch1"] }, ctx()),
    ).toHaveLength(0);
  });

  it("grupo some do filtro de etiqueta, e isso é a resposta honesta", () => {
    const saida = aplicarFiltros(
      [conversa(), grupo()],
      { ...FILTROS_VAZIOS, etiquetaIds: ["t1"] },
      ctx(),
    );
    expect(saida).toHaveLength(0);
  });

  it("'não lidas' SOMA com a aba, em vez de substituí-la", () => {
    // Este é o teste da mudança de comportamento do commit 3. Antes, escolher
    // "não lidas" no menu de situação substituía o status — a encerrada não
    // lida aparecia junto. Agora os dois se aplicam: na caixa (aba padrão)
    // sobra só a aberta e não lida; na aba Encerradas, só a encerrada.
    const abertaNaoLida = conversa({ id: "c1", status: "open", unread_count: 3 });
    const abertaLida = conversa({ id: "c2", status: "open", unread_count: 0 });
    const encerradaNaoLida = conversa({
      id: "c3",
      status: "closed",
      unread_count: 5,
    });

    const naCaixa = aplicarFiltros(
      [abertaNaoLida, abertaLida, encerradaNaoLida],
      { ...FILTROS_VAZIOS, naoLidas: true },
      ctx(),
    );
    expect(naCaixa.map((c) => c.id)).toEqual(["c1"]);

    const nasEncerradas = aplicarFiltros(
      [abertaNaoLida, abertaLida, encerradaNaoLida],
      { ...FILTROS_VAZIOS, naoLidas: true, status: "closed" },
      ctx(),
    );
    expect(nasEncerradas.map((c) => c.id)).toEqual(["c3"]);
  });

  it("a busca continua valendo junto com os filtros", () => {
    const ana = conversa({ id: "c1", status: "open" });
    const outro = conversa({
      id: "c2",
      status: "open",
      contact: { ...conversa().contact!, name: "Bruno Lima" },
    });
    const saida = aplicarFiltros(
      [ana, outro],
      { ...FILTROS_VAZIOS, favoritas: false },
      ctx({ busca: "bruno" }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c2"]);
  });
});

// ============================================================
// As duas abas (2026-09-02): a caixa de entrada esconde as encerradas, e a
// busca atravessa SÓ a aba padrão.
// ============================================================
describe("casaComASituacao — Abertas esconde encerrada; Encerradas mostra só ela", () => {
  const aberta = conversa({ id: "a", status: "open" });
  const pendente = conversa({ id: "p", status: "pending" });
  const encerrada = conversa({ id: "e", status: "closed" });

  it("a aba padrão é a ausência de filtro", () => {
    expect(FILTROS_VAZIOS.status).toBe("ativas");
    expect(contarFiltrosAtivos(FILTROS_VAZIOS)).toBe(0);
    // A aba Encerradas NÃO conta como filtro — nem para o painel, nem para a
    // visão salva (que não a carrega): é onde o operador está, não um recorte.
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, status: "closed" })).toBe(0);
    expect(
      contarFiltrosAtivos({ ...FILTROS_VAZIOS, status: "closed", favoritas: true }),
    ).toBe(1);
  });

  it("na caixa, aberta E pendente ficam; a encerrada sai", () => {
    expect(casaComASituacao(aberta, "ativas", "")).toBe(true);
    expect(casaComASituacao(pendente, "ativas", "")).toBe(true);
    expect(casaComASituacao(encerrada, "ativas", "")).toBe(false);
  });

  it("na aba Encerradas só a encerrada aparece", () => {
    expect(casaComASituacao(encerrada, "closed", "")).toBe(true);
    expect(casaComASituacao(aberta, "closed", "")).toBe(false);
    expect(casaComASituacao(pendente, "closed", "")).toBe(false);
  });

  it("⚠️ a busca ATRAVESSA a aba padrão: o nome do cliente acha a conversa encerrada", () => {
    // Sem isto, "João" na caixa diria "nenhuma conversa" sobre um cliente que
    // existe — e a leitura do operador seria que ele não está no CRM.
    expect(casaComASituacao(encerrada, "ativas", "joão")).toBe(true);
    // Só espaço não é busca.
    expect(casaComASituacao(encerrada, "ativas", "   ")).toBe(false);
  });

  it("na aba Encerradas a busca NÃO atravessa: a pastilha não pode mentir", () => {
    expect(casaComASituacao(aberta, "closed", "ana")).toBe(false);
  });

  it("aplicarFiltros: a busca traz a encerrada para a caixa, e os outros filtros seguem valendo", () => {
    const anaEncerrada = conversa({ id: "e", status: "closed" });
    const brunoEncerrado = conversa({
      id: "b",
      status: "closed",
      contact: { ...conversa().contact!, name: "Bruno Lima" },
    });
    const semBusca = aplicarFiltros([anaEncerrada, brunoEncerrado], FILTROS_VAZIOS, ctx());
    expect(semBusca).toHaveLength(0);

    const comBusca = aplicarFiltros(
      [anaEncerrada, brunoEncerrado],
      FILTROS_VAZIOS,
      ctx({ busca: "bruno" }),
    );
    expect(comBusca.map((c) => c.id)).toEqual(["b"]);

    // Favoritas continua E lógico: encerrada achada pela busca, mas não
    // favorita, fica de fora.
    const favoritas = aplicarFiltros(
      [anaEncerrada, brunoEncerrado],
      { ...FILTROS_VAZIOS, favoritas: true },
      ctx({ busca: "bruno" }),
    );
    expect(favoritas).toHaveLength(0);
  });
});

// ============================================================
// Recorte "em atraso" (pedido do operador, 2026-09-09).
//
// A régua é a MESMA do selo da linha (`atrasoDeResposta`): o que estes testes
// fixam é que ela vale aqui sem cópia e que o recorte SOMA com o resto — em
// especial que ele NÃO exige mensagem não lida, que foi o pedido escrito.
// ============================================================
describe("recorte por atraso de resposta", () => {
  const esperando = (minutos: number, patch: Partial<Conversation> = {}) =>
    conversa({
      id: `esp-${minutos}`,
      aguardando_desde: new Date(AGORA - minutos * 60_000).toISOString(),
      ...patch,
    });

  it("mantém só quem já passou dos 10 minutos", () => {
    const saida = aplicarFiltros(
      [esperando(3), esperando(11), conversa({ id: "sem-espera" })],
      { ...FILTROS_VAZIOS, emAtraso: true },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["esp-11"]);
  });

  it("não exige mensagem não lida — é o ponto do pedido", () => {
    // A conversa já foi ABERTA por alguém (`unread_count` zerado) e mesmo
    // assim ninguém respondeu: é justamente quem "Não lidas" esconderia.
    const lida = esperando(40, { id: "lida", unread_count: 0 });
    const saida = aplicarFiltros([lida], { ...FILTROS_VAZIOS, emAtraso: true }, ctx());
    expect(saida.map((c) => c.id)).toEqual(["lida"]);
  });

  it("soma com os outros filtros (E lógico), como todo o resto", () => {
    const comAtraso = esperando(30, { id: "com" });
    const outra = esperando(30, { id: "outra", assigned_agent_id: "u2" });
    const saida = aplicarFiltros(
      [comAtraso, outra],
      { ...FILTROS_VAZIOS, emAtraso: true, responsavelId: "u2" },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["outra"]);
  });

  it("grupo e encerrada nunca entram — o selo também não acende neles", () => {
    const encerrada = esperando(60, { id: "fechada", status: "closed" });
    const emGrupo = grupo({
      id: "grp",
      aguardando_desde: new Date(AGORA - 60 * 60_000).toISOString(),
    });
    const saida = aplicarFiltros(
      [encerrada, emGrupo],
      { ...FILTROS_VAZIOS, emAtraso: true },
      // Aba Encerradas, para a encerrada não ser barrada antes por situação.
      ctx(),
    );
    expect(saida).toHaveLength(0);
  });

  it("desligado, não recorta nada", () => {
    const lista = [esperando(1), esperando(99)];
    expect(aplicarFiltros(lista, FILTROS_VAZIOS, ctx())).toHaveLength(2);
  });

  it("conta no distintivo", () => {
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, emAtraso: true })).toBe(1);
  });
});

// ============================================================
// Recorte por perfil (Fase 3) — o predicado `foraDoPerfil` e a exceção
// da busca, decidida pelo operador em 2026-08-30: a busca ACHA conversa
// de outra área (a linha aparece completa); o que é barrado é ABRIR.
// ============================================================
describe("recorte por perfil (foraDoPerfil)", () => {
  const daOutraArea = (c: Conversation) => c.id === "c-fora";
  const fora = () =>
    conversa({
      id: "c-fora",
      contact: { ...conversa().contact!, name: "Cliente do Bancário" },
    });

  it("sem termo de busca, a conversa fora do perfil SOME da lista", () => {
    const saida = aplicarFiltros(
      [conversa(), fora()],
      FILTROS_VAZIOS,
      ctx({ foraDoPerfil: daOutraArea }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c1"]);
  });

  it("com termo que CASA, ela aparece — a busca acha outra área", () => {
    const saida = aplicarFiltros(
      [conversa(), fora()],
      FILTROS_VAZIOS,
      ctx({ foraDoPerfil: daOutraArea, busca: "bancário" }),
    );
    expect(saida.map((c) => c.id)).toEqual(["c-fora"]);
  });

  it("com termo que NÃO casa, ela continua fora", () => {
    const saida = aplicarFiltros(
      [fora()],
      FILTROS_VAZIOS,
      ctx({ foraDoPerfil: daOutraArea, busca: "trabalhista" }),
    );
    expect(saida).toHaveLength(0);
  });

  it("⚠️ termo só de espaços NÃO reabre a lista de outra área", () => {
    // `busca: '  '` casa com tudo em casaComABusca — sem o trim no recorte,
    // dois espaços na caixa devolveriam a conta inteira.
    const saida = aplicarFiltros(
      [fora()],
      FILTROS_VAZIOS,
      ctx({ foraDoPerfil: daOutraArea, busca: "   " }),
    );
    expect(saida).toHaveLength(0);
  });

  it("a busca de outra área ainda respeita os outros filtros", () => {
    // Buscar com "Favoritas" ligado não traz não-favorita de outra área —
    // mesma regra do OU da busca, que nunca atropela o painel.
    const saida = aplicarFiltros(
      [fora()],
      { ...FILTROS_VAZIOS, favoritas: true },
      ctx({ foraDoPerfil: daOutraArea, busca: "bancário" }),
    );
    expect(saida).toHaveLength(0);
  });

  it("predicado ausente = sem recorte (perfil nulo)", () => {
    const saida = aplicarFiltros([conversa(), fora()], FILTROS_VAZIOS, ctx());
    expect(saida).toHaveLength(2);
  });
});

describe("canalIds — OU entre as conexões marcadas (03/09)", () => {
  it("duas conexões marcadas: entra quem está em qualquer uma; sem carimbo fica de fora", () => {
    const c1 = conversa({ id: "a", channel_id: "ch1" });
    const c2 = conversa({ id: "b", channel_id: "ch2" });
    const c3 = conversa({ id: "c", channel_id: "ch3" });
    const semCarimbo = conversa({ id: "d", channel_id: null });
    const saida = aplicarFiltros(
      [c1, c2, c3, semCarimbo],
      { ...FILTROS_VAZIOS, canalIds: ["ch1", "ch2"] },
      ctx(),
    );
    expect(saida.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("recorte por inadimplência no Asaas (Fase 1b)", () => {
  const devendo = conversa({ id: "c-deve", contact_id: "ct-deve" });
  const emDia = conversa({ id: "c-em-dia", contact_id: "ct-em-dia" });
  const f = { ...FILTROS_VAZIOS, inadimplentes: true };

  it("com o conjunto em mão, fica só quem está nele", () => {
    const ids = aplicarFiltros([devendo, emDia], f, ctx({ inadimplentes: new Set(["ct-deve"]) })).map((c) => c.id);
    expect(ids).toEqual(["c-deve"]);
  });

  it("⚠️ `null` NEUTRALIZA: Asaas desconectado ou espelho parado nunca vira 'nenhuma conversa'", () => {
    const ids = aplicarFiltros([devendo, emDia], f, ctx({ inadimplentes: null })).map((c) => c.id);
    expect(ids).toEqual(["c-deve", "c-em-dia"]);
  });

  it("grupo não tem contato e fica de fora — dívida é de gente", () => {
    const ids = aplicarFiltros([devendo, grupo()], f, ctx({ inadimplentes: new Set(["ct-deve"]) })).map((c) => c.id);
    expect(ids).toEqual(["c-deve"]);
  });

  it("conta como um filtro e desligado não recorta nada", () => {
    expect(contarFiltrosAtivos(f)).toBe(1);
    const ids = aplicarFiltros([devendo, emDia], FILTROS_VAZIOS, ctx({ inadimplentes: new Set() })).map((c) => c.id);
    expect(ids).toEqual(["c-deve", "c-em-dia"]);
  });
});
