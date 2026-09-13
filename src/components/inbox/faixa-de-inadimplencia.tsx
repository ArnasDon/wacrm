"use client";

// ============================================================
// A faixa INADIMPLENTE, logo acima do compositor (Fase 1b do plano do
// Asaas). Vermelha, e no FIO, pelo mesmo motivo da faixa de agendadas:
// quem abre a conversa precisa esbarrar nisso ANTES de escrever — a
// resposta a um cliente que deve há 40 dias é outra.
//
// ⚠️ Só aparece com parcela VENCIDA vista na última listagem completa
// (`dividaDoContato`): o mesmo ícone da linha da lista, a mesma régua. E
// cala com `divida` nula — que é também "ainda não sei": nada aqui afirma
// "em dia".
//
// ⚠️ Cor de texto em PAR claro/escuro (`text-red-700 dark:text-red-300`),
// como o cartão de falha do fio: `text-red-300` sozinho é ilegível no tema
// claro, medido em 09/09.
// ============================================================

import { CircleDollarSign } from "lucide-react";
import { useTranslations } from "next-intl";

import { diaPorExtenso, dinheiro, rotulosDasParcelas, type ResumoDeDivida } from "@/lib/asaas/inadimplencia";

interface FaixaDeInadimplenciaProps {
  divida: ResumoDeDivida | null;
  /** Início da última listagem completa das vencidas — "dados do Asaas de …". */
  atualizadoEm: string | null;
  /** `false` = o espelho está parado: a faixa diz de quando é o dado. */
  leituraFresca: boolean;
  /** Abre a aba Cobranças do painel. Ausente = sem o botão. */
  aoVerCobrancas?: () => void;
}

/** `dd/mm hh:mm` no fuso de quem lê. */
function quandoFoi(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FaixaDeInadimplencia({ divida, atualizadoEm, leituraFresca, aoVerCobrancas }: FaixaDeInadimplenciaProps) {
  const t = useTranslations("Inbox.cobrancas");
  if (!divida || divida.vencidas.length === 0) return null;
  const quando = atualizadoEm ? quandoFoi(atualizadoEm) : null;
  // `dias` negativo é vencimento PRORROGADO (renegociada para a frente, C9):
  // "há -3 dias" seria absurdo, então a linha do "desde" some.
  const desde = divida.desde && divida.dias !== null && divida.dias >= 0 ? t("faixaDesde", { dias: divida.dias, desde: diaPorExtenso(divida.desde) }) : null;
  // "parcelas 9/12, 10/12 e 11/12" quando todas são numeradas (é o que a
  // equipe fala com o cliente); cobrança avulsa cai na contagem.
  const numeradas = divida.vencidas.every((p) => p.parcela_numero !== null);
  const resumo = numeradas
    ? t("faixaParcelas", { rotulos: rotulosDasParcelas(divida.vencidas), valor: dinheiro(divida.totalAtualizado) })
    : t("faixaResumo", { parcelas: divida.vencidas.length, valor: dinheiro(divida.totalAtualizado) });

  return (
    <div
      role="status"
      className="mx-3 mt-2 flex max-w-full items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
    >
      <CircleDollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t("faixaTitulo")}
          {divida.negativada && <span className="ml-1 rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-semibold uppercase">{t("negativada")}</span>}
        </p>
        <p className="break-words">
          {resumo}
          {desde ? ` · ${desde}` : ""}
        </p>
        {!leituraFresca && quando && <p className="text-red-700/70 dark:text-red-300/70">{t("faixaDadosDe", { quando })}</p>}
      </div>
      {aoVerCobrancas && (
        <button
          type="button"
          onClick={aoVerCobrancas}
          className="shrink-0 rounded-md border border-red-500/40 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-red-500/15"
        >
          {t("verCobrancas")}
        </button>
      )}
    </div>
  );
}
