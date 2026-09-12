import type { SupabaseClient } from "@supabase/supabase-js";

import { classificar, ehDevida } from "./inadimplencia";
import type { CobrancaDoAsaas } from "./leitura";

/**
 * Gravar cobranças do Asaas no espelho — a função ÚNICA do ciclo (hoje) e do
 * webhook (Fase 2). I/O.
 *
 * ⚠️ O upsert leva só o ESTADO ATUAL da cobrança. `vista_vencida_em` — a
 * PRIMEIRA vez que o espelho a viu vencida — fica FORA do upsert e é
 * carimbada num UPDATE cercado por `IS NULL`: nunca reescrita. É o que
 * protege o marco de 1 dia da régua quando o Asaas só marca vencida no dia
 * útil seguinte (C7), e o que faz "ligar a régua não é retroativo" (D13)
 * valer de fato.
 *
 * ⚠️ `visto_em` é o INÍCIO da listagem que trouxe a cobrança, não "agora":
 * a reconciliação compara `visto_em < vencidas_listadas_em`, e as duas
 * precisam sair do MESMO instante — senão toda cobrança da listagem
 * pareceria "não voltou" no ciclo em que voltou.
 *
 * A FK exige a linha do cliente: quem chama garante `cb_asaas_clientes`
 * antes (o ciclo lê o cliente desconhecido no Asaas primeiro).
 */

/** Quantas cobranças por pedido ao PostgREST. */
export const LOTE = 100;

export interface LinhaDeCobranca {
  account_id: string;
  asaas_payment_id: string;
  asaas_customer_id: string;
  status: string;
  deleted: boolean;
  valor: number;
  juros_e_multa: number | null;
  vencimento: string;
  vencimento_original: string | null;
  pago_em: string | null;
  forma: string | null;
  pode_pagar_apos_vencimento: boolean | null;
  dias_ate_cancelar_registro: number | null;
  descricao: string | null;
  parcelamento_id: string | null;
  parcela_numero: number | null;
  link_fatura: string | null;
  link_boleto: string | null;
  visto_em: string;
  updated_at: string;
}

/** Puro: a cobrança lida do Asaas → a linha do espelho (sem `vista_vencida_em`). */
export function linhaDaCobranca(accountId: string, c: CobrancaDoAsaas, vistoEm: string): LinhaDeCobranca | null {
  // Sem cliente ou sem vencimento não há como guardar: a FK e o NOT NULL recusariam.
  if (!c.clienteId || !c.vencimento) return null;
  return {
    account_id: accountId,
    asaas_payment_id: c.id,
    asaas_customer_id: c.clienteId,
    status: c.status,
    deleted: c.apagado,
    valor: c.valor,
    juros_e_multa: c.jurosEMulta,
    vencimento: c.vencimento,
    vencimento_original: c.vencimentoOriginal,
    pago_em: c.pagoEm,
    forma: c.forma,
    pode_pagar_apos_vencimento: c.podePagarAposVencimento,
    dias_ate_cancelar_registro: c.diasAteCancelarRegistro,
    descricao: c.descricao?.slice(0, 500) ?? null,
    parcelamento_id: c.parcelamentoId,
    parcela_numero: c.parcelaNumero,
    link_fatura: c.linkFatura,
    link_boleto: c.linkBoleto,
    visto_em: vistoEm,
    updated_at: vistoEm,
  };
}

export interface ResultadoDaAplicacao {
  gravadas: number;
  /** vieram sem cliente ou sem vencimento e ficaram de fora */
  descartadas: number;
}

/**
 * Grava um lote de cobranças (em pedidos de `LOTE`) e carimba
 * `vista_vencida_em` nas que estão devidas e ainda não tinham o carimbo.
 * Lança em erro de banco — o ciclo trata.
 */
export async function aplicarCobrancas(
  admin: SupabaseClient,
  accountId: string,
  cobrancas: readonly CobrancaDoAsaas[],
  vistoEm: string,
): Promise<ResultadoDaAplicacao> {
  const linhas: LinhaDeCobranca[] = [];
  let descartadas = 0;
  for (const c of cobrancas) {
    const linha = linhaDaCobranca(accountId, c, vistoEm);
    if (linha) linhas.push(linha);
    else descartadas++;
  }
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const { error } = await admin.from("cb_asaas_cobrancas").upsert(lote, { onConflict: "account_id,asaas_payment_id" });
    if (error) throw new Error(`cobranças: ${error.message}`);
    const devidas = lote.filter((l) => ehDevida(classificar(l.status, l.deleted))).map((l) => l.asaas_payment_id);
    if (devidas.length > 0) {
      const { error: erroCarimbo } = await admin
        .from("cb_asaas_cobrancas")
        .update({ vista_vencida_em: vistoEm })
        .eq("account_id", accountId)
        .in("asaas_payment_id", devidas)
        .is("vista_vencida_em", null);
      if (erroCarimbo) throw new Error(`vista_vencida_em: ${erroCarimbo.message}`);
    }
  }
  return { gravadas: linhas.length, descartadas };
}

/** Uma cobrança só — o caminho do webhook e da reconciliação. */
export async function aplicarCobranca(admin: SupabaseClient, accountId: string, cobranca: CobrancaDoAsaas, vistoEm: string): Promise<boolean> {
  const r = await aplicarCobrancas(admin, accountId, [cobranca], vistoEm);
  return r.gravadas === 1;
}
