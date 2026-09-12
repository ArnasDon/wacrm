'use client';

// ============================================================
// A tela do Meu dia: o que está com a pessoa hoje, antes de o app abrir.
//
// Só APRESENTA. Os números vêm de `useResumoDoDia`, a regra de "aparece ou
// não" mora na porta (`porta-de-entrada.tsx`) e as contagens em
// `src/lib/resumo-do-dia/contagens.ts`. Cada bloco tem estado próprio:
// carregando (traço), falhou (aviso) ou pronto — nunca "0" sem resposta, e a
// falha de um bloco NÃO apaga o que o vizinho já carregou.
//
// ⚠️ Todo link CONFIRMA antes de navegar (`onContinuar` no clique): a porta
// fica acima da página roteada, então navegar sem confirmar trocaria a URL e
// deixaria a tela do resumo na frente da conversa que a pessoa pediu.
//
// ⚠️ Tela fora do perfil (D8 do plano): o número aparece SEM link, com o
// aviso. Esconder o bloco calaria uma obrigação atribuída à pessoa. O item
// é gateado pela tela para onde ELE leva (a ficha do cliente), não pela tela
// do bloco — um perfil com Tarefas e sem Contatos cairia na TelaBloqueada.
//
// ⚠️ O relógio da tela (saudação, data, "venceu há N dias") é o instante da
// DECISÃO da porta, passado por prop — não o das consultas, que só existe
// depois de a primeira responder (a saudação diria "boa tarde" às 8h com a
// rede lenta).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AtSign,
  ListTodo,
  LogOut,
  MessageCircle,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  useResumoDoDia,
  type Bloco,
  type Conversas as DadosDeConversas,
  type Fila,
  type Novidades as DadosDeNovidades,
  type TarefaDoResumo,
  type Tarefas as DadosDeTarefas,
} from '@/hooks/use-resumo-do-dia';
import { nomeDoContato } from '@/lib/contacts/identidade';
import type { Atraso } from '@/lib/inbox/atraso';
import { urlDoInbox } from '@/lib/inbox/url';
import { podeVerTela } from '@/lib/perfis/visibilidade';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { limitar, type ConversaEsperando } from '@/lib/resumo-do-dia/contagens';
import { dataParaExibir, diaLocal, horaParaExibir } from '@/lib/tasks/prazo';
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
      toast.error(t('signOutError', { message: erro }));
    }
  };

  const veTarefas = podeVerTela(ctx, 'tarefas');
  const veContatos = podeVerTela(ctx, 'contacts');
  const veInbox = podeVerTela(ctx, 'inbox');
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

  return (
    <div className="bg-background min-h-screen overflow-y-auto p-4 sm:p-8">
      <div
        ref={cartaoRef}
        tabIndex={-1}
        className="border-border bg-card mx-auto w-full max-w-lg rounded-xl border p-5 shadow-sm outline-none sm:p-6"
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
          />
        </section>

        {/* ---------------- Tarefas ---------------- */}
        <section className="border-border mt-5 border-t pt-4">
          <Cabecalho
            icone={<ListTodo className="size-4" aria-hidden />}
            titulo={t('tasksTitle')}
            direita={
              resumo.tarefas.status === 'pronto' ? (
                <span className="text-sm">
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
                </span>
              ) : null
            }
          />
          <Tarefas
            bloco={resumo.tarefas}
            hoje={diaLocal(agora)}
            veTarefas={veTarefas}
            veContatos={veContatos}
            onContinuar={onContinuar}
          />
        </section>

        {/* ---------------- Conversas ---------------- */}
        <section className="border-border mt-5 border-t pt-4">
          <Cabecalho
            icone={<MessageCircle className="size-4" aria-hidden />}
            titulo={t('conversationsTitle')}
            direita={
              // Cada metade com o PRÓPRIO estado: a fila falhando não apaga
              // o "3 seus" que já carregou.
              resumo.conversas.status === 'pronto' ||
              resumo.fila.status === 'pronto' ? (
                <span className="text-sm">
                  {resumo.conversas.status === 'pronto' &&
                    t(
                      resumo.conversas.dados.truncadaEsperando
                        ? 'waitingYoursAtLeast'
                        : 'waitingYours',
                      {
                        count: resumo.conversas.dados.esperando.length,
                      }
                    )}
                  {resumo.conversas.status === 'pronto' &&
                    resumo.fila.status === 'pronto' &&
                    ' · '}
                  {resumo.fila.status === 'pronto' &&
                    t(
                      resumo.fila.dados.truncadaNovas
                        ? 'waitingQueueNewAtLeast'
                        : 'waitingQueueNew',
                      {
                        count: resumo.fila.dados.novas.length,
                      }
                    )}
                </span>
              ) : null
            }
          />
          <Conversas
            conversas={resumo.conversas}
            fila={resumo.fila}
            temConfirmacaoAnterior={temConfirmacaoAnterior}
            veInbox={veInbox}
            onContinuar={onContinuar}
          />
        </section>

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

// ------------------------------------------------------------
// Peças
// ------------------------------------------------------------

// `flex-wrap` + título `shrink-0`: no celular o resumo à direita desce para
// a linha de baixo em vez de espremer o título em três linhas (medido a
// 375px, "Clientes esperando resposta" quebrava em três).
function Cabecalho({
  icone,
  titulo,
  direita,
}: {
  icone: React.ReactNode;
  titulo: string;
  direita: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-foreground flex shrink-0 items-center gap-1.5 text-sm font-semibold">
        {icone}
        {titulo}
      </h2>
      <div className="text-muted-foreground min-w-0 text-right">{direita}</div>
    </div>
  );
}

function EstadoDoBloco({ bloco }: { bloco: Bloco<unknown> }) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status === 'carregando') {
    return <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>;
  }
  if (bloco.status === 'falhou') {
    return <p className="text-destructive mt-2 text-sm">{t('failed')}</p>;
  }
  return null;
}

function ForaDoPerfil() {
  const t = useTranslations('ResumoDoDia');
  return (
    <p className="text-muted-foreground mt-2 text-xs">
      {t('outOfYourProfile')}
    </p>
  );
}

function LinkDoBloco({
  href,
  texto,
  onContinuar,
}: {
  href: string;
  texto: string;
  onContinuar: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onContinuar}
      className="text-primary mt-2 inline-block text-sm hover:underline"
    >
      {texto}
    </Link>
  );
}

function Novidades({
  bloco,
  veNotificacoes,
  onContinuar,
}: {
  bloco: Bloco<DadosDeNovidades>;
  veNotificacoes: boolean;
  onContinuar: () => void;
}) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status !== 'pronto') return <EstadoDoBloco bloco={bloco} />;
  const { mencoes, tarefas, conversas, total } = bloco.dados;
  if (total === 0) {
    return (
      <p className="text-muted-foreground mt-2 text-sm">{t('newsNone')}</p>
    );
  }
  const chip = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs';
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {mencoes > 0 && (
          <span className={cn(chip, 'bg-primary/10 text-primary')}>
            <AtSign className="size-3.5" aria-hidden />
            {t('newsMentions', { count: mencoes })}
          </span>
        )}
        {tarefas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <ListTodo className="size-3.5" aria-hidden />
            {t('newsTasks', { count: tarefas })}
          </span>
        )}
        {conversas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <UserPlus className="size-3.5" aria-hidden />
            {t('newsConversations', { count: conversas })}
          </span>
        )}
      </div>
      {veNotificacoes ? (
        <LinkDoBloco
          href="/notifications"
          texto={t('openNotifications')}
          onContinuar={onContinuar}
        />
      ) : (
        <ForaDoPerfil />
      )}
    </div>
  );
}

function Tarefas({
  bloco,
  hoje,
  veTarefas,
  veContatos,
  onContinuar,
}: {
  bloco: Bloco<DadosDeTarefas>;
  /** `YYYY-MM-DD` de hoje no fuso de quem lê. */
  hoje: string;
  veTarefas: boolean;
  veContatos: boolean;
  onContinuar: () => void;
}) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status !== 'pronto') return <EstadoDoBloco bloco={bloco} />;
  const { vencidas, hoje: deHoje, totais } = bloco.dados;
  if (totais.vencidas + totais.hoje === 0) {
    return (
      <p className="text-muted-foreground mt-2 text-sm">{t('tasksNone')}</p>
    );
  }
  // Vencidas primeiro (o grupo que grita), depois as de hoje, no teto de 5.
  // O "e mais N" sai dos TOTAIS do banco, não do que a lista carregou.
  const { itens } = limitar([...vencidas, ...deHoje]);
  const restantes = Math.max(0, totais.vencidas + totais.hoje - itens.length);

  const prazo = (
    tarefa: TarefaDoResumo
  ): { texto: string; vencida: boolean } => {
    if (tarefa.vence_em < hoje) {
      const dias = Math.round(
        (dataParaExibir(hoje).getTime() -
          dataParaExibir(tarefa.vence_em).getTime()) /
          86_400_000
      );
      return { texto: t('overdueDays', { days: dias }), vencida: true };
    }
    const hora = horaParaExibir(tarefa.vence_as);
    return {
      texto: hora ? t('dueTodayAt', { hora }) : t('dueToday'),
      vencida: false,
    };
  };

  return (
    <div className="mt-2">
      <ul className="space-y-1.5">
        {itens.map((tarefa) => {
          const p = prazo(tarefa);
          const nome = nomeDoContato(tarefa.contact, t('unknownContact'));
          const conteudo = (
            <>
              <span className="min-w-0 flex-1 truncate">
                {tarefa.titulo}
                <span className="text-muted-foreground"> · {nome}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs',
                  p.vencida ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {p.texto}
              </span>
            </>
          );
          const classes = 'flex items-baseline justify-between gap-3 text-sm';
          return (
            <li key={tarefa.id}>
              {veContatos ? (
                <Link
                  href={`/contacts?contact=${encodeURIComponent(tarefa.contact_id)}`}
                  onClick={onContinuar}
                  className={cn(classes, 'hover:bg-muted/60 rounded-md')}
                >
                  {conteudo}
                </Link>
              ) : (
                <div className={classes}>{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
      {veTarefas ? (
        <LinkDoBloco
          href="/tarefas"
          texto={
            restantes > 0
              ? `${t('andMore', { count: restantes })} · ${t('openTasks')}`
              : t('openTasks')
          }
          onContinuar={onContinuar}
        />
      ) : (
        <ForaDoPerfil />
      )}
    </div>
  );
}

/** "há 42 min" / "há 3 h" / "há 2 dias" — três chamadas literais, porque o portão de i18n só enxerga chave literal. */
function textoDaEspera(
  t: ReturnType<typeof useTranslations<'ResumoDoDia'>>,
  atraso: Atraso
): string {
  if (atraso.unidade === 'min') return t('waitMin', { n: atraso.n });
  if (atraso.unidade === 'h') return t('waitHours', { n: atraso.n });
  return t('waitDays', { n: atraso.n });
}

function ItemDeConversa({
  item,
  veInbox,
  onContinuar,
}: {
  item: ConversaEsperando;
  veInbox: boolean;
  onContinuar: () => void;
}) {
  const t = useTranslations('ResumoDoDia');
  const nome = nomeDoContato(item.conversa.contact, t('unknownContact'));
  const classes = 'flex items-baseline justify-between gap-3 text-sm';
  const conteudo = (
    <>
      <span className="min-w-0 flex-1 truncate">{nome}</span>
      <span
        className={cn(
          'shrink-0 text-xs',
          item.atraso.critico
            ? 'text-destructive'
            : 'text-amber-700 dark:text-amber-300'
        )}
      >
        {textoDaEspera(t, item.atraso)}
      </span>
    </>
  );
  return (
    <li>
      {veInbox ? (
        <Link
          href={urlDoInbox({ c: item.conversa.id })}
          onClick={onContinuar}
          className={cn(classes, 'hover:bg-muted/60 rounded-md')}
        >
          {conteudo}
        </Link>
      ) : (
        <div className={classes}>{conteudo}</div>
      )}
    </li>
  );
}

function Conversas({
  conversas,
  fila,
  temConfirmacaoAnterior,
  veInbox,
  onContinuar,
}: {
  conversas: Bloco<DadosDeConversas>;
  fila: Bloco<Fila>;
  temConfirmacaoAnterior: boolean;
  veInbox: boolean;
  onContinuar: () => void;
}) {
  const t = useTranslations('ResumoDoDia');
  const algumPronto = conversas.status === 'pronto' || fila.status === 'pronto';
  return (
    <div className="mt-2 space-y-3">
      {/* As suas */}
      {conversas.status !== 'pronto' ? (
        <EstadoDoBloco bloco={conversas} />
      ) : (
        <div>
          {conversas.dados.esperando.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('waitingNoneYours')}
            </p>
          ) : (
            (() => {
              const { itens, restantes } = limitar(conversas.dados.esperando);
              return (
                <>
                  <ul className="space-y-1.5">
                    {itens.map((item) => (
                      <ItemDeConversa
                        key={item.conversa.id}
                        item={item}
                        veInbox={veInbox}
                        onContinuar={onContinuar}
                      />
                    ))}
                  </ul>
                  {restantes > 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t('yoursAndMore', { count: restantes })}
                    </p>
                  )}
                </>
              );
            })()
          )}
          <p className="text-muted-foreground mt-1.5 text-xs">
            {t(
              conversas.dados.truncada
                ? 'assignedToYouAtLeast'
                : 'assignedToYou',
              {
                count: conversas.dados.atribuidas,
              }
            )}
            {conversas.dados.foraDoPerfil > 0 &&
              ` · ${t('outOfProfile', { count: conversas.dados.foraDoPerfil })}`}
          </p>
        </div>
      )}

      {/* A fila sem responsável */}
      {fila.status !== 'pronto' ? (
        <EstadoDoBloco bloco={fila} />
      ) : (
        <div>
          <p className="text-muted-foreground text-xs font-medium">
            {t('queueTitle')}
          </p>
          {fila.dados.novas.length > 0 && (
            <ul className="mt-1 space-y-1.5">
              {limitar(fila.dados.novas).itens.map((item) => (
                <ItemDeConversa
                  key={item.conversa.id}
                  item={item}
                  veInbox={veInbox}
                  onContinuar={onContinuar}
                />
              ))}
            </ul>
          )}
          <p className="text-muted-foreground mt-1.5 text-xs">
            {temConfirmacaoAnterior
              ? t(fila.dados.truncadaNovas ? 'queueNewAtLeast' : 'queueNew', {
                  count: fila.dados.novas.length,
                })
              : t(
                  fila.dados.truncadaNovas
                    ? 'queueNew24hAtLeast'
                    : 'queueNew24h',
                  {
                    count: fila.dados.novas.length,
                  }
                )}
            {fila.dados.antigas > 0 && fila.dados.maisAntiga && (
              <>
                {' · '}
                {fila.dados.truncadaAntigas
                  ? t('queueOlderAtLeast', { count: fila.dados.antigas })
                  : t('queueOlder', { count: fila.dados.antigas })}{' '}
                {t('oldestWait', {
                  espera: textoDaEspera(t, fila.dados.maisAntiga),
                })}
              </>
            )}
          </p>
        </div>
      )}

      {algumPronto &&
        (veInbox ? (
          <LinkDoBloco
            href="/inbox"
            texto={t('openInbox')}
            onContinuar={onContinuar}
          />
        ) : (
          <ForaDoPerfil />
        ))}
    </div>
  );
}
