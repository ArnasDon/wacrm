// Motor das automações da equipe (mensagem, relatório, lembrete e alerta de
// gasto para os grupos do WhatsApp). Mesmas regras do motor antigo, que
// rodava como tarefa agendada até 30/09:
//   - pedido manual ("Disparar agora") dispara na hora, mesmo desligada;
//   - mensagem/relatório/lembrete: na hora marcada, nos dias marcados, 1x por dia;
//   - alerta: quando o gasto de hoje no Meta bate a condição, 1x por dia.
// Funções puras aqui; o envio fica em automacoes-servidor.ts.

export type Automacao = {
  id: string; org_id: string; tipo: "mensagem" | "relatorio" | "lembrete" | "alerta" | "sistema"; nome: string;
  group_jid: string | null; conteudo: string | null; horario: number | null; dias: number[] | null;
  cond_operador: ">" | ">=" | "<" | "<=" | null; cond_valor: number | string | null; enabled: boolean;
  last_run_date: string | null; run_requested: boolean;
};

/** Data (AAAA-MM-DD), hora (0–23) e dia da semana (domingo = 0) na Bahia. */
export function agoraBahia(d = new Date()) {
  const b = new Date(d.getTime() - 3 * 3_600_000);
  return { data: b.toISOString().slice(0, 10), hora: b.getUTCHours(), dia: b.getUTCDay() };
}

export function ontem(data: string): string {
  return new Date(Date.parse(data + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
}

export type Decisao = { disparar: false } | { disparar: true; motivo: "manual" | "horario" | "precisa_gasto" };

export function decidir(a: Automacao, agora: { data: string; hora: number; dia: number }): Decisao {
  if (a.tipo === "sistema") return { disparar: false };
  if (a.run_requested) return { disparar: true, motivo: "manual" };
  if (!a.enabled) return { disparar: false };
  if (a.last_run_date === agora.data) return { disparar: false };
  if (a.tipo === "alerta") return a.cond_operador && a.cond_valor != null ? { disparar: true, motivo: "precisa_gasto" } : { disparar: false };
  if (a.horario == null || a.horario !== agora.hora) return { disparar: false };
  if (!a.dias?.includes(agora.dia)) return { disparar: false };
  return { disparar: true, motivo: "horario" };
}

export function bateCondicao(gasto: number, op: Automacao["cond_operador"], valor: number): boolean {
  switch (op) {
    case ">": return gasto > valor;
    case ">=": return gasto >= valor;
    case "<": return gasto < valor;
    case "<=": return gasto <= valor;
    default: return false;
  }
}

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, " ");

export function textoDaAutomacao(a: Automacao, extra: { gastoOntem?: number; gastoHoje?: number; manual?: boolean }): string {
  let t = (a.conteudo ?? "").trim() || a.nome;
  if (a.tipo === "relatorio" && extra.gastoOntem != null) t += `\n\n💰 Gasto de ontem no Meta Ads: ${reais(extra.gastoOntem)}`;
  if (a.tipo === "alerta" && extra.gastoHoje != null) t = t.includes("{{valor}}") ? t.split("{{valor}}").join(reais(extra.gastoHoje)) : `${t}\n💰 Gasto de hoje: ${reais(extra.gastoHoje)}`;
  if (extra.manual) t += "\n_(disparo manual solicitado pelo sistema)_";
  return t;
}
