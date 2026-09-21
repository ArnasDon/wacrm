import { describe, expect, it } from "vitest";
import {
  areaDoDestino,
  DE_PARA,
  DeParaDesconhecido,
  destinoDoLead,
  DESTINO_DA_EMERGENCIA,
  ETAPAS_DE_DESTINO,
  ETIQUETA_DE_EMERGENCIA,
  FUNIL_DESCARTADO,
  FUNIS_DA_KOMMO,
  FUNIS_DE_DESTINO,
  GANHO_NA_KOMMO,
  PERDIDO_NA_KOMMO,
  normalizarEtiqueta,
} from "./de-para";

const K = FUNIS_DA_KOMMO;

/** Todos os leads vivos da Kommo em 19/09/2026 (levantamento). */
const LEADS_VIVOS = 12716;
/** Os 2 do funil Checkpoints, descartados por decisão do operador. */
const DESCARTADOS = 2;

describe("de-para da Kommo", () => {
  it("todo destino existe entre as 34 etapas do CB CRM", () => {
    for (const [par, linha] of Object.entries(DE_PARA)) {
      const etapas = ETAPAS_DE_DESTINO[linha.funil];
      expect(etapas, `funil desconhecido em ${par}`).toBeDefined();
      expect(
        etapas.includes(linha.etapa),
        `${par} (${linha.origem}) aponta para "${linha.etapa}", que não existe em ${linha.funil}`,
      ).toBe(true);
    }
  });

  it("são 34 etapas de destino, e os 4 funis", () => {
    const total = FUNIS_DE_DESTINO.reduce(
      (n, f) => n + ETAPAS_DE_DESTINO[f].length,
      0,
    );
    expect(total).toBe(34);
    expect(FUNIS_DE_DESTINO).toHaveLength(4);
  });

  it("a soma dos leads do de-para mais os descartados dá os leads vivos", () => {
    const soma = Object.values(DE_PARA).reduce((n, l) => n + l.leads, 0);
    expect(soma).toBe(LEADS_VIVOS - DESCARTADOS);
    expect(soma + DESCARTADOS).toBe(LEADS_VIVOS);
  });

  // ⚠️⚠️ O teste que justifica o arquivo inteiro: 142 e 143 são GLOBAIS.
  describe("142 e 143 são status globais, e o destino depende do FUNIL", () => {
    it("perdido do Trabalhista vai para o Perdido do Trabalhista", () => {
      expect(
        destinoDoLead({ pipelineId: K.trabalhista, statusId: PERDIDO_NA_KOMMO }),
      ).toEqual({ funil: "Trabalhista - Comercial", etapa: "Perdido" });
    });

    it("perdido do Pré Vendas vai para o Perdido do BANCÁRIO", () => {
      expect(
        destinoDoLead({ pipelineId: K.preVendas, statusId: PERDIDO_NA_KOMMO }),
      ).toEqual({ funil: "Bancário - Comercial", etapa: "Perdido" });
    });

    it("perdido do Closer e do Onboarding também vão para o Bancário", () => {
      for (const p of [K.closer, K.onboarding]) {
        expect(destinoDoLead({ pipelineId: p, statusId: PERDIDO_NA_KOMMO })).toEqual({
          funil: "Bancário - Comercial",
          etapa: "Perdido",
        });
      }
    });

    it("os quatro perdidos somam os 5.701 medidos", () => {
      const soma = [K.preVendas, K.trabalhista, K.closer, K.onboarding].reduce(
        (n, p) => n + DE_PARA[`${p}:${PERDIDO_NA_KOMMO}`].leads,
        0,
      );
      expect(soma).toBe(2924 + 2719 + 57 + 1);
      expect(soma).toBe(5701);
    });

    it("os 171 ganhos são todos do Trabalhista e vão para Protocolado", () => {
      expect(
        destinoDoLead({ pipelineId: K.trabalhista, statusId: GANHO_NA_KOMMO }),
      ).toEqual({ funil: "Trabalhista - Comercial", etapa: "Protocolado" });
      expect(DE_PARA[`${K.trabalhista}:${GANHO_NA_KOMMO}`].leads).toBe(171);

      const outros = [K.preVendas, K.closer, K.onboarding, K.juridico].reduce(
        (n, p) => n + (DE_PARA[`${p}:${GANHO_NA_KOMMO}`]?.leads ?? 0),
        0,
      );
      expect(outros).toBe(0);
    });

    it("o MESMO status em funis diferentes NÃO dá o mesmo destino", () => {
      const doTrabalhista = destinoDoLead({
        pipelineId: K.trabalhista,
        statusId: PERDIDO_NA_KOMMO,
      });
      const doBancario = destinoDoLead({
        pipelineId: K.preVendas,
        statusId: PERDIDO_NA_KOMMO,
      });
      expect(doTrabalhista).not.toEqual(doBancario);
    });
  });

  describe("o funil Checkpoints é descartado", () => {
    it("devolve null, não lança", () => {
      expect(
        destinoDoLead({ pipelineId: FUNIL_DESCARTADO, statusId: 87094883 }),
      ).toBeNull();
    });

    it("e nenhuma linha do de-para aponta para ele", () => {
      for (const par of Object.keys(DE_PARA)) {
        expect(par.startsWith(`${FUNIL_DESCARTADO}:`)).toBe(false);
      }
    });
  });

  describe("par desconhecido ABORTA, nunca adivinha", () => {
    it("lança DeParaDesconhecido", () => {
      expect(() => destinoDoLead({ pipelineId: K.trabalhista, statusId: 999999 })).toThrow(
        DeParaDesconhecido,
      );
    });

    it("a mensagem diz o par e onde consertar", () => {
      try {
        destinoDoLead({ pipelineId: 123, statusId: 456 });
        expect.unreachable("devia ter lançado");
      } catch (e) {
        expect((e as Error).message).toContain("pipeline 123");
        expect((e as Error).message).toContain("status 456");
        expect((e as Error).message).toContain("de-para.ts");
      }
    });
  });

  describe("a etiqueta CONTATO SEG. TRAB muda o destino", () => {
    it("leva o protocolado para Contato de Emergência", () => {
      expect(
        destinoDoLead({
          pipelineId: K.trabalhista,
          statusId: 87130471,
          etiquetas: ["CONTATO SEG. TRAB", "TRABALHISTA"],
        }),
      ).toEqual(DESTINO_DA_EMERGENCIA);
    });

    it("casa sem acento e sem caixa", () => {
      expect(
        destinoDoLead({
          pipelineId: K.trabalhista,
          statusId: 87130471,
          etiquetas: ["contato seg. trab"],
        }),
      ).toEqual(DESTINO_DA_EMERGENCIA);
    });

    // ⚠️ A exceção medida: 2 dos 242 estão em descarte.
    it("mas NÃO tira o lead do descarte", () => {
      expect(
        destinoDoLead({
          pipelineId: K.trabalhista,
          statusId: PERDIDO_NA_KOMMO,
          etiquetas: [ETIQUETA_DE_EMERGENCIA],
        }),
      ).toEqual({ funil: "Trabalhista - Comercial", etapa: "Perdido" });
    });

    it("sem a etiqueta, o destino é o da etapa", () => {
      expect(
        destinoDoLead({
          pipelineId: K.trabalhista,
          statusId: 87130471,
          etiquetas: ["TRABALHISTA"],
        }),
      ).toEqual({ funil: "Trabalhista - Comercial", etapa: "Protocolado" });
    });
  });

  describe("decisões do operador que o mapa tem de honrar", () => {
    it("documentos recebidos e Em Elaboração caem na mesma etapa (decisão 2)", () => {
      const a = destinoDoLead({ pipelineId: K.trabalhista, statusId: 87130451 });
      const b = destinoDoLead({ pipelineId: K.trabalhista, statusId: 87130463 });
      expect(a).toEqual(b);
      expect(a).toEqual({ funil: "Trabalhista - Jurídico", etapa: "Em Elaboração" });
    });

    it("documentos solicitados e docs com pendência viram Cliente Ativo (decisão 3)", () => {
      for (const st of [87721719, 87095275]) {
        expect(destinoDoLead({ pipelineId: K.onboarding, statusId: st })).toEqual({
          funil: "Bancário - Jurídico",
          etapa: "Cliente Ativo",
        });
      }
    });

    it("os dois No-Show viram a etapa No Show, que NÃO tem resultado (decisão 5)", () => {
      for (const st of [90021863, 87072727]) {
        expect(destinoDoLead({ pipelineId: K.preVendas, statusId: st })).toEqual({
          funil: "Bancário - Comercial",
          etapa: "No Show",
        });
      }
    });
  });

  describe("área, que é o que reparte um card por pessoa e por área", () => {
    it("os dois funis do Trabalhista são a mesma área", () => {
      expect(areaDoDestino({ funil: "Trabalhista - Comercial", etapa: "Perdido" })).toBe(
        "trabalhista",
      );
      expect(areaDoDestino({ funil: "Trabalhista - Jurídico", etapa: "Avulso" })).toBe(
        "trabalhista",
      );
    });

    it("os dois do Bancário também", () => {
      expect(areaDoDestino({ funil: "Bancário - Comercial", etapa: "Perdido" })).toBe(
        "bancario",
      );
      expect(areaDoDestino({ funil: "Bancário - Jurídico", etapa: "Cliente Ativo" })).toBe(
        "bancario",
      );
    });
  });

  describe("normalizarEtiqueta", () => {
    it("apara, tira acento e baixa a caixa", () => {
      expect(normalizarEtiqueta("  Bancário  ")).toBe("bancario");
    });

    it("casa a forma precomposta com a DECOMPOSTA", () => {
      // "Bancário" com U+00E1 e com "a" + U+0301 — a armadilha da 984.
      expect(normalizarEtiqueta("Bancário")).toBe(normalizarEtiqueta("Bancário"));
    });
  });
});
