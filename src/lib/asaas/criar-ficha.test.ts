import { describe, expect, it } from "vitest";

import { criarFichaDoAsaas, ETIQUETA_DA_FICHA, etiquetarFichasCriadas, mesmoNumero } from "./criar-ficha";
import { dubleDoSupabase, type EstadoDoDuble } from "./duble.test-helper";

const CONTA = "conta-1";
const DONO = "dono-1";

function estado(contacts: Record<string, unknown>[] = [], accounts: Record<string, unknown>[] = [{ id: CONTA, owner_user_id: DONO }]): EstadoDoDuble {
  return { tabelas: { accounts, contacts, tags: [], contact_tags: [] }, escritas: [] };
}

describe("mesmoNumero", () => {
  it("igual ou a irmã do nono dígito; sufixo de outro DDD não", () => {
    expect(mesmoNumero("5583988745316", "5583988745316")).toBe(true);
    expect(mesmoNumero("558388745316", "5583988745316")).toBe(true);
    expect(mesmoNumero("5521988745316", "5583988745316")).toBe(false);
    expect(mesmoNumero(null, "5583988745316")).toBe(false);
  });
});

describe("criarFichaDoAsaas", () => {
  it("cria o contato com o DONO da conta, o nome do Asaas e a etiqueta `asaas`", async () => {
    const e = estado();
    const r = await criarFichaDoAsaas(dubleDoSupabase(e), CONTA, { nome: "João Pedro Souza", telefone: "5584999990000" });
    expect(r).toMatchObject({ ok: true, criou: true });
    const ficha = e.tabelas.contacts[0];
    expect(ficha).toMatchObject({ account_id: CONTA, user_id: DONO, phone: "5584999990000", name: "João Pedro Souza" });
    expect(e.tabelas.tags[0]).toMatchObject({ name: ETIQUETA_DA_FICHA, account_id: CONTA, user_id: DONO });
    expect(e.tabelas.contact_tags[0]).toMatchObject({ contact_id: ficha.id, tag_id: e.tabelas.tags[0].id });
  });

  it("nome vazio no Asaas: a ficha nasce com o telefone como nome", async () => {
    const e = estado();
    await criarFichaDoAsaas(dubleDoSupabase(e), CONTA, { nome: "  ", telefone: "5584999990000" });
    expect(e.tabelas.contacts[0].name).toBe("5584999990000");
  });

  it("ficha com o MESMO número (irmã do 9) já existe: liga a ela, não cria", async () => {
    const e = estado([{ id: "c1", account_id: CONTA, user_id: DONO, phone: "558499990000", name: "João" }]);
    const r = await criarFichaDoAsaas(dubleDoSupabase(e), CONTA, { nome: "João Pedro", telefone: "5584999990000" });
    expect(r).toEqual({ ok: true, contactId: "c1", criou: false, etiquetada: false });
    expect(e.tabelas.contacts).toHaveLength(1);
  });

  it("ficha cujo SUFIXO bate com outro número: não cria, não liga, devolve o candidato (D5)", async () => {
    const e = estado([{ id: "c1", account_id: CONTA, user_id: DONO, phone: "5521999990000", name: "Outra Pessoa" }]);
    const r = await criarFichaDoAsaas(dubleDoSupabase(e), CONTA, { nome: "João Pedro", telefone: "5584999990000" });
    expect(r).toEqual({ ok: false, codigo: "sufixo", candidatoId: "c1" });
    expect(e.tabelas.contacts).toHaveLength(1);
  });

  it("sem dono resolvido, NADA é criado (falha fechada)", async () => {
    const e = estado([], []);
    const r = await criarFichaDoAsaas(dubleDoSupabase(e), CONTA, { nome: "João", telefone: "5584999990000" });
    expect(r).toEqual({ ok: false, codigo: "sem_dono" });
    expect(e.tabelas.contacts).toHaveLength(0);
  });

  it("o contexto compartilhado resolve o dono e a etiqueta UMA vez para várias fichas", async () => {
    const e = estado();
    const admin = dubleDoSupabase(e);
    const contexto = {};
    await criarFichaDoAsaas(admin, CONTA, { nome: "A", telefone: "5584999990001" }, contexto);
    await criarFichaDoAsaas(admin, CONTA, { nome: "B", telefone: "5584999990002" }, contexto);
    expect(contexto).toEqual({ dono: DONO, tagId: e.tabelas.tags[0].id });
    expect(e.tabelas.tags).toHaveLength(1);
    expect(e.tabelas.contact_tags).toHaveLength(2);
    // a segunda ficha não releu o catálogo: um upsert de tags só, no total
    expect(e.escritas.filter((w) => w.tabela === "tags")).toHaveLength(1);
  });

  it("o erro do upsert da etiqueta NÃO é engolido: a ficha nasce, `etiquetada` volta false", async () => {
    const e = estado();
    const admin = dubleDoSupabase(e);
    const original = admin.from.bind(admin);
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t !== "contact_tags") return original(t);
      // O Supabase devolve `{ error }` em erro de banco — não lança.
      const q: Record<string, unknown> = { upsert: () => q, then: (r: (x: unknown) => unknown) => r({ data: null, error: { message: "boom" } }) };
      return q;
    };
    const r = await criarFichaDoAsaas(admin, CONTA, { nome: "A", telefone: "5584999990001" });
    expect(r).toMatchObject({ ok: true, criou: true, etiquetada: false });
    expect(e.tabelas.contacts).toHaveLength(1);
  });

  it("etiquetarFichasCriadas põe a etiqueta só em quem não a tem, num upsert só", async () => {
    const e = estado([
      { id: "c1", account_id: CONTA, user_id: DONO, phone: "5584999990001", name: "A" },
      { id: "c2", account_id: CONTA, user_id: DONO, phone: "5584999990002", name: "B" },
    ]);
    const admin = dubleDoSupabase(e);
    const contexto = {};
    await criarFichaDoAsaas(admin, CONTA, { nome: "C", telefone: "5584999990003" }, contexto);
    const c3 = e.tabelas.contacts[2].id as string;
    const n = await etiquetarFichasCriadas(admin, CONTA, ["c1", "c2", c3], contexto);
    expect(n).toBe(2);
    expect(e.tabelas.contact_tags.map((t) => t.contact_id).sort()).toEqual(["c1", "c2", c3].sort());
    expect(await etiquetarFichasCriadas(admin, CONTA, ["c1", "c2", c3], contexto)).toBe(0);
  });

  it("corrida: o índice único recusa o insert e a ficha vencedora é reaproveitada", async () => {
    const e = estado();
    const admin = dubleDoSupabase(e);
    // Entre a busca e o insert, alguém grava o mesmo número: o dublê recusa
    // com 23505 na segunda inserção. Simulamos criando ANTES pelo próprio
    // dublê a partir de um insert concorrente.
    const original = admin.from.bind(admin);
    let buscas = 0;
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, unknown> & { like: (...a: unknown[]) => unknown };
      if (t === "contacts") {
        const like = q.like;
        q.like = (...a: unknown[]) => {
          if (++buscas === 1) e.tabelas.contacts.push({ id: "corrida", account_id: CONTA, user_id: DONO, phone: "5584999990000", phone_normalized: "5584999990000", name: "Concorrente" });
          return like.apply(q, a);
        };
      }
      return q;
    };
    const r = await criarFichaDoAsaas(admin, CONTA, { nome: "João", telefone: "5584999990000" });
    expect(r).toEqual({ ok: true, contactId: "corrida", criou: false, etiquetada: false });
    expect(e.tabelas.contacts).toHaveLength(1);
  });
});
