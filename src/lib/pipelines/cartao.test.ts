import { describe, expect, it } from "vitest";

import type { Tag } from "@/types";
import {
  conversaDoCard,
  juntarConteudo,
  normalizarDealDoQuadro,
  type CardDoQuadro,
  type CardSemConteudo,
  type DealDoQuadro,
  type RawDealDoQuadro,
  type ResumoDaConversa,
} from "./cartao";

function resumo(id: string, at: string | null = null): ResumoDaConversa {
  return { id, unread_count: 0, last_message_text: null, last_message_at: at };
}

function tag(id: string, name = `tag-${id}`): Tag {
  return { id, user_id: "u1", name, color: "#3b82f6", created_at: "2026-01-01" };
}

function contato(
  extras: Partial<NonNullable<RawDealDoQuadro["contact"]>> = {},
): NonNullable<RawDealDoQuadro["contact"]> {
  return {
    id: "c1",
    user_id: "u1",
    account_id: "a1",
    phone: "5511999990000",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...extras,
  };
}

function dealCru(extras: Partial<RawDealDoQuadro> = {}): RawDealDoQuadro {
  return {
    id: "d1",
    user_id: "u1",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: "c1",
    title: "Negócio",
    value: 0,
    created_at: "2026-08-30T00:00:00+00:00",
    ...extras,
  };
}

describe("normalizarDealDoQuadro — formas do embed", () => {
  it("conversations como ARRAY vira `conversa`", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ contact: contato({ conversations: [resumo("cv1")] }) }),
    );
    expect(deal.conversa?.id).toBe("cv1");
  });

  it("conversations como OBJETO (caso o PostgREST detecte 1:1) também vira", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ contact: contato({ conversations: resumo("cv1") }) }),
    );
    expect(deal.conversa?.id).toBe("cv1");
  });

  it("array vazio / campo ausente → conversa null", () => {
    expect(
      normalizarDealDoQuadro(dealCru({ contact: contato({ conversations: [] }) }))
        .conversa,
    ).toBeNull();
    expect(
      normalizarDealDoQuadro(dealCru({ contact: contato() })).conversa,
    ).toBeNull();
  });

  it("negócio sem contato passa limpo (contato apagado continua no quadro)", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: null, contact_id: null }));
    expect(deal.contact).toBeUndefined();
    expect(deal.conversa).toBeNull();
  });

  it("achata contact_tags em contact.tags ORDENADAS POR NOME, descartando join órfão — sem ordem estável, o trio do card (slice 3) trocava de composição a cada refetch", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        contact: contato({
          contact_tags: [
            { tags: tag("t1", "Zeta") },
            { tags: null },
            { tags: tag("t2", "Alfa") },
          ],
        }),
      }),
    );
    expect(deal.contact?.tags?.map((t) => t.name)).toEqual(["Alfa", "Zeta"]);
    expect(
      (deal.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("⚠️ contact_tags AUSENTE (plano B do select) NÃO fabrica tags: [] — a UI não pode afirmar 'sem etiquetas' sobre dado que não carregou", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: contato() }));
    expect(deal.contact?.tags).toBeUndefined();
  });

  it("várias conversas (sobra pré-036): vence a que casa com deal.conversation_id", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv2",
        contact: contato({
          conversations: [resumo("cv1", "2026-08-30T10:00:00+00:00"), resumo("cv2")],
        }),
      }),
    );
    expect(deal.conversa?.id).toBe("cv2");
  });

  it("sem casar com o vínculo, vence a de last_message_at mais recente; nulo perde da preenchida", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        contact: contato({
          conversations: [
            resumo("parada"),
            resumo("antiga", "2026-08-01T10:00:00+00:00"),
            resumo("recente", "2026-08-30T10:00:00+00:00"),
          ],
        }),
      }),
    );
    expect(deal.conversa?.id).toBe("recente");
  });
});

describe("conversaDoCard — a conversa do CONTATO manda", () => {
  it("com conversa do contato, é ela que o card abre e exibe", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv1",
        contact: contato({ conversations: [resumo("cv1")] }),
      }),
    );
    expect(conversaDoCard(deal)).toEqual({ id: "cv1", resumo: resumo("cv1") });
  });

  it("⚠️ vínculo histórico DIVERGENTE (contato trocado no formulário): o card abre a conversa do contato ATUAL — abrir a antiga faria o operador responder à pessoa errada (achado da revisão do PR #71)", () => {
    const doContato = resumo("cv-do-bruno");
    const deal = normalizarDealDoQuadro(
      dealCru({
        conversation_id: "cv-da-ana",
        contact: contato({ conversations: [doContato] }),
      }),
    );
    expect(conversaDoCard(deal)).toEqual({ id: "cv-do-bruno", resumo: doContato });
  });

  it("sem conversa do contato (contato apagado, ou plano B do select), cai no vínculo gravado da 910 — sem resumo, para não pintar prévia de dado não carregado", () => {
    const deal = normalizarDealDoQuadro(
      dealCru({ conversation_id: "cv-historica", contact: contato() }),
    );
    expect(conversaDoCard(deal)).toEqual({ id: "cv-historica", resumo: null });
  });

  it("nenhuma conversa em lugar nenhum → null (o card cai no formulário)", () => {
    const deal = normalizarDealDoQuadro(dealCru({ contact: contato() }));
    expect(conversaDoCard(deal)).toBeNull();
    expect(
      conversaDoCard(normalizarDealDoQuadro(dealCru({ contact: null, contact_id: null }))),
    ).toBeNull();
  });
});

describe("juntarConteudo — o conteúdo por id sobre a lista enxuta", () => {
  function enxuto(id: string, extras: Partial<CardSemConteudo> = {}): CardSemConteudo {
    return {
      id,
      stage_id: "s1",
      title: `Card ${id}`,
      value: 100,
      status: "open",
      created_at: "2026-09-01T00:00:00+00:00",
      updated_at: "2026-09-01T00:00:00+00:00",
      semConteudo: true,
      ...extras,
    };
  }
  function completo(id: string, extras: Partial<RawDealDoQuadro> = {}): DealDoQuadro {
    return normalizarDealDoQuadro(dealCru({ id, contact: contato(), ...extras }));
  }

  it("preenche o card pedido com o conteúdo", () => {
    const junto = juntarConteudo([enxuto("d1")], ["d1"], new Map([["d1", completo("d1")]]));
    expect(junto).toHaveLength(1);
    expect("semConteudo" in junto[0]!).toBe(false);
    expect((junto[0] as DealDoQuadro).contact?.id).toBe("c1");
  });

  it("⚠️ a linha enxuta VENCE: etapa, status, título e valor ficam os do quadro — o card arrastado enquanto carregava não volta para a etapa velha, e o formulário não regrava a etapa de outra consulta (Codex, PR #248)", () => {
    const naTela = enxuto("d1", { stage_id: "s-nova", status: "won", title: "Ana", value: 900 });
    const velho = completo("d1", { stage_id: "s-velha", status: "open", title: "Outro", value: 1 });
    const [junto] = juntarConteudo([naTela], ["d1"], new Map([["d1", velho]]));
    expect(junto).toMatchObject({ stage_id: "s-nova", status: "won", title: "Ana", value: 900 });
  });

  it("não toca card que já tem conteúdo, nem card enxuto que não foi pedido", () => {
    const jaTem = completo("d1", { title: "Já tem" });
    const outro = enxuto("d2");
    const lista: CardDoQuadro[] = [jaTem, outro];
    const junto = juntarConteudo(lista, ["d1"], new Map([["d1", completo("d1", { title: "Novo" })]]));
    expect(junto).toBe(lista);
  });

  it("tira do quadro o card pedido que não voltou — apagado entre a lista e o conteúdo, ficaria carregando para sempre", () => {
    const junto = juntarConteudo([enxuto("d1"), enxuto("d2")], ["d1", "d2"], new Map([["d2", completo("d2")]]));
    expect(junto.map((c) => c.id)).toEqual(["d2"]);
  });

  it("mantém a ordem da lista", () => {
    const lista = [enxuto("d1"), enxuto("d2"), enxuto("d3")];
    const conteudo = new Map([
      ["d3", completo("d3")],
      ["d1", completo("d1")],
    ]);
    expect(juntarConteudo(lista, ["d1", "d3"], conteudo).map((c) => c.id)).toEqual(["d1", "d2", "d3"]);
  });
});
