'use client';

// ============================================================
// Os blocos PESSOAIS — novidades, tarefas e clientes esperando.
//
// Vieram inteiros de `resumo-do-dia.tsx` quando a aba /meu-dia virou área de
// trabalho (F5): o cartão da ENTRADA ficou com os números e um botão, e as
// LISTAS — que são onde se trabalha — passaram a viver aqui, montadas pela
// aba. Os dois ainda leem o mesmo `useResumoDoDia`.
//
// ⚠️ `onContinuar` continua existindo e não é resíduo: na aba ele é vazio,
// mas a porta de entrada ainda pode montar estes blocos um dia, e o
// contrato "todo link confirma antes de navegar" é o que impede a URL de
// trocar com a tela da porta na frente.
//
// ⚠️ Tela fora do perfil (D8): o número aparece SEM link, com o aviso.
// Esconder calaria uma obrigação atribuída à pessoa. O item é gateado pela
// tela para onde ELE leva (a ficha do cliente), não pela tela do bloco.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AtSign, ListTodo, UserPlus } from 'lucide-react';

import type {
  Bloco,
  Conversas as DadosDeConversas,
  Fila,
  Novidades as DadosDeNovidades,
  TarefaDoResumo,
  Tarefas as DadosDeTarefas,
} from '@/hooks/use-resumo-do-dia';
import { nomeDoContato } from '@/lib/contacts/identidade';
import type { Atraso } from '@/lib/inbox/atraso';
import { urlDoInbox } from '@/lib/inbox/url';
import { limitar, type ConversaEsperando } from '@/lib/resumo-do-dia/contagens';
import { dataParaExibir, horaParaExibir } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';

// `flex-wrap` + título `shrink-0`: no celular o resumo à direita desce para
// a linha de baixo em vez de espremer o título em três linhas (medido a
// 375px, "Clientes esperando resposta" quebrava em três).
export function Cabecalho({
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

export function EstadoDoBloco({ bloco }: { bloco: Bloco<unknown> }) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status === 'carregando') {
    return <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>;
  }
  if (bloco.status === 'falhou') {
    return <p className="text-destructive mt-2 text-sm">{t('failed')}</p>;
  }
  return null;
}

export function ForaDoPerfil() {
  const t = useTranslations('ResumoDoDia');
  return (
    <p className="text-muted-foreground mt-2 text-xs">
      {t('outOfYourProfile')}
    </p>
  );
}

export function LinkDoBloco({
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

export function Novidades({
  bloco,
  veNotificacoes,
  onContinuar,
  comLink = true,
}: {
  bloco: Bloco<DadosDeNovidades>;
  veNotificacoes: boolean;
  onContinuar: () => void;
  /**
   * O cartão da ENTRADA passa `false`: ali o único caminho para a frente é
   * o botão que leva à aba, e um segundo link desfaria o enxugamento que o
   * operador pediu. Sem link é diferente de FORA DO PERFIL — por isso a
   * prop, e não `veNotificacoes={false}`, que escreveria na tela um aviso
   * de restrição que não existe.
   */
  comLink?: boolean;
}) {
  const t = useTranslations('ResumoDoDia');
  if (bloco.status !== 'pronto') return <EstadoDoBloco bloco={bloco} />;
  const { mencoes, tarefas, conversas, total, foraDoPerfil, truncada } =
    bloco.dados;
  // A régua da D8 também aqui: o número aparece, o conteúdo não.
  const fora =
    foraDoPerfil > 0 ? (
      <p className="text-muted-foreground mt-2 text-xs">
        {t(truncada ? 'outOfProfileAtLeast' : 'outOfProfile', {
          count: foraDoPerfil,
        })}
      </p>
    ) : null;
  // ⚠️ Consulta TRUNCADA não afirma número nem ausência (Codex, PR #199).
  // Passando do teto, o hook devolve só os avisos mais NOVOS — e se todos
  // eles estiverem fora do perfil, "Nada de novo" seria dito sobre uma
  // menção mais antiga que ficou de fora. É a armadilha "lista vazia
  // virando afirmação", aqui com a lista cheia e o recorte esvaziando-a.
  //
  // ⚠️ E o truncado diz "PELO MENOS N" (≥), nunca "mais de N" (>): o
  // `truncada` prova que ALGUM aviso ficou de fora, não que ficou de fora
  // um aviso DESTE tipo. Com 3 menções na janela e só tarefas no que foi
  // cortado, "mais de 3 menções" seria falso — são exatamente 3 (Codex,
  // PR #200). As chaves da fila e das conversas dizem "mais de" porque lá
  // o número exibido É o teto, e aí a desigualdade estrita é verdadeira.
  if (total === 0) {
    return (
      <>
        <p className="text-muted-foreground mt-2 text-sm">
          {t(truncada ? 'newsTooMany' : 'newsNone')}
        </p>
        {fora}
      </>
    );
  }
  const chip = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs';
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {mencoes > 0 && (
          <span className={cn(chip, 'bg-primary/10 text-primary')}>
            <AtSign className="size-3.5" aria-hidden />
            {t(truncada ? 'newsMentionsAtLeast' : 'newsMentions', {
              count: mencoes,
            })}
          </span>
        )}
        {tarefas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <ListTodo className="size-3.5" aria-hidden />
            {t(truncada ? 'newsTasksAtLeast' : 'newsTasks', {
              count: tarefas,
            })}
          </span>
        )}
        {conversas > 0 && (
          <span className={cn(chip, 'bg-muted text-foreground')}>
            <UserPlus className="size-3.5" aria-hidden />
            {t(truncada ? 'newsConversationsAtLeast' : 'newsConversations', {
              count: conversas,
            })}
          </span>
        )}
      </div>
      {fora}
      {!comLink ? null : veNotificacoes ? (
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

export function Tarefas({
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
export function textoDaEspera(
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

export function Conversas({
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
