'use client';

// ============================================================
// Os blocos que só existem na ABA: o que precisa ser corrigido, o dia até
// agora, os negócios no funil e a agenda.
//
// ⚠️ CADA NÚMERO DIZ DE QUEM É (decisão do operador, 12/09): há coisa que é
// da pessoa (suas tarefas, seus negócios) e coisa que é da operação do
// escritório (mensagens enviadas, ganhos, entregas que falharam). Misturar
// as duas sem marca faria o operador ler o trabalho do escritório como
// sendo o dele — e, no bloco de correções, faria o contrário: ele acharia
// que a falha é "dele" e não ia mexer. A marca é a pastilha `De`.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Kanban,
  Send,
  Wrench,
} from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type {
  Agenda as DadosDaAgenda,
  Correcoes,
  Integracoes,
  Negocios as DadosDeNegocios,
  Resultados as DadosDeResultados,
} from '@/hooks/use-area-de-trabalho';
import { nomeDoContato } from '@/lib/contacts/identidade';
import {
  resumirCorrecoes,
  type EstadoDaFonte,
  type EstadoPorFonte,
  type FonteDeCorrecao,
} from '@/lib/meu-dia/correcoes';
import { cn } from '@/lib/utils';

import { Cabecalho, ForaDoPerfil, LinkDoBloco } from './blocos-pessoais';

/** Traduz um `Bloco<T>` numa contagem para a régua das correções. */
function fonteDe<T>(
  bloco: Bloco<T>,
  quantidade: (dados: T) => number
): EstadoDaFonte {
  if (bloco.status === 'carregando') return { status: 'carregando' };
  if (bloco.status === 'falhou') return { status: 'falhou' };
  return {
    status: 'pronto',
    contagem: { quantidade: quantidade(bloco.dados) },
  };
}

export function BlocoDeCorrecoes({
  correcoes,
  integracoes,
  conexoes,
  agendadorParado,
  veAgendadas,
  veConfiguracoes,
}: {
  correcoes: Bloco<Correcoes>;
  integracoes: Bloco<Integracoes>;
  /**
   * ⚠️ Estado, não número: `0` e "não consegui perguntar" são coisas
   * diferentes, e somá-las faz este bloco dizer "tudo em ordem" sobre uma
   * sonda que falhou (Codex, PR #202).
   */
  conexoes: EstadoDaFonte;
  /** `null` enquanto a saúde do agendador não respondeu. */
  agendadorParado: boolean | null;
  veAgendadas: boolean;
  veConfiguracoes: boolean;
}) {
  const t = useTranslations('MeuDia');

  const estados: EstadoPorFonte = {
    agendador:
      agendadorParado === null
        ? { status: 'carregando' }
        : {
            status: 'pronto',
            contagem: { quantidade: agendadorParado ? 1 : 0 },
          },
    conexoes,
    agendadasFalharam: fonteDe(correcoes, (c) => c.agendadasFalharam),
    entregaIncerta: fonteDe(correcoes, (c) => c.entregaIncerta),
    automacoesFalharam: fonteDe(correcoes, (c) => c.automacoesFalharam),
    entradasNaoProcessadas: fonteDe(
      integracoes,
      (i) => i.calendly + i.webhooks
    ),
  };
  const resumo = resumirCorrecoes(estados);

  // Cada achado com o seu texto e para onde se vai consertar. A régua de
  // "tela fora do perfil" é a de sempre: número sem link, com o aviso.
  const DESTINO: Record<FonteDeCorrecao, { href: string; ve: boolean }> = {
    agendador: { href: '/agendadas', ve: veAgendadas },
    conexoes: { href: '/settings?section=channels', ve: veConfiguracoes },
    agendadasFalharam: { href: '/agendadas', ve: veAgendadas },
    entregaIncerta: { href: '/agendadas', ve: veAgendadas },
    automacoesFalharam: { href: '/automations', ve: veConfiguracoes },
    entradasNaoProcessadas: {
      href: '/settings?section=integracoes',
      ve: veConfiguracoes,
    },
  };

  const texto = (fonte: FonteDeCorrecao, count: number): string => {
    // Chaves LITERAIS, uma por fonte: chave montada escapa do portão de i18n
    // do CI (`i18n-chaves-usadas.mjs` conta a dinâmica, não a confere).
    if (fonte === 'agendador') return t('fixSchedulerDown');
    if (fonte === 'conexoes') return t('fixChannelsDown', { count });
    if (fonte === 'agendadasFalharam')
      return t('fixScheduledFailed', { count });
    if (fonte === 'entregaIncerta') return t('fixDeliveryUnsure', { count });
    if (fonte === 'automacoesFalharam')
      return t('fixAutomationsFailed', { count });
    return t('fixIntakeStuck', { count });
  };

  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={
          <Wrench
            className={cn(
              'size-4',
              resumo.situacao === 'temProblema' && 'text-destructive'
            )}
            aria-hidden
          />
        }
        titulo={t('fixTitle')}
        direita={
          <span className="flex items-center gap-2 text-sm">
            {/* ⚠️ O total só aparece quando é CONFIÁVEL: com uma fonte ainda
                em voo ou que falhou, o número seria um parcial com cara de
                fechado — e a lista abaixo já mostra o que se sabe. */}
            {resumo.situacao === 'temProblema' &&
              resumo.conferindo.length === 0 &&
              resumo.naoConferidas.length === 0 && (
                <span className="text-destructive font-medium tabular-nums">
                  {resumo.aoMenos
                    ? t('fixCountAtLeast', { count: resumo.total })
                    : resumo.total}
                </span>
              )}
            <De escopo="escritorio" />
          </span>
        }
      />

      {resumo.situacao === 'conferindo' && (
        <p className="text-muted-foreground mt-2 text-sm">{t('checking')}</p>
      )}

      {resumo.situacao === 'limpo' && (
        <p className="text-foreground mt-2 flex items-center gap-1.5 text-sm">
          <CheckCircle2
            className="size-4 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          {t('fixNone')}
        </p>
      )}

      {/* ⚠️ Zero COM uma consulta que falhou nunca vira "tudo em ordem": este
          bloco existe para avisar que algo quebrou, e um selo verde sobre
          pergunta não respondida é o contrário do que ele serve. */}
      {resumo.situacao === 'incompleto' && (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('fixIncomplete', { count: resumo.naoConferidas.length })}
        </p>
      )}

      {resumo.achados.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {resumo.achados.map((a) => {
            const destino = DESTINO[a.fonte];
            const conteudo = (
              <>
                <AlertTriangle
                  className="text-destructive size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  {texto(a.fonte, a.quantidade)}
                </span>
              </>
            );
            const classes = 'flex items-baseline gap-1.5 text-sm';
            return (
              <li key={a.fonte}>
                {destino.ve ? (
                  <Link
                    href={destino.href}
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
      )}

      {/* A falha parcial é dita SEMPRE, inclusive quando já há achados: o
          que apareceu não prova que o resto foi conferido. */}
      {resumo.achados.length > 0 && resumo.naoConferidas.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {t('fixIncomplete', { count: resumo.naoConferidas.length })}
        </p>
      )}
    </section>
  );
}

export function BlocoDeResultados({
  bloco,
  veTarefas,
  veFunis,
  veContatos,
}: {
  bloco: Bloco<DadosDeResultados>;
  veTarefas: boolean;
  veFunis: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<Send className="size-4" aria-hidden />}
        titulo={t('todayTitle')}
        direita={null}
      />
      {bloco.status !== 'pronto' ? (
        <EstadoDoBlocoDaAba bloco={bloco} />
      ) : (
        <>
          <dl className="mt-2 space-y-2">
            {/* ⚠️ "Da equipe", não "suas": 948 de 956 mensagens da equipe
                saem do celular pareado, sem autor gravado. Creditar à pessoa
                mostraria um dia quase vazio a quem trabalhou o dia inteiro. */}
            <LinhaDeResultado
              rotulo={t('todayMessages')}
              valor={bloco.dados.mensagensDoEscritorio}
              escopo="escritorio"
            />
            <LinhaDeResultado
              rotulo={t('todayTasks')}
              valor={bloco.dados.tarefasConcluidas}
              escopo="seu"
              href={veTarefas ? '/tarefas' : null}
            />
            <LinhaDeResultado
              rotulo={t('todayWon')}
              valor={bloco.dados.ganhos}
              escopo="escritorio"
              href={veFunis ? '/pipelines' : null}
            />
          </dl>
          {bloco.dados.ganhosRecentes.length > 0 && (
            <ul className="border-border mt-3 space-y-1 border-t pt-2">
              {bloco.dados.ganhosRecentes.map((g) => {
                const nome = nomeDoContato(g.contato, t('unknownContact'));
                return (
                  <li
                    key={g.id}
                    className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs"
                  >
                    {veContatos && g.contato ? (
                      <Link
                        href={`/contacts?contact=${encodeURIComponent(g.contato.id)}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        {nome}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{nome}</span>
                    )}
                    <span className="shrink-0">
                      {new Date(g.quando).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function BlocoDeNegocios({
  bloco,
  veFunis,
}: {
  bloco: Bloco<DadosDeNegocios>;
  veFunis: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<Kanban className="size-4" aria-hidden />}
        titulo={t('dealsTitle')}
        direita={
          bloco.status === 'pronto' ? (
            <span className="text-sm">
              {t(bloco.dados.truncada ? 'dealsOpenAtLeast' : 'dealsOpen', {
                count: bloco.dados.meus,
              })}
            </span>
          ) : null
        }
      />
      {bloco.status !== 'pronto' ? (
        <EstadoDoBlocoDaAba bloco={bloco} />
      ) : bloco.dados.meus === 0 && bloco.dados.semResponsavel === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">{t('dealsNone')}</p>
      ) : (
        <div className="mt-2">
          {bloco.dados.valor > 0 && (
            <p className="text-foreground text-sm font-medium">
              {formatarValor(bloco.dados.valor)}
              <span className="text-muted-foreground font-normal">
                {' · '}
                <De escopo="seu" inline />
              </span>
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {bloco.dados.grupos.map((g) => (
              <li
                key={g.chave}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {g.etapaNome ?? t('stageUnknown')}
                  <span className="text-muted-foreground">
                    {' · '}
                    {g.funilNome ?? t('pipelineUnknown')}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t('dealsInStage', { count: g.quantidade })}
                </span>
              </li>
            ))}
          </ul>
          {bloco.dados.semResponsavel > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {t('dealsUnassigned', { count: bloco.dados.semResponsavel })}
              {' · '}
              <De escopo="escritorio" inline />
            </p>
          )}
          {veFunis ? (
            <LinkDoBloco
              href="/pipelines"
              texto={t('openPipelines')}
              onContinuar={NADA}
            />
          ) : (
            <ForaDoPerfil />
          )}
        </div>
      )}
    </section>
  );
}

export function BlocoDaAgenda({
  bloco,
  agoraMs,
  veAgenda,
}: {
  bloco: Bloco<DadosDaAgenda>;
  /** O instante do pedido — o relógio desta tela. */
  agoraMs: number;
  veAgenda: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <section className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<CalendarClock className="size-4" aria-hidden />}
        titulo={t('agendaTitle')}
        direita={<De escopo="seu" />}
      />
      <div className="mt-2 space-y-3">
        {bloco.status !== 'pronto' ? (
          <EstadoDoBlocoDaAba bloco={bloco} />
        ) : bloco.dados.reunioes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('agendaNoneYours')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {bloco.dados.reunioes.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {r.titulo}
                  {r.contato_nome && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {r.contato_nome}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {quandoCurto(r.starts_at, agoraMs)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ⚠️ Os agendamentos do Calendly NÃO aparecem aqui, e não é
            esquecimento: a integração grava só `invitee.created` — o
            cancelamento é ignorado e o reagendamento insere uma linha nova
            sem invalidar a antiga. Listá-los afirmaria reunião que não vai
            acontecer, e o que está fora do lugar não se conserta por uma
            tela de resumo. As entradas do Calendly que precisam de gente
            continuam no bloco "o que precisa ser corrigido". */}
        <p className="text-muted-foreground text-xs">{t('agendaOnlyCrm')}</p>

        {veAgenda && (
          <LinkDoBloco
            href="/agenda"
            texto={t('openAgenda')}
            onContinuar={NADA}
          />
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Peças
// ------------------------------------------------------------

/** A aba não tem porta acima dela: navegar aqui não precisa confirmar nada. */
const NADA = () => {};

/**
 * De quem é este número.
 *
 * Pastilha discreta, não um parágrafo: ela aparece em quase toda linha, e
 * uma frase repetida seis vezes na tela vira ruído que o olho aprende a
 * pular — que é como o número perde a marca de novo.
 */
function De({
  escopo,
  inline = false,
}: {
  escopo: 'seu' | 'escritorio';
  inline?: boolean;
}) {
  const t = useTranslations('MeuDia');
  const texto = escopo === 'seu' ? t('scopeYours') : t('scopeOffice');
  if (inline) return <span className="text-xs">{texto}</span>;
  return (
    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
      {texto}
    </span>
  );
}

function LinhaDeResultado({
  rotulo,
  valor,
  escopo,
  href,
}: {
  rotulo: string;
  valor: number;
  escopo: 'seu' | 'escritorio';
  href?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-muted-foreground min-w-0 text-sm">
        {href ? (
          <Link href={href} className="hover:underline">
            {rotulo}
          </Link>
        ) : (
          rotulo
        )}{' '}
        <De escopo={escopo} inline />
      </dt>
      <dd className="text-foreground shrink-0 text-sm font-medium tabular-nums">
        {valor}
      </dd>
    </div>
  );
}

/** O mesmo `EstadoDoBloco` dos blocos pessoais, com as chaves desta aba. */
function EstadoDoBlocoDaAba({ bloco }: { bloco: Bloco<unknown> }) {
  const t = useTranslations('MeuDia');
  if (bloco.status === 'carregando') {
    return <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>;
  }
  if (bloco.status === 'falhou') {
    return <p className="text-destructive mt-2 text-sm">{t('failed')}</p>;
  }
  return null;
}

/**
 * ⚠️ Em pt-BR fixo, como `currency.ts` e a apresentação do funil: o locale
 * do app é global e o número do escritório não muda de forma conforme o
 * navegador de quem lê.
 */
function formatarValor(v: number): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

/**
 * "14:30" hoje, "qui. 09:00" nos outros dias — a reunião de amanhã precisa
 * dizer que é amanhã.
 *
 * ⚠️ O relógio entra por PARÂMETRO, nunca de um `new Date()` aqui dentro:
 * a função é chamada no render, e ler o relógio ali é a mesma impureza que
 * o React Compiler recusa em `Date.now()`. O instante é o do pedido, o
 * mesmo que data a saudação e as consultas.
 */
function quandoCurto(iso: string | null, agoraMs: number): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hoje = new Date(agoraMs);
  const mesmoDia =
    d.getFullYear() === hoje.getFullYear() &&
    d.getMonth() === hoje.getMonth() &&
    d.getDate() === hoje.getDate();
  const hora = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (mesmoDia) return hora;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hora}`;
}
