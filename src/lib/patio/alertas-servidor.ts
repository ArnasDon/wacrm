import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderForAccount } from "@/lib/whatsapp/send-core";
import { FIRESTORE_PROJETO_PADRAO } from "@/lib/trafego/estoqueSite";
import { situacaoChave } from "./google";
import { carrosCompletos, campanhasNoPeriodo } from "./dados";
import { avaliar, type Regra } from "./regras";
import { itensDeCarros, itensDeCampanhas, itensDeConversas, mandarNosGrupos, type ConversaAberta } from "./alertas";
import type { Quem } from "./servidor";

const DIA = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Verificação diária: avalia as regras de cada loja e manda nos grupos as que pedem isso. */
export async function regrasNosGrupos(admin: SupabaseClient) {
  const { data: regras } = await admin.from("regras").select("id, org_id, nome, ativo, gatilho, condicoes, acoes").eq("ativo", true);
  const porLoja = new Map<string, Regra[]>();
  for (const r of (regras ?? []) as (Regra & { org_id: string })[]) {
    if (!r.acoes?.some((a) => a.tipo === "whatsapp_grupo")) continue;
    porLoja.set(r.org_id, [...(porLoja.get(r.org_id) ?? []), r]);
  }
  const saida: Record<string, unknown> = {};
  const agora = Date.now();
  for (const [orgId, lista] of porLoja) {
    try {
      const { data: cfg } = await admin.from("tr_config").select("estoque_firestore_projeto").eq("org_id", orgId).maybeSingle();
      const quem = { orgId, projeto: (cfg?.estoque_firestore_projeto as string) || FIRESTORE_PROJETO_PADRAO } as Quem;
      const precisa = new Set(lista.map((r) => r.gatilho));
      const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", orgId);
      const ids = (contas ?? []).map((c) => c.id as string);
      const [carros, campanhas, conversas] = await Promise.all([
        precisa.has("carro") && situacaoChave() === "ok" ? carrosCompletos(quem, admin) : Promise.resolve([]),
        precisa.has("campanha") ? campanhasNoPeriodo(admin, orgId, iso(agora - 30 * DIA), iso(agora)) : Promise.resolve([]),
        precisa.has("conversa") && ids.length
          ? admin.from("conversations").select("id, last_message_at, contact:contacts(name, phone)").in("account_id", ids).gt("unread_count", 0).neq("status", "closed").limit(200).then((r) => (r.data ?? []) as unknown as ConversaAberta[])
          : Promise.resolve([] as ConversaAberta[]),
      ]);
      const alertas = avaliar(lista, { carro: itensDeCarros(carros), campanha: itensDeCampanhas(campanhas), conversa: itensDeConversas(conversas, agora) });
      saida[orgId] = await mandarNosGrupos(admin, orgId, alertas, async (conta, para, texto) => {
        const p = await getProviderForAccount(admin, conta);
        await p.sendText({ to: para, text: texto });
      });
    } catch (e) {
      saida[orgId] = { erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return saida;
}
