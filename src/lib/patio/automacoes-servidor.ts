import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderForAccount } from "@/lib/whatsapp/send-core";
import { tokensMetaDasLojas } from "@/lib/trafego/servidor";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { agoraBahia, bateCondicao, decidir, ehDemandas, GRUPO_DEMANDAS, ontem, textoDaAutomacao, textoDemandas, type Automacao } from "./automacoes";

type Resultado = { id: string; nome: string; status: "success" | "error" | "pulado"; resumo: string };

async function gastoDoDia(admin: SupabaseClient, orgId: string, data: string): Promise<number> {
  const { data: linhas } = await fetchAll((a, b) => admin.from("tr_campaign_metrics_daily").select("id, gasto").eq("org_id", orgId).eq("data", data).order("id").range(a, b));
  return (linhas as { gasto: number | string }[]).reduce((s, l) => s + (Number(l.gasto) || 0), 0);
}

/** Gasto de hoje direto do Meta (a sincronização guardada é diária). */
async function gastoDeHojeNoMeta(admin: SupabaseClient, orgId: string, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const { data: cred } = await admin.from("tr_integration_credentials").select("referencia_externa").eq("org_id", orgId).eq("provedor", "facebook").eq("ativo", true).maybeSingle();
  const conta = String(cred?.referencia_externa ?? "").replace(/^act_/, "");
  if (!/^\d{5,25}$/.test(conta)) return null;
  const r = await fetch(`https://graph.facebook.com/v23.0/act_${conta}/insights?fields=spend&date_preset=today&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { data?: { spend?: string }[]; error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(`Meta: ${j.error?.message ?? r.status}`);
  return (j.data ?? []).reduce((s, x) => s + (Number(x.spend) || 0), 0);
}

/**
 * Roda as automações da equipe. Sem `so`, olha todas as lojas (agendador);
 * com `so`, só aquela automação (botão "Disparar agora").
 */
export async function rodarAutomacoes(admin: SupabaseClient, opcoes: { so?: { orgId: string; id: string }; agora?: Date } = {}): Promise<Resultado[]> {
  const agora = agoraBahia(opcoes.agora);
  let q = admin.from("tr_automations").select("id, org_id, tipo, nome, group_jid, conteudo, horario, dias, cond_operador, cond_valor, enabled, last_run_date, run_requested");
  if (opcoes.so) q = q.eq("org_id", opcoes.so.orgId).eq("id", opcoes.so.id);
  const { data, error } = await q;
  if (error) throw new Error(`tr_automations: ${error.message}`);
  const lista = (data ?? []) as Automacao[];
  const saida: Resultado[] = [];
  const tokens = await tokensMetaDasLojas(admin, [...new Set(lista.map((a) => a.org_id))]).catch(() => ({}) as Record<string, string>);
  const contaWhats = new Map<string, string | null>();

  for (const a of lista) {
    const dec = decidir(a, agora);
    if (!dec.disparar) continue;
    const manual = dec.motivo === "manual";
    try {
      let gastoHoje: number | undefined;
      if (a.tipo === "alerta") {
        const g = await gastoDeHojeNoMeta(admin, a.org_id, tokens[a.org_id]);
        if (g == null) throw new Error("Sem o token do Meta ou a conta de anúncios para ler o gasto de hoje.");
        gastoHoje = g;
        if (!manual && !bateCondicao(g, a.cond_operador, Number(a.cond_valor))) continue; // ainda não bateu
      }
      // Reserva o disparo antes de enviar: dois agendadores ao mesmo tempo não mandam duas vezes.
      const { data: reservado } = await admin
        .from("tr_automations")
        .update({ last_run_date: agora.data, run_requested: false, run_requested_at: null })
        .eq("id", a.id)
        .or(`last_run_date.is.null,last_run_date.neq.${agora.data},run_requested.eq.true`)
        .select("id");
      if (!reservado?.length) continue;

      const destino = a.group_jid || (ehDemandas(a) ? GRUPO_DEMANDAS : null);
      if (!destino) throw new Error("Sem grupo escolhido.");
      if (!contaWhats.has(a.org_id)) {
        const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", a.org_id);
        const ids = (contas ?? []).map((c) => c.id as string);
        const { data: cfg } = ids.length ? await admin.from("whatsapp_config").select("account_id, provider").in("account_id", ids).neq("provider", "meta").limit(1) : { data: [] };
        contaWhats.set(a.org_id, ((cfg ?? []) as { account_id: string }[])[0]?.account_id ?? null);
      }
      const conta = contaWhats.get(a.org_id);
      if (!conta) throw new Error("Nenhum WhatsApp que mande em grupos está ligado (a API oficial do Meta não manda em grupos).");
      const gastoOntem = a.tipo === "relatorio" ? await gastoDoDia(admin, a.org_id, ontem(agora.data)) : undefined;
      const texto = ehDemandas(a) ? textoDemandas(agora, manual) : textoDaAutomacao(a, { gastoOntem, gastoHoje, manual });
      const prov = await getProviderForAccount(admin, conta);
      await prov.sendText({ to: destino, text: texto });
      const resumo = a.tipo === "alerta" ? `Alerta disparado (gasto: R$ ${gastoHoje!.toFixed(2).replace(".", ",")}).` : ehDemandas(a) ? "Cota do dia enviada pro grupo." : "Mensagem enviada.";
      await registrar(admin, a, "success", resumo);
      saida.push({ id: a.id, nome: a.nome, status: "success", resumo });
    } catch (e) {
      const resumo = e instanceof Error ? e.message.slice(0, 300) : String(e);
      await registrar(admin, a, "error", resumo);
      saida.push({ id: a.id, nome: a.nome, status: "error", resumo });
    }
  }
  return saida;
}

async function registrar(admin: SupabaseClient, a: Automacao, status: "success" | "error", resumo: string) {
  const agora = new Date().toISOString();
  await admin.from("tr_automations").update({ last_run_at: agora, last_run_status: status, last_run_summary: resumo, run_requested: false, run_requested_at: null }).eq("id", a.id);
  await admin.from("tr_automations_history").insert({ org_id: a.org_id, automation_id: a.id, sent_at: agora, status, summary: resumo });
}
