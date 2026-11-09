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

/** A automação de sistema "Demandas do time" (cota de conteúdo do dia, de manhã). */
export const ehDemandas = (a: Pick<Automacao, "tipo" | "nome">) => a.tipo === "sistema" && /demandas/i.test(a.nome);
export const GRUPO_DEMANDAS = "120363429202081229@g.us"; // IBOX PRIME | MARKETING

export function decidir(a: Automacao, agora: { data: string; hora: number; dia: number }): Decisao {
  if (ehDemandas(a)) {
    if (a.run_requested) return { disparar: true, motivo: "manual" };
    if (!a.enabled || a.last_run_date === agora.data) return { disparar: false };
    return (a.horario ?? 8) === agora.hora ? { disparar: true, motivo: "horario" } : { disparar: false };
  }
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

const DIAS_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const TEMA_DARK = ["", "assuntos em alta", "modelo específico do estoque", "curiosidade", "história (real ou inventada)", "modelo polêmico", "assuntos em alta"];

/** Mensagem da manhã com as entregas do dia (a mesma lista da automação antiga). */
export function textoDemandas(agora: { data: string; dia: number }, manual = false): string {
  const [, m, d] = agora.data.split("-");
  const fim = manual ? "\n_(disparo manual solicitado pelo sistema)_" : "";
  if (agora.dia === 0) return `☀️ Domingo — sem cota fixa de conteúdo hoje. Bom descanso, time!${fim}`;
  return [
    `📋 *Demandas de hoje — ${DIAS_PT[agora.dia]}, ${d}/${m}*`,
    "",
    "Bom dia, time! Essas são as entregas de hoje:",
    "",
    "🎯 *Gabriel* — pauta até 08h30, aprovar os 2 lotes, tráfego no ar, GMN em dia",
    "🎬 *Abel* — 4 carrosséis de carro + 4 vídeos, lotes às 13h e 16h",
    "🎨 *Raziel* — 2 imagens + 1 carrossel + 2 Reels IA + ajustes de site",
    `✏️ *Dark* — carrossel temático (${TEMA_DARK[agora.dia]}) + capas dos carros + mín. 4 Reels editados`,
    "🎥 *Will / Rapha / Apolo* — Reels do rodízio · Rapha/Apolo também atualizam OLX e WebMotors",
    "",
    "✅ Bom trabalho, time! 💪",
  ].join("\n") + fim;
}
