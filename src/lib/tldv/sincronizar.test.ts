import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

import { TldvError, type ClienteTldv } from "./cliente";
import type { FraseDaTranscricao, ReuniaoDoTldv } from "./leitura";
import { importarReuniaoDoTldv, MAX_TENTATIVAS, sincronizarTldv } from "./sincronizar";

/**
 * Dublê do Supabase: guarda as linhas de `cb_reunioes_transcritas` num mapa
 * por id do tl;dv e responde às formas que `sincronizar.ts` usa. Não vale
 * como teste de PostgREST — vale como pino do COMPORTAMENTO: o que o upsert
 * preserva, quem é vinculado pelo e-mail, quando a tentativa vira desistência.
 */

interface Linha {
  id: string;
  tldv_meeting_id: string;
  status: string;
  contact_id: string | null;
  vinculo_origem: string | null;
  tentativas: number;
  [k: string]: unknown;
}

interface Estado {
  linhas: Map<string, Linha>;
  contatos: { id: string; email: string }[];
  /** agendamentos do Calendly (977) já ligados a um contato */
  agendamentos: { contact_id: string; email: string }[];
  equipe: string[];
  config: { patches: Record<string, unknown>[] };
  upserts: Record<string, unknown>[];
}

function estadoInicial(extra: Partial<Estado> = {}): Estado {
  return { linhas: new Map(), contatos: [], agendamentos: [], equipe: [], config: { patches: [] }, upserts: [], ...extra };
}

function dubleDoAdmin(estado: Estado, semConfig = false): SupabaseClient {
  let proximoId = 1;
  function from(tabela: string) {
    const filtros: { op: string; col: string; val: unknown }[] = [];
    let op: "select" | "upsert" | "update" = "select";
    let patch: Record<string, unknown> = {};
    let linhasDoUpsert: Record<string, unknown> | null = null;

    const idFiltrado = () => filtros.find((f) => f.op === "eq" && f.col === "id")?.val as string | undefined;
    const linhaPorId = (id: string | undefined) => [...estado.linhas.values()].find((l) => l.id === id);

    function resolverLista(): { data: unknown; error: null } {
      if (tabela === "profiles") return { data: estado.equipe.map((email) => ({ email })), error: null };
      if (tabela === "contacts" || tabela === "cb_calendly_eventos") {
        const or = filtros.find((f) => f.op === "or")?.val as string;
        const emails = [...or.matchAll(/email\.ilike\."([^"]+)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1").toLowerCase());
        if (tabela === "contacts") {
          return { data: estado.contatos.filter((c) => emails.includes(c.email.toLowerCase())).map((c) => ({ id: c.id })), error: null };
        }
        return {
          data: estado.agendamentos.filter((a) => emails.includes(a.email.toLowerCase())).map((a) => ({ contact_id: a.contact_id })),
          error: null,
        };
      }
      if (tabela === "cb_reunioes_transcritas") {
        if (op === "update") {
          const alvo = linhaPorId(idFiltrado());
          if (!alvo) return { data: [], error: null };
          const exigeNulo = filtros.some((f) => f.op === "is" && f.col === "contact_id");
          if (exigeNulo && alvo.contact_id !== null) return { data: [], error: null };
          Object.assign(alvo, patch);
          return { data: [{ id: alvo.id }], error: null };
        }
        const status = filtros.find((f) => f.op === "eq" && f.col === "status")?.val;
        return { data: [...estado.linhas.values()].filter((l) => !status || l.status === status), error: null };
      }
      throw new Error(`dublê sem resposta para ${tabela}/${op}`);
    }

    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      limit: () => q,
      or: (s: string) => (filtros.push({ op: "or", col: "", val: s }), q),
      eq: (col: string, val: unknown) => (filtros.push({ op: "eq", col, val }), q),
      is: (col: string, val: unknown) => (filtros.push({ op: "is", col, val }), q),
      not: (col: string, op: string, val: unknown) => (filtros.push({ op: `not.${op}`, col, val }), q),
      upsert: (linha: Record<string, unknown>) => {
        op = "upsert";
        linhasDoUpsert = linha;
        estado.upserts.push(linha);
        return q;
      },
      update: (p: Record<string, unknown>) => {
        op = "update";
        patch = p;
        if (tabela === "cb_tldv_config") estado.config.patches.push(p);
        return q;
      },
      single: async () => {
        if (tabela === "cb_reunioes_transcritas" && op === "upsert" && linhasDoUpsert) {
          const meetingId = linhasDoUpsert.tldv_meeting_id as string;
          const existente = estado.linhas.get(meetingId);
          if (existente) {
            // metadados atualizados; status/cliente/vínculo preservados
            Object.assign(existente, { titulo: linhasDoUpsert.titulo, participantes: linhasDoUpsert.participantes });
            return { data: { ...existente }, error: null };
          }
          const nova: Linha = {
            id: `linha-${proximoId++}`,
            tldv_meeting_id: meetingId,
            status: "pendente",
            contact_id: null,
            vinculo_origem: null,
            tentativas: 0,
            titulo: linhasDoUpsert.titulo,
          };
          estado.linhas.set(meetingId, nova);
          return { data: { ...nova }, error: null };
        }
        throw new Error(`single() inesperado em ${tabela}`);
      },
      maybeSingle: async () => {
        if (tabela === "cb_tldv_config") {
          return semConfig ? { data: null, error: null } : { data: { api_key: encrypt("tldv_chave_de_teste_123"), last_sync_at: null }, error: null };
        }
        if (tabela === "cb_reunioes_transcritas") {
          const alvo = linhaPorId(idFiltrado());
          return { data: alvo ? { contact_id: alvo.contact_id } : null, error: null };
        }
        throw new Error(`maybeSingle() inesperado em ${tabela}`);
      },
      then: (resolver: (r: unknown) => unknown) => {
        if (tabela === "cb_tldv_config") return resolver({ data: null, error: null });
        return resolver(resolverLista());
      },
    };
    return q;
  }
  return { from } as unknown as SupabaseClient;
}

function reuniao(id: string, convidados: { nome: string; email: string }[] = []): ReuniaoDoTldv {
  return {
    id,
    nome: `Reunião ${id}`,
    realizadaEm: "2026-09-08T14:00:00.000Z",
    url: `https://tldv.io/app/meetings/${id}`,
    duracaoSeg: 1800,
    organizador: { nome: "Leonardo", email: "leonardo@escritorio.example" },
    convidados,
  };
}

const FRASES: FraseDaTranscricao[] = [{ orador: "Leonardo", texto: "Bom dia.", inicioSeg: 0, fimSeg: 1 }];

function clienteFalso(opcoes: {
  reunioes?: ReuniaoDoTldv[];
  transcricoes?: Record<string, FraseDaTranscricao[] | null | TldvError>;
  listar?: () => never;
}): ClienteTldv {
  const reunioes = opcoes.reunioes ?? [];
  return {
    listarReunioes: async () => {
      if (opcoes.listar) opcoes.listar();
      return { reunioes, pagina: 1, paginas: 1, total: reunioes.length };
    },
    reuniao: async (id) => {
      const r = reunioes.find((x) => x.id === id);
      if (!r) throw new TldvError("nao_encontrado", "404: Meeting not found");
      return r;
    },
    transcricao: async (id) => {
      const t = opcoes.transcricoes?.[id];
      if (t instanceof TldvError) throw t;
      return t ?? null;
    },
    notas: async () => ({ markdown: "# Notas", topicos: [] }),
  };
}

const M1 = "aaaaaaaaaaaaaaaaaaaaaaaa";
const M2 = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("sincronizarTldv", () => {
  const agora = new Date("2026-09-09T12:00:00Z");

  it("grava a reunião nova, vincula pelo e-mail do convidado de fora e busca a transcrição", async () => {
    const estado = estadoInicial({
      contatos: [{ id: "c-marcelo", email: "Marcelo@Example.com" }],
      equipe: ["leonardo@escritorio.example", "isa@escritorio.example"],
    });
    const cliente = clienteFalso({
      reunioes: [reuniao(M1, [{ nome: "Isa", email: "isa@escritorio.example" }, { nome: "Marcelo", email: "marcelo@example.com" }])],
      transcricoes: { [M1]: FRASES },
    });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r).toEqual({ ok: true, reunioes: 1, transcritas: 1, vinculadas: 1, adiadas: 0 });
    const linha = estado.linhas.get(M1)!;
    expect(linha.contact_id).toBe("c-marcelo");
    expect(linha.vinculo_origem).toBe("email");
    expect(linha.status).toBe("pronta");
    expect(linha.texto).toBe("Leonardo: Bom dia.");
    expect(linha.notas).toBe("# Notas");
    // o upsert leva SÓ metadados: nem status, nem cliente, nem vínculo
    expect(Object.keys(estado.upserts[0])).not.toEqual(expect.arrayContaining(["status", "contact_id", "vinculo_origem", "texto"]));
    expect(estado.config.patches.at(-1)).toMatchObject({ status: "conectado", last_error: null });
  });

  it("contato SEM e-mail na ficha, mas com agendamento no Calendly pelo mesmo e-mail: vincula pela ponte", async () => {
    const estado = estadoInicial({
      contatos: [],
      agendamentos: [{ contact_id: "c-paulo", email: "Paulo@Exemplo.com.br" }],
      equipe: ["leonardo@escritorio.example"],
    });
    // A forma REAL medida em 09/09: convidado sem nome, só o e-mail.
    const cliente = clienteFalso({ reunioes: [reuniao(M1, [{ nome: "", email: "paulo@exemplo.com.br" }])] });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r.ok && r.vinculadas).toBe(1);
    expect(estado.linhas.get(M1)).toMatchObject({ contact_id: "c-paulo", vinculo_origem: "email" });
  });

  it("a ficha vence a ponte: com e-mail na ficha, o Calendly nem é consultado", async () => {
    const estado = estadoInicial({
      contatos: [{ id: "c-ficha", email: "a@x.com" }],
      agendamentos: [{ contact_id: "c-calendly", email: "a@x.com" }],
    });
    const cliente = clienteFalso({ reunioes: [reuniao(M1, [{ nome: "A", email: "a@x.com" }])] });
    await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(estado.linhas.get(M1)!.contact_id).toBe("c-ficha");
  });

  it("dois clientes na mesma reunião: ninguém é vinculado (decisão de gente)", async () => {
    const estado = estadoInicial({
      contatos: [
        { id: "c1", email: "a@x.com" },
        { id: "c2", email: "b@x.com" },
      ],
    });
    const cliente = clienteFalso({ reunioes: [reuniao(M1, [{ nome: "A", email: "a@x.com" }, { nome: "B", email: "b@x.com" }])] });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r.ok && r.vinculadas).toBe(0);
    expect(estado.linhas.get(M1)!.contact_id).toBeNull();
  });

  it("desvinculada à mão NÃO é religada; já vinculada é preservada pelo upsert", async () => {
    const estado = estadoInicial({ contatos: [{ id: "c1", email: "a@x.com" }] });
    estado.linhas.set(M1, { id: "linha-x", tldv_meeting_id: M1, status: "pronta", contact_id: null, vinculo_origem: "desvinculada", tentativas: 3 });
    estado.linhas.set(M2, { id: "linha-y", tldv_meeting_id: M2, status: "pronta", contact_id: "c-outro", vinculo_origem: "manual", tentativas: 1 });
    const cliente = clienteFalso({
      reunioes: [reuniao(M1, [{ nome: "A", email: "a@x.com" }]), reuniao(M2, [{ nome: "A", email: "a@x.com" }])],
    });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r.ok && r.vinculadas).toBe(0);
    expect(estado.linhas.get(M1)!.contact_id).toBeNull();
    expect(estado.linhas.get(M2)!.contact_id).toBe("c-outro");
    expect(estado.linhas.get(M2)!.vinculo_origem).toBe("manual");
  });

  it("transcrição ainda não pronta conta tentativa; na última vira `sem_transcricao`", async () => {
    const estado = estadoInicial();
    estado.linhas.set(M1, { id: "linha-1", tldv_meeting_id: M1, status: "pendente", contact_id: null, vinculo_origem: null, tentativas: 0 });
    estado.linhas.set(M2, { id: "linha-2", tldv_meeting_id: M2, status: "pendente", contact_id: null, vinculo_origem: null, tentativas: MAX_TENTATIVAS - 1 });
    const cliente = clienteFalso({ reunioes: [], transcricoes: { [M1]: null, [M2]: null } });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r.ok && r.transcritas).toBe(0);
    expect(estado.linhas.get(M1)).toMatchObject({ status: "pendente", tentativas: 1 });
    expect(estado.linhas.get(M2)).toMatchObject({ status: "sem_transcricao", tentativas: MAX_TENTATIVAS });
  });

  it("403 (plano de quem organizou) vira `falhou` na hora, sem gastar as doze tentativas", async () => {
    const estado = estadoInicial();
    estado.linhas.set(M1, { id: "linha-1", tldv_meeting_id: M1, status: "pendente", contact_id: null, vinculo_origem: null, tentativas: 0 });
    const cliente = clienteFalso({ transcricoes: { [M1]: new TldvError("sem_permissao", "403") } });
    await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(estado.linhas.get(M1)).toMatchObject({ status: "falhou", erro: "sem_permissao", tentativas: 1 });
  });

  it("chave recusada: o ciclo para, a config vai a `erro` com o CÓDIGO e nada carimba a sincronização", async () => {
    const estado = estadoInicial();
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const cliente = clienteFalso({
      listar: () => {
        throw new TldvError("chave_invalida", "401: Invalid api key «chave»");
      },
    });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    expect(r).toEqual({ ok: false, codigo: "chave_invalida" });
    expect(estado.config.patches.at(-1)).toMatchObject({ status: "erro", last_error: "chave_invalida" });
    expect(estado.config.patches.some((p) => "last_sync_at" in p)).toBe(false);
    // A TENTATIVA fica carimbada mesmo assim: é o que manda a conta que
    // falhou para o fim da fila do cron, em vez de deixá-la na frente para
    // sempre (Codex, PR #163).
    expect(estado.config.patches[0]).toEqual({ last_sync_attempt_at: agora.toISOString() });
    espiao.mockRestore();
  });

  it("carimba a tentativa ANTES de falar com o tl;dv — é o rodízio do cron", async () => {
    const estado = estadoInicial();
    let carimbadaAntes = false;
    const cliente = clienteFalso({
      listar: () => {
        carimbadaAntes = estado.config.patches.some((p) => "last_sync_attempt_at" in p);
        throw new TldvError("rede", "fora do ar");
      },
    });
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente });
    espiao.mockRestore();
    expect(carimbadaAntes).toBe(true);
  });

  it("sem config: `nao_conectado`, sem tocar o tl;dv", async () => {
    const estado = estadoInicial();
    const cliente = clienteFalso({
      listar: () => {
        throw new Error("não devia chamar");
      },
    });
    expect(await sincronizarTldv(dubleDoAdmin(estado, true), "conta", { agora, cliente: () => cliente })).toEqual({ ok: false, codigo: "nao_conectado" });
  });

  it("prazo vencido adia as transcrições pendentes em vez de estourar o ciclo", async () => {
    const estado = estadoInicial();
    estado.linhas.set(M1, { id: "linha-1", tldv_meeting_id: M1, status: "pendente", contact_id: null, vinculo_origem: null, tentativas: 0 });
    const cliente = clienteFalso({ transcricoes: { [M1]: FRASES } });
    const r = await sincronizarTldv(dubleDoAdmin(estado), "conta", { agora, cliente: () => cliente, prazoMs: 0 });
    expect(r).toEqual({ ok: true, reunioes: 0, transcritas: 0, vinculadas: 0, adiadas: 1 });
    expect(estado.linhas.get(M1)!.status).toBe("pendente");
  });
});

describe("importarReuniaoDoTldv", () => {
  const agora = new Date("2026-09-09T12:00:00Z");

  it("busca UMA reunião pelo id, vincula pelo e-mail e grava a transcrição", async () => {
    const estado = estadoInicial({ contatos: [{ id: "c1", email: "a@x.com" }] });
    const cliente = clienteFalso({ reunioes: [reuniao(M1, [{ nome: "A", email: "a@x.com" }])], transcricoes: { [M1]: FRASES } });
    const r = await importarReuniaoDoTldv(dubleDoAdmin(estado), "conta", M1, { agora, cliente: () => cliente });
    expect(r).toEqual({ ok: true, id: "linha-1", status: "pronta", contactId: "c1" });
    // importar não é varredura: `last_sync_at` fica como está
    expect(estado.config.patches.some((p) => "last_sync_at" in p)).toBe(false);
  });

  it("id que o tl;dv não conhece: `nao_encontrado`, nada gravado", async () => {
    const estado = estadoInicial();
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await importarReuniaoDoTldv(dubleDoAdmin(estado), "conta", M2, { agora, cliente: () => clienteFalso({}) });
    expect(r).toEqual({ ok: false, codigo: "nao_encontrado" });
    expect(estado.linhas.size).toBe(0);
    expect(estado.config.patches).toEqual([]);
    espiao.mockRestore();
  });
});
