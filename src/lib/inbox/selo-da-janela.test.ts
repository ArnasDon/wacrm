import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MINUTOS_DA_JANELA,
  PREFIXO_DO_ID_DA_META,
  minutosRestantes,
  type MensagemDaJanela,
} from "./janela-24h";
import {
  CHAVE_SEM_CARIMBO,
  LIMIAR_AMBAR_MIN,
  LIMIAR_VERMELHO_MIN,
  corDaJanela,
  seloDaJanela,
} from "./selo-da-janela";

const AGORA = Date.parse("2026-09-12T15:00:00Z");
const min = (n: number) => new Date(AGORA - n * 60_000).toISOString();

/** Os números de uma conta: dois oficiais (Meta), um por QR Code, um Instagram. */
const OFICIAL = { id: "canal-oficial", kind: "meta" } as const;
const OUTRO_OFICIAL = { id: "canal-oficial-2", kind: "meta" } as const;
const QR_CODE = { id: "canal-qr-code", kind: "evolution" } as const;
const INSTAGRAM = { id: "canal-instagram", kind: "instagram" } as const;
/** As conexões oficiais desta conta de teste (o que `cb_channels.kind = meta` devolveria). */
const OFICIAIS: readonly string[] = [OFICIAL.id, OUTRO_OFICIAL.id];

function conversa(
  janela_meta: Record<string, string> | null | undefined,
  extra: { status?: "open" | "pending" | "closed"; group_id?: string | null } = {},
) {
  return {
    status: extra.status ?? ("open" as const),
    group_id: extra.group_id ?? null,
    janela_meta,
  };
}

/** O mapa como o gatilho da 993 o deixa: uma chave por número. */
const pelo = (canalId: string, minutosAtras: number) => ({ [canalId]: min(minutosAtras) });

describe("corDaJanela — as três cores que o operador escolheu", () => {
  it("os limiares são 12h e 3h", () => {
    expect(LIMIAR_AMBAR_MIN).toBe(720);
    expect(LIMIAR_VERMELHO_MIN).toBe(180);
  });

  it("24h a 12h é a padrão; 11h59 já é âmbar", () => {
    expect(corDaJanela(MINUTOS_DA_JANELA)).toBe("padrao");
    expect(corDaJanela(12 * 60)).toBe("padrao");
    expect(corDaJanela(12 * 60 - 1)).toBe("ambar");
  });

  it("3h ainda é âmbar; 2h59 já é vermelha", () => {
    expect(corDaJanela(3 * 60)).toBe("ambar");
    expect(corDaJanela(3 * 60 - 1)).toBe("vermelha");
    expect(corDaJanela(1)).toBe("vermelha");
  });
});

describe("seloDaJanela — quando a ampulheta aparece", () => {
  it("cliente que escreveu há 2h pelo número oficial: selo na cor padrão", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 120)), OFICIAL, AGORA)).toEqual({
      restante: 22 * 60,
      cor: "padrao",
    });
  });

  it("as cores viram nos minutos certos", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 12 * 60)), OFICIAL, AGORA)?.cor).toBe("padrao");
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 12 * 60 + 1)), OFICIAL, AGORA)?.cor).toBe("ambar");
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 21 * 60)), OFICIAL, AGORA)?.cor).toBe("ambar");
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 21 * 60 + 1)), OFICIAL, AGORA)?.cor).toBe("vermelha");
  });

  it("no último minuto ainda há selo; em 24h00 exatas não há mais", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 24 * 60 - 1)), OFICIAL, AGORA)).toEqual({
      restante: 1,
      cor: "vermelha",
    });
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 24 * 60)), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 3 * 24 * 60)), OFICIAL, AGORA)).toBeNull();
  });

  it("o cliente nunca escreveu pelo número oficial (mapa vazio, nulo ou pré-993): sem selo", () => {
    expect(seloDaJanela(conversa({}), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(null), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(undefined), OFICIAL, AGORA)).toBeNull();
    // Valor que não é data: a lista cala em vez de inventar.
    expect(seloDaJanela(conversa({ [OFICIAL.id]: "não é data" }), OFICIAL, AGORA)).toBeNull();
  });

  it("encerrada não mostra (decisão do operador); reaberta volta a mostrar", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60), { status: "closed" }), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60), { status: "pending" }), OFICIAL, AGORA)).not.toBeNull();
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60), { status: "open" }), OFICIAL, AGORA)).not.toBeNull();
  });

  it("grupo nunca tem selo", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60), { group_id: "grupo" }), OFICIAL, AGORA)).toBeNull();
  });

  it("número de saída desconhecido (canais carregando ou consulta falhou): sem selo", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60)), null, AGORA)).toBeNull();
  });

  it("só o WhatsApp oficial: QR Code e Instagram não mostram", () => {
    expect(seloDaJanela(conversa(pelo(QR_CODE.id, 60)), QR_CODE, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(pelo(INSTAGRAM.id, 60)), INSTAGRAM, AGORA)).toBeNull();
    // Mesmo com a mensagem da Meta no mapa, a SAÍDA por QR Code não tem janela.
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 60)), QR_CODE, AGORA)).toBeNull();
  });

  it("a janela é POR NÚMERO: cada oficial lê a própria chave", () => {
    const mapa = { ...pelo(OFICIAL.id, 300), ...pelo(OUTRO_OFICIAL.id, 60) };
    expect(seloDaJanela(conversa(mapa), OFICIAL, AGORA)?.restante).toBe(MINUTOS_DA_JANELA - 300);
    expect(seloDaJanela(conversa(mapa), OUTRO_OFICIAL, AGORA)?.restante).toBe(MINUTOS_DA_JANELA - 60);
    // Só o outro escreveu: este não tem janela.
    expect(seloDaJanela(conversa(pelo(OUTRO_OFICIAL.id, 60)), OFICIAL, AGORA)).toBeNull();
  });

  it("mensagem da Meta SEM carimbo conta para qualquer número oficial, como no fio", () => {
    const mapa = { [CHAVE_SEM_CARIMBO]: min(60) };
    expect(seloDaJanela(conversa(mapa), OFICIAL, AGORA)?.restante).toBe(MINUTOS_DA_JANELA - 60);
    expect(seloDaJanela(conversa(mapa), OUTRO_OFICIAL, AGORA)?.restante).toBe(MINUTOS_DA_JANELA - 60);
    expect(seloDaJanela(conversa(mapa), QR_CODE, AGORA)).toBeNull();
  });

  it("entre a chave do número e a sem carimbo, vale a mais recente", () => {
    expect(
      seloDaJanela(conversa({ ...pelo(OFICIAL.id, 300), [CHAVE_SEM_CARIMBO]: min(60) }), OFICIAL, AGORA)?.restante,
    ).toBe(MINUTOS_DA_JANELA - 60);
    expect(
      seloDaJanela(conversa({ ...pelo(OFICIAL.id, 60), [CHAVE_SEM_CARIMBO]: min(300) }), OFICIAL, AGORA)?.restante,
    ).toBe(MINUTOS_DA_JANELA - 60);
  });

  it("carimbo no futuro (relógio do aparelho atrasado) não passa de 24h", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, -30)), OFICIAL, AGORA)).toEqual({
      restante: MINUTOS_DA_JANELA,
      cor: "padrao",
    });
  });
});

describe("a lista e o fio nunca discordam sobre o que resta", () => {
  // O fio conta sobre as MENSAGENS (`minutosRestantes`); a lista, sobre o
  // mapa que o gatilho da 993 deixou na conversa. Mesmas mensagens, mesmo
  // instante, mesmo número de saída — mesmo restante.

  /** O que o gatilho da 993 grava para estas mensagens: a última do cliente por chave. */
  function mapaDoGatilho(mensagens: readonly MensagemDaJanela[]): Record<string, string> {
    const mapa: Record<string, string> = {};
    for (const m of mensagens) {
      if (m.sender_type !== "customer") continue;
      const carimbada = m.channel_id != null;
      const oficial = carimbada
        ? OFICIAIS.includes(m.channel_id!)
        : m.message_id?.startsWith(PREFIXO_DO_ID_DA_META);
      if (!oficial) continue;
      const chave = carimbada ? m.channel_id! : CHAVE_SEM_CARIMBO;
      if (!mapa[chave] || Date.parse(mapa[chave]) < Date.parse(m.created_at)) mapa[chave] = m.created_at;
    }
    return mapa;
  }

  // ⚠️ Os fracionários (0,5 e 1439,5) são o que pina o TRUNCAMENTO: em
  // minuto inteiro trunc/round/floor/ceil coincidem, e a suíte ficava verde
  // com a lista trocada para `Math.round` (achado da revisão do PR #194).
  const casos = [0.5, 1, 59, 60, 179, 180, 719, 720, 721, 1000, 1439, 1439.5];

  it.each(casos)("cliente escreveu há %s min pelo número oficial", (minutosAtras) => {
    const mensagens: MensagemDaJanela[] = [
      { sender_type: "agent", created_at: min(minutosAtras + 10), channel_id: OFICIAL.id },
      {
        sender_type: "customer",
        created_at: min(minutosAtras),
        channel_id: OFICIAL.id,
        message_id: `${PREFIXO_DO_ID_DA_META}ABC`,
      },
    ];
    const doFio = minutosRestantes(mensagens, new Date(AGORA), OFICIAL);
    const daLista = seloDaJanela(conversa(mapaDoGatilho(mensagens)), OFICIAL, AGORA);
    expect(daLista?.restante).toBe(doFio);
  });

  it("o minuto em curso ainda conta, nos dois lados", () => {
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 1439.5)), OFICIAL, AGORA)?.restante).toBe(1);
    expect(seloDaJanela(conversa(pelo(OFICIAL.id, 0.5)), OFICIAL, AGORA)?.restante).toBe(1440);
  });

  it("DOIS oficiais, cliente escreveu aos dois, conversa fixada no mais antigo: concordam (a 991 divergia)", () => {
    const mensagens: MensagemDaJanela[] = [
      { sender_type: "customer", created_at: min(300), channel_id: OFICIAL.id, message_id: `${PREFIXO_DO_ID_DA_META}A` },
      { sender_type: "customer", created_at: min(60), channel_id: OUTRO_OFICIAL.id, message_id: `${PREFIXO_DO_ID_DA_META}B` },
    ];
    const mapa = mapaDoGatilho(mensagens);
    for (const saida of [OFICIAL, OUTRO_OFICIAL, QR_CODE] as const) {
      const doFio = minutosRestantes(mensagens, new Date(AGORA), saida);
      const daLista = seloDaJanela(conversa(mapa), saida, AGORA)?.restante ?? 0;
      expect(daLista, `saída ${saida.id}`).toBe(doFio);
    }
    expect(minutosRestantes(mensagens, new Date(AGORA), OFICIAL)).toBe(1140);
  });

  it("mensagem da Meta sem carimbo, antes e depois da carimbada: os dois ficam com a mais recente", () => {
    const semCarimbo = (m: number) => ({
      sender_type: "customer",
      created_at: min(m),
      channel_id: null,
      message_id: `${PREFIXO_DO_ID_DA_META}X`,
    });
    const carimbada = (m: number) => ({
      sender_type: "customer",
      created_at: min(m),
      channel_id: OFICIAL.id,
      message_id: `${PREFIXO_DO_ID_DA_META}Y`,
    });
    for (const mensagens of [[semCarimbo(300), carimbada(60)], [carimbada(300), semCarimbo(60)]]) {
      for (const saida of [OFICIAL, OUTRO_OFICIAL] as const) {
        expect(seloDaJanela(conversa(mapaDoGatilho(mensagens)), saida, AGORA)?.restante ?? 0).toBe(
          minutosRestantes(mensagens, new Date(AGORA), saida),
        );
      }
    }
  });
});

describe("o gatilho da 993 espelha a regra do fio", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/993_cb_janela_da_meta_por_numero.sql"),
    "utf8",
  );

  it("reconhece a mensagem da Meta sem carimbo pelo MESMO prefixo, nas três ocorrências", () => {
    // Gatilho, acervo e conferência.
    const ocorrencias = sql.match(/LIKE '([^']+)%'/g) ?? [];
    expect(ocorrencias).toHaveLength(3);
    for (const o of ocorrencias) {
      expect(o).toBe(`LIKE '${PREFIXO_DO_ID_DA_META}%'`);
    }
  });

  it("a chave da mensagem sem carimbo é o mesmo literal do código", () => {
    expect(sql).toMatch(new RegExp(`v_chave := '${CHAVE_SEM_CARIMBO}';`));
    expect(sql).toMatch(new RegExp(`COALESCE\\(m\\.channel_id::text, '${CHAVE_SEM_CARIMBO}'\\)`));
  });

  it("a FORMA das linhas que carregam a regra, não só os literais", () => {
    // Polaridade: sem carimbo, quem NÃO é wamid sai; quem é, vai para sem_carimbo.
    expect(sql).toMatch(
      /ELSIF NEW\.message_id IS NULL OR NEW\.message_id NOT LIKE 'wamid\.%' THEN\s+RETURN NEW;/,
    );
    // Carimbada: só a conexão da Meta segue, na chave do número.
    expect(sql).toMatch(/IF v_kind IS DISTINCT FROM 'meta' THEN\s+RETURN NEW;\s+END IF;\s+v_chave := NEW\.channel_id::text;/);
    // Só o cliente dispara o gatilho.
    expect(sql).toMatch(/WHEN \(NEW\.sender_type = 'customer'\)/);
    // O UPDATE: grupo fora, cada chave só avança, e a chave é a do número.
    expect(sql).toMatch(
      /SET janela_meta = janela_meta \|\| jsonb_build_object\(v_chave, v_em\)\s+WHERE id = NEW\.conversation_id\s+AND group_id IS NULL\s+AND \(\(janela_meta -> v_chave\) IS NULL\s+OR \(janela_meta ->> v_chave\)::timestamptz < v_em\)/,
    );
  });

  it("conexão oficial apagada vira sem_carimbo, como a 902 faz com o carimbo das mensagens", () => {
    expect(sql).toMatch(/AFTER DELETE ON cb_channels/);
    expect(sql).toMatch(/IF OLD\.kind IS DISTINCT FROM 'meta' THEN\s+RETURN OLD;/);
    expect(sql).toMatch(/\(janela_meta - v_chave\) \|\| jsonb_build_object\(\s+'sem_carimbo',\s+GREATEST\(/);
  });

  it("as colunas da 991 saem", () => {
    expect(sql).toMatch(/DROP COLUMN IF EXISTS janela_meta_canal_id,\s+DROP COLUMN IF EXISTS janela_meta_desde/);
  });
});
