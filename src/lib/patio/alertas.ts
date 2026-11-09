import type { SupabaseClient } from "@supabase/supabase-js";
import type { CarroResumo, CampanhaPeriodo } from "./resumo";
import type { Item, Alerta } from "./regras";

// Monta os itens que as regras da loja olham (carros, campanhas, conversas) e
// manda os alertas com ação "mandar no grupo" para o grupo do WhatsApp.
// Usado pela tela Hoje (/api/resumo) e pela verificação diária (/api/trafego/sync).

const IMP = 1.12; // imposto do Meta

export function itensDeCarros(carros: CarroResumo[]): Item[] {
  return carros
    .filter((c) => ["available", "reserved", "unavailable"].includes(c.status ?? "available"))
    .map((c) => ({
      id: c.id,
      nome: [c.brand, c.model, c.versao].filter(Boolean).join(" "),
      href: `/patio/${c.id}`,
      valores: {
        ...(c.dias != null ? { dias_no_patio: c.dias } : {}),
        conversas_30d: c.anuncios?.msgs ?? 0,
        gasto_30d: c.anuncios?.gasto ?? 0, // já com imposto
        preco: Number(c.finance?.sale_price) || 0,
        tem_anuncio: c.anuncios?.campanhas.length ? 1 : 0,
      },
    }));
}

export function itensDeCampanhas(campanhas: CampanhaPeriodo[]): Item[] {
  return campanhas
    .filter((c) => c.gasto > 0 || c.msgs > 0)
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      href: "/trafego/campanhas",
      valores: {
        gasto: c.gasto * IMP,
        conversas: c.msgs,
        ...(c.msgs ? { custo_por_conversa: (c.gasto * IMP) / c.msgs } : {}),
        carro_vendido: c.carro === "vendido" ? 1 : 0,
        sem_carro: c.carro === "sem" ? 1 : 0,
      },
    }));
}

export type ConversaAberta = { id: string; last_message_at: string | null; contact: { name: string | null; phone: string } | null };

export function itensDeConversas(conversas: ConversaAberta[], agora: number): Item[] {
  return conversas
    .filter((c) => c.last_message_at)
    .map((c) => ({
      id: c.id,
      nome: c.contact?.name || c.contact?.phone || "Cliente",
      href: `/inbox?conversation=${c.id}`,
      valores: { minutos_sem_resposta: Math.floor((agora - Date.parse(c.last_message_at!)) / 60000) },
    }));
}

/** Texto da mensagem do grupo. */
export function textoDoAlerta(a: Pick<Alerta, "regra" | "itens">, base = "https://crmwga.com"): string {
  const linhas = a.itens.slice(0, 10).map((it) => `• ${it.nome} — ${base}${it.href}`);
  if (a.itens.length > 10) linhas.push(`e mais ${a.itens.length - 10}`);
  return `🔔 *${a.regra}*\n${a.itens.length === 1 ? "1 item" : `${a.itens.length} itens`}:\n${linhas.join("\n")}`;
}

/** Endereço do grupo no formato que o provedor entende. */
export function destinoDoGrupo(telefone: string, provedor: string): string | null {
  if (provedor === "meta") return null; // a API oficial não manda em grupos
  if (provedor === "uazapi" && !telefone.includes("@")) return `${telefone}@g.us`;
  return telefone;
}

type Enviar = (accountId: string, para: string, texto: string) => Promise<void>;

/** Manda no grupo cada alerta cuja regra pede isso. Devolve o que foi feito. */
export async function mandarNosGrupos(admin: SupabaseClient, orgId: string, alertas: Alerta[], enviar: Enviar) {
  const feito: { regra: string; grupo: string; ok: boolean; erro?: string }[] = [];
  const pedidos = alertas.flatMap((a) => a.acoes.filter((x) => x.tipo === "whatsapp_grupo").map((x) => ({ a, grupo: (x as { grupo: string }).grupo })));
  if (!pedidos.length) return feito;
  const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", orgId);
  const ids = (contas ?? []).map((c) => c.id as string);
  if (!ids.length) return feito;
  const { data: cfgs } = await admin.from("whatsapp_config").select("account_id, provider").in("account_id", ids);
  const provedor = new Map(((cfgs ?? []) as { account_id: string; provider: string }[]).map((c) => [c.account_id, c.provider]));
  for (const { a, grupo } of pedidos) {
    try {
      const { data: gs } = await admin
        .from("contacts")
        .select("account_id, phone, name")
        .in("account_id", ids)
        .in("kind", ["group", "community"])
        .ilike("name", grupo.replace(/[%_]/g, (m) => `\\${m}`))
        .limit(5);
      const g = ((gs ?? []) as { account_id: string; phone: string }[]).find((x) => provedor.has(x.account_id));
      const para = g ? destinoDoGrupo(g.phone, provedor.get(g.account_id)!) : null;
      if (!g || !para) {
        feito.push({ regra: a.regra, grupo, ok: false, erro: "grupo não encontrado num WhatsApp que manda em grupos" });
        continue;
      }
      await enviar(g.account_id, para, textoDoAlerta(a));
      feito.push({ regra: a.regra, grupo, ok: true });
    } catch (e) {
      feito.push({ regra: a.regra, grupo, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return feito;
}

