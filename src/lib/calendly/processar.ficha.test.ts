import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// A FICHA DO CLIENTE NASCE DO AGENDAMENTO (08/09/2026, decisão do operador
// revendo a D2 do plano).
//
// Medido em produção: os dois primeiros agendamentos de gente de verdade
// foram processados 4,2 s e 4,5 s ANTES de a ficha existir — ela nascia por
// acaso, quando o OUTRO CRM do escritório mandava a primeira mensagem pelo
// celular pareado. Esse CRM vai ser desligado; sem criar a ficha aqui,
// nenhum lead novo teria em quem a automação agir.
// ============================================================

const busca = vi.hoisted(() => ({ findExistingContact: vi.fn() }));
vi.mock("@/lib/contacts/dedupe", () => busca);

const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);

const destino = vi.hoisted(() => ({ resolverDestinatario: vi.fn() }));
vi.mock("@/lib/automations/destinatario", () => destino);

import { comFichaNova, processarAgendamento } from "./processar";
import { EVENTO_AGENDADO, type Agendamento } from "./payload";

const AGENDAMENTO: Agendamento = {
  evento: EVENTO_AGENDADO,
  inviteeUri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  eventoUri: "https://api.calendly.com/event_types/T1",
  eventoNome: "Reunião com Advogado",
  eventoAgendadoUri: null,
  nome: "Joel",
  email: null,
  telefone: "5519980000004",
  telefoneOrigem: "heuristica",
  inicio: "2026-09-09T19:00:00Z",
  fim: null,
  link: null,
  local: null,
  cancelarUrl: null,
  remarcarUrl: null,
  reagendado: false,
  fusoDoConvidado: null,
  perguntas: [],
};

let automacoes: unknown[] = [];
const admin = {
  from(tabela: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      // O nome do agendamento é fixado na ficha e no negócio (999) — o
      // comportamento é coberto em `processar.nome.test.ts`.
      update: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabela === "automations" ? automacoes : [], error: null }).then(f),
    };
    return b;
  },
} as unknown as SupabaseClient;

const ESCUTA = [{ trigger_type: "calendly_booking", trigger_config: {}, is_active: true }];

beforeEach(() => {
  automacoes = ESCUTA;
  busca.findExistingContact.mockReset().mockResolvedValue({ contato: null, falhou: false });
  destino.resolverDestinatario.mockReset().mockResolvedValue({ contactId: "novo-1", conversationId: "conv-nova", criouContato: true });
  motor.dispararAutomacoes.mockReset().mockResolvedValue({ candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 });
});

describe("processarAgendamento — telefone que não é de nenhum contato", () => {
  it("CRÍTICO: cria a ficha com o nome do Calendly e dispara a automação", async () => {
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);

    expect(destino.resolverDestinatario).toHaveBeenCalledWith(admin, "acct-1", "5519980000004", "Joel");
    expect(r).toMatchObject({ resultado: "disparado", contactId: "novo-1" });
    expect(r.detalhe).toContain("ficha criada");
    // A conversa recém-criada é a do disparo, sem uma segunda consulta.
    expect(motor.dispararAutomacoes.mock.calls[0][0]).toMatchObject({
      contactId: "novo-1",
      context: { conversation_id: "conv-nova", channel_id: null },
    });
  });

  it("CRÍTICO: sem automação escutando, NÃO cria ficha — lead que ninguém pediu", async () => {
    automacoes = [];
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
    expect(r.resultado).toBe("sem_automacao");
  });

  it("contato que já existe não passa pela criação", async () => {
    busca.findExistingContact.mockResolvedValue({ contato: { id: "c1", phone: "5519980000004" }, falhou: false });
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
    expect(r).toMatchObject({ resultado: "disparado", contactId: "c1" });
    expect(r.detalhe).not.toContain("ficha criada");
  });

  it("⚠️ falha ao criar vira `sem_contato` (reprocessável), não `falhou`", async () => {
    destino.resolverDestinatario.mockRejectedValue(new Error("dono da conta não resolvido"));
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("sem_contato");
    expect(r.detalhe).toContain("dono da conta");
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
  });

  it("busca do contato que FALHA não vira criação — duplicaria a ficha", async () => {
    busca.findExistingContact.mockResolvedValue({ contato: null, falhou: true });
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("falhou");
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
  });

  it("agendamento sem telefone continua parando antes de tudo", async () => {
    const r = await processarAgendamento(admin, "acct-1", { ...AGENDAMENTO, telefone: null });
    expect(r.resultado).toBe("sem_telefone");
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
  });
});

describe("comFichaNova", () => {
  it("só marca quando a ficha nasceu agora", () => {
    const base = { resultado: "disparado" as const, detalhe: "1 automação", contactId: "c1" };
    expect(comFichaNova(base, false)).toBe(base);
    expect(comFichaNova(base, true).detalhe).toBe("ficha criada a partir do agendamento — 1 automação");
    expect(comFichaNova({ ...base, detalhe: null }, true).detalhe).toContain("sem detalhe");
  });
});
