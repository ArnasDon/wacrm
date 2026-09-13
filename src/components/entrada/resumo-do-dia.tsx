'use client';

// ============================================================
// O cartão da ENTRADA: o que está com a pessoa hoje, antes de o app abrir.
//
// ⚠️ Ele é ENXUTO de propósito (F5, pedido do operador em 12/09): números do
// dia e UM caminho para a frente — o botão que abre a aba /meu-dia, que é
// onde se trabalha. Antes, o cartão listava tarefas e conversas com link em
// cada item, e a aba era uma cópia dele; agora as listas vivem em
// `components/meu-dia/blocos-pessoais.tsx`, montadas pela aba.
//
// Só APRESENTA. Os números vêm de `useResumoDoDia`, a regra de "aparece ou
// não" mora na porta (`porta-de-entrada.tsx`) e as contagens em
// `src/lib/resumo-do-dia/contagens.ts`. Cada bloco tem estado próprio:
// carregando (traço), falhou (aviso) ou pronto — nunca "0" sem resposta, e a
// falha de um bloco NÃO apaga o que o vizinho já carregou.
//
// ⚠️ O botão "Abrir Meu dia" CONFIRMA antes de navegar (`onContinuar` no
// clique), como qualquer link daqui: a porta fica acima da página roteada,
// então navegar sem confirmar trocaria a URL e deixaria esta tela na frente
// da aba que a pessoa pediu.
//
// ⚠️ O relógio da tela (saudação, data) é o instante da DECISÃO da porta,
// passado por prop — não o das consultas, que só existe depois de a primeira
// responder (a saudação diria "boa tarde" às 8h com a rede lenta).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Sunrise } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Novidades } from '@/components/meu-dia/blocos-pessoais';
import { useResumoDoDia } from '@/hooks/use-resumo-do-dia';
import { podeVerTela } from '@/lib/perfis/visibilidade';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { cn } from '@/lib/utils';

/** Quanto tempo o botão espera pelas consultas antes de liberar de qualquer jeito. */
export const TETO_DE_ESPERA_MS = 8_000;

/** A partir daqui o rótulo "desde a sua última entrada" leva a data, não só o dia da semana. */
const SEIS_DIAS_MS = 6 * 24 * 60 * 60_000;

interface Props {
  userId: string;
  accountId: string;
  /** O contexto de acesso REAL (nunca a lente do "Ver como"). */
  ctx: ContextoDeAcesso;
  primeiroNome: string | null;
  /** O instante da decisão da porta — o relógio desta tela. */
  agoraMs: number;
  /** Desde quando contar novidades — a confirmação anterior neste aparelho. */
  desdeMs: number;
  /** A âncora é a confirmação anterior? Senão, a janela é "últimas 24 h". */
  temConfirmacaoAnterior: boolean;
  onContinuar: () => void;
  /** Sai deste aparelho; devolve a mensagem de erro, ou null com sucesso. */
  onSair: () => Promise<string | null>;
}

export function ResumoDoDia({
  userId,
  accountId,
  ctx,
  primeiroNome,
  agoraMs,
  desdeMs,
  temConfirmacaoAnterior,
  onContinuar,
  onSair,
}: Props) {
  const t = useTranslations('ResumoDoDia');
  // O erro do "Sair" é UMA chave, compartilhada com o "Sair" do menu (use-auth).
  const tShell = useTranslations('DashboardShell');
  const router = useRouter();
  const resumo = useResumoDoDia({ userId, accountId, ctx, desdeMs });

  // O botão espera as consultas — senão "Continuar" sobre zeros de carga
  // afirmaria "nada pendente" — mas não para sempre: sem rede, a pessoa
  // entra do mesmo jeito depois do teto.
  const [passouDoTeto, setPassouDoTeto] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPassouDoTeto(true), TETO_DE_ESPERA_MS);
    return () => clearTimeout(id);
  }, []);
  const carregando = [
    resumo.novidades,
    resumo.tarefas,
    resumo.conversas,
    resumo.fila,
  ].some((b) => b.status === 'carregando');
  const podeContinuar = !carregando || passouDoTeto;

  // A tela substitui o app inteiro: o foco vai para ela, senão teclado e
  // leitor de tela continuam "na página anterior", que já não existe.
  const cartaoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cartaoRef.current?.focus();
  }, []);

  const [saindo, setSaindo] = useState(false);
  const sair = async () => {
    setSaindo(true);
    const erro = await onSair();
    if (erro !== null) {
      setSaindo(false);
      toast.error(tShell('signOutError', { message: erro }));
    }
  };

  const veNotificacoes = podeVerTela(ctx, 'notifications');

  const agora = new Date(agoraMs);
  const hora = agora.getHours();
  const saudacao = primeiroNome
    ? hora < 12
      ? t('greetingMorning', { nome: primeiroNome })
      : hora < 18
        ? t('greetingAfternoon', { nome: primeiroNome })
        : t('greetingEvening', { nome: primeiroNome })
    : hora < 12
      ? t('greetingMorningPlain')
      : hora < 18
        ? t('greetingAfternoonPlain')
        : t('greetingEveningPlain');

  // "sáb., 14:30" é ambíguo depois de uma semana — qual sábado? Aí entra a data.
  const quando = new Date(desdeMs).toLocaleString(
    undefined,
    agoraMs - desdeMs > SEIS_DIAS_MS
      ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', hour: '2-digit', minute: '2-digit' }
  );

  // A aba é a MESMA tela protegida do menu; ela não está no catálogo de
  // perfis (`telaDoCaminho` devolve null), então não há gate a consultar.
  //
  // ⚠️⚠️ A JANELA VAI NA URL, e isso é o contrário de um detalhe.
  // `onContinuar` GRAVA a confirmação de agora antes de navegar, e a aba
  // monta o pedido dela relendo esse registro — sem o parâmetro, ela abriria
  // com `desdeMs` = o instante do clique e diria "nada de novo" sobre
  // exatamente as pendências que a pessoa clicou para tratar (Codex, PR
  // #202). Levar `desde` preserva a janela que ESTE cartão mostrou.
  const abrirMeuDia = () => {
    onContinuar();
    // ⚠️ A PROVENIÊNCIA vai junto (`conf`), não só o carimbo. Sem ela, a aba
    // tratava toda janela herdada como confirmação e escrevia "desde a sua
    // última entrada" para quem nunca entrou neste aparelho — ali a janela é
    // o recuo de 24 h, e o cartão diz isso (Codex, PR #202).
    const conf = temConfirmacaoAnterior ? '1' : '0';
    router.push(`/meu-dia?desde=${desdeMs}&conf=${conf}`);
  };

  return (
    <div className="w-full">
      <div
        ref={cartaoRef}
        tabIndex={-1}
        className="border-border bg-card mx-auto w-full max-w-lg rounded-xl border p-5 shadow-xl outline-none sm:p-6"
      >
        <p className="text-muted-foreground text-xs">
          {agora.toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="text-foreground mt-1 text-xl font-semibold">
          {saudacao}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('intro')}</p>

        {/* ---------------- Novidades ---------------- */}
        <section className="mt-5">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {temConfirmacaoAnterior ? t('sinceLast', { quando }) : t('last24h')}
          </h2>
          <Novidades
            bloco={resumo.novidades}
            veNotificacoes={veNotificacoes}
            onContinuar={onContinuar}
            comLink={false}
          />
        </section>

        {/* ---------------- Os números do dia ---------------- */}
        <dl className="border-border mt-5 space-y-2 border-t pt-4 text-sm">
          <Linha
            rotulo={t('tasksTitle')}
            estado={resumo.tarefas}
            valor={
              resumo.tarefas.status === 'pronto' ? (
                <>
                  <span
                    className={cn(
                      resumo.tarefas.dados.totais.vencidas > 0 &&
                        'text-destructive'
                    )}
                  >
                    {t('tasksOverdue', {
                      count: resumo.tarefas.dados.totais.vencidas,
                    })}
                  </span>
                  {' · '}
                  {t('tasksToday', { count: resumo.tarefas.dados.totais.hoje })}
                </>
              ) : null
            }
          />
          {/* ⚠️ As DUAS metades sempre aparecem, cada uma com o seu estado.
              A versão anterior escolhia o bloco que estivesse pronto e
              renderizava só ele: com as suas conversas falhando e a fila
              pronta, a linha mostrava o número da fila como se fosse a
              resposta inteira, sem nada dizendo que faltava metade (Codex,
              PR #202). Aqui, "não carregou" ocupa o lugar da metade que
              faltou — e a falha de uma não apaga o número da outra. */}
          <Linha
            rotulo={t('conversationsTitle')}
            estado={
              resumo.conversas.status === 'falhou' ||
              resumo.fila.status === 'falhou'
                ? FALHOU
                : resumo.conversas.status === 'pronto' &&
                    resumo.fila.status === 'pronto'
                  ? PRONTO
                  : CARREGANDO
            }
            valor={
              resumo.conversas.status === 'carregando' &&
              resumo.fila.status === 'carregando' ? null : (
                <>
                  <Metade estado={resumo.conversas.status}>
                    {resumo.conversas.status === 'pronto' &&
                      t(
                        resumo.conversas.dados.truncadaEsperando
                          ? 'waitingYoursAtLeast'
                          : 'waitingYours',
                        { count: resumo.conversas.dados.esperando.length }
                      )}
                  </Metade>
                  {' · '}
                  <Metade estado={resumo.fila.status}>
                    {resumo.fila.status === 'pronto' &&
                      t(
                        resumo.fila.dados.truncadaNovas
                          ? 'waitingQueueNewAtLeast'
                          : 'waitingQueueNew',
                        { count: resumo.fila.dados.novas.length }
                      )}
                  </Metade>
                </>
              )
            }
          />
        </dl>

        <Button
          variant="outline"
          onClick={abrirMeuDia}
          className="mt-4 w-full justify-center"
        >
          <Sunrise className="size-4" aria-hidden />
          {t('openMyDay')}
        </Button>

        {/* ---------------- Rodapé ---------------- */}
        <div className="border-border mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <button
            type="button"
            onClick={sair}
            disabled={saindo}
            className="text-muted-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline disabled:opacity-50"
          >
            <LogOut className="size-3.5" aria-hidden />
            {t('notYou')} {t('signOut')}
          </button>
          <div className="flex items-center gap-3">
            {!podeContinuar && (
              <span role="status" className="text-muted-foreground text-xs">
                {t('loadingYourDay')}
              </span>
            )}
            <Button
              onClick={onContinuar}
              disabled={!podeContinuar}
              aria-busy={!podeContinuar}
              size="lg"
            >
              {t('continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CARREGANDO = { status: 'carregando' } as const;
const FALHOU = { status: 'falhou' } as const;
const PRONTO = { status: 'pronto' } as const;

/** Uma das duas contas da linha de conversas, com o estado DELA. */
function Metade({
  estado,
  children,
}: {
  estado: 'carregando' | 'falhou' | 'pronto';
  children: React.ReactNode;
}) {
  const t = useTranslations('ResumoDoDia');
  if (estado === 'pronto') return <>{children}</>;
  return (
    <span className={estado === 'falhou' ? 'text-destructive' : undefined}>
      {estado === 'falhou' ? t('failedShort') : t('loadingShort')}
    </span>
  );
}

/**
 * Uma linha do resumo: rótulo à esquerda, número à direita.
 *
 * ⚠️ Enquanto o bloco não responde, a direita é um TRAÇO — nunca um zero.
 * É a mesma regra dos blocos: "0 vencidas" durante a carga liberaria a
 * entrada com uma afirmação que ninguém conferiu.
 */
function Linha({
  rotulo,
  estado,
  valor,
}: {
  rotulo: string;
  estado: { status: 'carregando' | 'falhou' | 'pronto' };
  valor: React.ReactNode;
}) {
  const t = useTranslations('ResumoDoDia');
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-foreground shrink-0 font-medium">{rotulo}</dt>
      <dd
        className={cn(
          'min-w-0 text-right',
          estado.status === 'falhou'
            ? 'text-destructive'
            : 'text-muted-foreground'
        )}
      >
        {valor ??
          (estado.status === 'falhou' ? t('failedShort') : t('loadingShort'))}
      </dd>
    </div>
  );
}
