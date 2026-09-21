import { describe, expect, it } from "vitest";

import { cartaoDoCalendly, type ConfigDoCalendly, type EventoDoCalendly , type ResultadoDoEvento } from "./cartao";

const config: ConfigDoCalendly = {
  user_name: "Leonardo",
  user_email: "l@cb.com",
  scheduling_url: "https://calendly.com/cb",
  webhook_uri: "https://api.calendly.com/webhook_subscriptions/W1",
  webhook_scope: "organization",
  webhook_state: "active",
  pergunta_telefone: "WhatsApp",
  status: "conectado",
  last_event_at: "2026-09-07T10:00:00Z",
  last_error: null,
};

function evento(resultado: string): EventoDoCalendly {
  return {
    id: crypto.randomUUID(),
    evento: "invitee.created",
    nome: "Marcelo",
    telefone: "5596991126767",
    telefone_origem: "pergunta",
    event_type_nome: "Reunião",
    inicio: "2026-08-26T16:45:00Z",
    contact_id: null,
    resultado,
    detalhe: null,
    recebido_em: "2026-09-07T10:00:00Z",
  };
}

describe("cartaoDoCalendly", () => {
  it("sem config: não conectado, contagem zerada", () => {
    const c = cartaoDoCalendly(null, []);
    expect(c.estado).toBe("nao_conectado");
    expect(c.usuario).toBeNull();
    expect(c.contagem.disparado).toBe(0);
  });

  it("conectado com webhook ativo", () => {
    const c = cartaoDoCalendly(config, [evento("disparado"), evento("disparado"), evento("sem_contato"), evento("em_espera"), evento("lixo")]);
    expect(c.estado).toBe("conectado");
    expect(c.usuario).toEqual({ nome: "Leonardo", email: "l@cb.com", agenda: "https://calendly.com/cb" });
    expect(c.webhook).toEqual({ escopo: "organization", estado: "active" });
    expect(c.perguntaTelefone).toBe("WhatsApp");
    expect(c.contagem).toMatchObject({ disparado: 2, sem_contato: 1, em_espera: 1 });
    expect(c.erro).toBeNull();
  });

  it("assinatura desativada pelo Calendly é ERRO com motivo próprio — o operador precisa reassinar", () => {
    const c = cartaoDoCalendly({ ...config, webhook_state: "disabled" }, []);
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("webhook_desativado");
    expect(c.webhook).toEqual({ escopo: "organization", estado: "disabled" });
  });

  it("sem assinatura nenhuma também é erro", () => {
    const c = cartaoDoCalendly({ ...config, webhook_uri: null }, []);
    expect(c.estado).toBe("erro");
    expect(c.webhook).toBeNull();
  });

  it("status erro carrega o código gravado", () => {
    const c = cartaoDoCalendly({ ...config, status: "erro", last_error: "token_invalido" }, []);
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("token_invalido");
  });
});

// ------------------------------------------------------------
// ⚠️ CHAVES MONTADAS: o cartão pede `calendly.resultado.${r}` e
// `calendly.motivo.${codigo}`, e os dois portões de i18n do CI são CEGOS para
// isso — a paridade só compara os dois dicionários entre si (ficam iguais e
// errados do mesmo jeito) e o de chaves usadas só enxerga literal. Foi assim
// que `assinatura_incompleta` nasceu dentro de `metaAds.motivo` e passou
// verde nos dois (Codex, PR #235). Este teste é o que cobra.
// ------------------------------------------------------------
describe("as chaves montadas do cartão existem nos dois dicionários", () => {
  const RESULTADOS: ResultadoDoEvento[] = [
    "recebido",
    "disparado",
    "em_espera",
    "cancelado",
    "sem_automacao",
    "sem_contato",
    "sem_telefone",
    "ignorado",
    "falhou",
  ];

  for (const arquivo of ["messages/pt-BR.json", "messages/en.json"]) {
    it(`${arquivo} tem resultado.* e motivo.assinatura_incompleta sob calendly`, async () => {
      const { readFileSync } = await import("node:fs");
      const d = JSON.parse(readFileSync(arquivo, "utf-8"));
      const calendly = d.Settings.integracoes.calendly;
      for (const r of RESULTADOS) {
        expect(calendly.resultado?.[r], `falta calendly.resultado.${r}`).toBeTruthy();
      }
      expect(calendly.motivo?.assinatura_incompleta, "falta calendly.motivo.assinatura_incompleta").toBeTruthy();
    });
  }
});
