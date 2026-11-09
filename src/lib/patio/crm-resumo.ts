import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/trafego/fetchAll";

// Números do CRM para o Relatório: conversas, tempo de resposta, funil,
// origem dos clientes, visitas e atendimento por vendedor. Lidos com o
// login de quem pede (as regras do banco recortam o que cada um vê).

export type Msg = { conversation_id: string; sender_type: string; created_at: string };

/** Tempo até a primeira resposta de uma PESSOA da loja (o robô não conta) depois de cada mensagem do cliente, em minutos. */
export function temposDeResposta(msgs: Msg[]): number[] {
  const ordenadas = [...msgs].sort((a, b) => a.conversation_id.localeCompare(b.conversation_id) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const saida: number[] = [];
  let conv = "";
  let espera: number | null = null;
  for (const m of ordenadas) {
    if (m.conversation_id !== conv) { conv = m.conversation_id; espera = null; }
    const t = Date.parse(m.created_at);
    if (m.sender_type === "customer") { if (espera == null) espera = t; }
    else if (m.sender_type === "agent" && espera != null) { saida.push((t - espera) / 60000); espera = null; }
  }
  return saida.filter((x) => x >= 0);
}

export function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type ResumoCrm = {
  conversasNovas: number;
  msgsRecebidas: number;
  msgsEnviadas: number;
  resposta: { mediana: number | null; media: number | null; ate5min: number | null; amostras: number; parcial: boolean };
  funil: { criados: number; abertos: number; ganhos: number; perdidos: number; valorGanho: number };
  origens: { origem: string; clientes: number }[];
  visitas: { agendadas: number; realizadas: number; faltou: number; canceladas: number };
  vendedores: { id: string; nome: string; conversas: number; negocios: number; ganhos: number }[];
};

const LIMITE_MSGS = 30_000;

export async function resumoCrm(db: SupabaseClient, deISO: string, ateISO: string): Promise<ResumoCrm> {
  const [conv, recebidas, enviadas, deals, contatos, visitas, perfis] = await Promise.all([
    fetchAll((a, b) => db.from("conversations").select("id, assigned_agent_id").gte("created_at", deISO).lte("created_at", ateISO).order("id").range(a, b)),
    db.from("messages").select("id", { count: "exact", head: true }).eq("sender_type", "customer").gte("created_at", deISO).lte("created_at", ateISO),
    db.from("messages").select("id", { count: "exact", head: true }).neq("sender_type", "customer").gte("created_at", deISO).lte("created_at", ateISO),
    fetchAll((a, b) => db.from("deals").select("id, status, value, assigned_to").gte("created_at", deISO).lte("created_at", ateISO).order("id").range(a, b)),
    fetchAll((a, b) => db.from("contacts").select("id, origem").gte("created_at", deISO).lte("created_at", ateISO).order("id").range(a, b)),
    fetchAll((a, b) => db.from("visitas").select("id, status").gte("quando", deISO).lte("quando", ateISO).order("id").range(a, b)),
    db.from("profiles").select("id, user_id, full_name, email"),
  ]);

  // Mensagens para o tempo de resposta: paginado, com teto para não pesar.
  const msgs: Msg[] = [];
  let parcial = false;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from("messages").select("conversation_id, sender_type, created_at").gte("created_at", deISO).lte("created_at", ateISO).order("id").range(de, de + 999);
    if (error) break;
    msgs.push(...((data ?? []) as Msg[]));
    if ((data ?? []).length < 1000) break;
    if (msgs.length >= LIMITE_MSGS) { parcial = true; break; }
  }
  const tempos = temposDeResposta(msgs);

  const nome = new Map<string, string>();
  for (const p of (perfis.data ?? []) as { id: string; user_id: string; full_name: string | null; email: string | null }[]) {
    const n = p.full_name || p.email || "Sem nome";
    nome.set(p.id, n); nome.set(p.user_id, n);
  }
  const vend = new Map<string, { conversas: number; negocios: number; ganhos: number }>();
  const add = (id: string | null | undefined, k: "conversas" | "negocios" | "ganhos") => {
    if (!id) return;
    const v = vend.get(id) ?? { conversas: 0, negocios: 0, ganhos: 0 };
    v[k]++; vend.set(id, v);
  };
  for (const c of conv.data as { assigned_agent_id: string | null }[]) add(c.assigned_agent_id, "conversas");
  const dl = deals.data as { status: string | null; value: number | string | null; assigned_to: string | null }[];
  for (const d of dl) { add(d.assigned_to, "negocios"); if (d.status === "won") add(d.assigned_to, "ganhos"); }

  const origens = new Map<string, number>();
  for (const c of contatos.data as { origem: string | null }[]) origens.set(c.origem || "Não informada", (origens.get(c.origem || "Não informada") ?? 0) + 1);
  const vis = visitas.data as { status: string }[];

  return {
    conversasNovas: conv.data.length,
    msgsRecebidas: recebidas.count ?? 0,
    msgsEnviadas: enviadas.count ?? 0,
    resposta: {
      mediana: mediana(tempos),
      media: tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null,
      ate5min: tempos.length ? tempos.filter((x) => x <= 5).length / tempos.length : null,
      amostras: tempos.length,
      parcial,
    },
    funil: {
      criados: dl.length,
      abertos: dl.filter((d) => (d.status ?? "open") === "open" || d.status === "active").length,
      ganhos: dl.filter((d) => d.status === "won").length,
      perdidos: dl.filter((d) => d.status === "lost").length,
      valorGanho: dl.filter((d) => d.status === "won").reduce((s, d) => s + (Number(d.value) || 0), 0),
    },
    origens: [...origens].map(([origem, clientes]) => ({ origem, clientes })).sort((a, b) => b.clientes - a.clientes),
    visitas: {
      agendadas: vis.length,
      realizadas: vis.filter((v) => v.status === "realizada").length,
      faltou: vis.filter((v) => v.status === "faltou").length,
      canceladas: vis.filter((v) => v.status === "cancelada").length,
    },
    vendedores: [...vend].map(([id, v]) => ({ id, nome: nome.get(id) ?? "Sem nome", ...v })).sort((a, b) => b.conversas - a.conversas),
  };
}
