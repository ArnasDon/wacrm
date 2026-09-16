'use client';

// ============================================================
// /meu-dia — a ÁREA DE TRABALHO (F5).
//
// Até 12/09 esta rota era o mesmo cartão da entrada, em modo página — e o
// operador devolveu: "parece só uma miniatura idêntica da que aparece no
// modal; o ideal é uma área mais estruturada, para o operador efetivamente
// trabalhar, visualizar os resultados, as falhas e ter a visão sobre o que
// precisa ser corrigido". Hoje são sete blocos num grid: os três pessoais
// (que continuam vindo de `useResumoDoDia`, o mesmo do cartão) e os quatro
// de operação (`useAreaDeTrabalho`).
//
// ⚠️ Usa a LENTE do "Ver como" (`acesso`), e não o contexto real: esta tela
// vive DENTRO do app, onde o shell bloqueia telas pela lente — com o ctx
// real, o admin simulando um Observador veria links para telas que a
// `TelaBloqueada` recusaria. O ctx real fica só na porta de entrada.
//
// ⚠️ Fica FORA do catálogo de perfis de propósito (`telaDoCaminho` devolve
// null e a guarda deixa passar): uma tela nova no catálogo nasceria
// invisível para todo perfil já gravado.
//
// As novidades e a fila "nova" contam a partir da última confirmação da
// entrada, lida do navegador — a mesma âncora da porta.
// ============================================================

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ListTodo, MessageCircle } from 'lucide-react';

import {
  BlocoDaAgenda,
  BlocoDeCorrecoes,
  BlocoDeNegocios,
  BlocoDeResultados,
} from '@/components/meu-dia/blocos-de-operacao';
import {
  Cabecalho,
  Conversas,
  Novidades,
  Tarefas,
} from '@/components/meu-dia/blocos-pessoais';
import { Button } from '@/components/ui/button';
import { useAgendadorSaude } from '@/hooks/use-agendador-saude';
import { useAreaDeTrabalho } from '@/hooks/use-area-de-trabalho';
import { useAoVoltarParaOApp } from '@/hooks/use-ao-voltar-para-o-app';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useChannelHealth } from '@/hooks/use-channel-health';
import { useResumoDoDia } from '@/hooks/use-resumo-do-dia';
import type { EstadoDaFonte } from '@/lib/meu-dia/correcoes';
import { canaisVisiveis } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { podeVerSecao, podeVerTela } from '@/lib/perfis/visibilidade';
import { lerRegistroDoNavegador } from '@/lib/resumo-do-dia/navegador';
import { inicioDasNovidades } from '@/lib/resumo-do-dia/pendencia';
import type { SaudeDoAgendador } from '@/lib/scheduled/saude';
import { diaLocal } from '@/lib/tasks/prazo';

interface Pedido {
  agoraMs: number;
  desdeMs: number;
  daConfirmacao: boolean;
}

/**
 * A janela herdada do cartão da entrada (`?desde=`), quando houver.
 *
 * ⚠️ É PARSE, nunca `Number(x)` cru: o parâmetro vem da URL, que qualquer um
 * edita. Recusa o que não é inteiro positivo, o que está no FUTURO (janela
 * que ainda não começou não mostraria nada) e o que é velho demais — o teto
 * é o mesmo da janela padrão de quem nunca confirmou, e sem ele um `desde=0`
 * mandaria a consulta varrer a conta inteira.
 */
interface JanelaHerdada {
  desdeMs: number;
  /** A janela do cartão era a confirmação anterior, ou o recuo de 24 h? */
  daConfirmacao: boolean;
}

function janelaHerdada(
  bruto: string | null,
  conf: string | null,
  agoraMs: number
): JanelaHerdada | null {
  if (!bruto) return null;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (n > agoraMs) return null;
  if (agoraMs - n > TETO_DA_JANELA_MS) return null;
  // Só o literal '1' confirma. Parâmetro ausente (link antigo, ou colado à
  // mão) é tratado como as "últimas 24 h": afirmar uma entrada anterior que
  // não houve é a mentira que este campo existe para evitar.
  return { desdeMs: n, daConfirmacao: conf === '1' };
}

/** Trinta dias — o mesmo teto que `inicioDasNovidades` usa para não varrer a conta. */
const TETO_DA_JANELA_MS = 30 * 24 * 60 * 60_000;

function montarPedido(
  userId: string | null,
  herdada: JanelaHerdada | null
): Pedido {
  const agoraMs = Date.now();
  const inicio = inicioDasNovidades(
    userId ? lerRegistroDoNavegador(userId) : null,
    agoraMs
  );
  // A janela do cartão vence a do registro: ela é a que a pessoa viu, e o
  // registro já foi reescrito pelo "Continuar" que o botão disparou.
  if (herdada !== null) {
    return {
      agoraMs,
      desdeMs: herdada.desdeMs,
      daConfirmacao: herdada.daConfirmacao,
    };
  }
  return {
    agoraMs,
    desdeMs: inicio.desdeMs,
    daConfirmacao: inicio.daConfirmacao,
  };
}

/** A aba não tem porta acima dela: navegar daqui não precisa confirmar nada. */
const NADA = () => {};

/**
 * ⚠️ `deveAparecer` NÃO serve aqui: ele é true também para
 * `recado === 'falhas'`, que quer dizer "há agendadas falhadas" — e essa é
 * outra fonte deste mesmo bloco. Usá-lo faria a tela escrever "o agendador
 * está parado" sobre um agendador que está rodando, ao lado da linha que
 * conta as falhas de verdade. Só os recados de PARADA contam aqui.
 */
function agendadorEstaParado(s: SaudeDoAgendador): boolean {
  return (
    s.recado === 'nuncaRodou' ||
    s.recado === 'paradoComFila' ||
    s.recado === 'paradoSemFila' ||
    s.recado === 'automacoesParadas'
  );
}

// ⚠️ `useSearchParams` (o `?desde=` herdado do cartão) exige um limite de
// Suspense — é o mesmo invólucro fino de `inbox` e `contacts`. Sem ele a
// página prerenderizada resolve a query string no build, e o parâmetro que
// o botão da entrada manda seria ignorado na hidratação.
export default function MeuDiaPage() {
  return (
    <Suspense fallback={null}>
      <MeuDiaPageInner />
    </Suspense>
  );
}

function MeuDiaPageInner() {
  const { user, accountId, accountStatus, profile, acesso } = useAuth();
  const userId = user?.id ?? null;
  const params = useSearchParams();
  const router = useRouter();

  // O pedido nasce no inicializador e só muda no clique em "Atualizar" — o
  // relógio novo (`agoraMs`) é a chave que faz os hooks consultarem de novo.
  // ⚠️ A janela herdada entra SÓ na primeira montagem: o "Atualizar" tem de
  // partir do registro de verdade, senão a aba ficaria presa para sempre na
  // janela de uma entrada que já foi confirmada.
  const [pedido, setPedido] = useState<Pedido>(() =>
    montarPedido(
      userId,
      janelaHerdada(params.get('desde'), params.get('conf'), Date.now())
    )
  );

  // ⚠️ O carimbo é consumido UMA vez: ele fica na barra de endereço, e um
  // recarregamento duro — ou a volta pelo histórico — remontaria a página
  // consumindo o MESMO carimbo velho, reclassificando como novo o que a
  // pessoa já tratou, por até trinta dias (Codex, PR #202). Trocar só a
  // query não remonta a rota (é o que o inbox faz com `?c=`), então o
  // pedido já montado fica de pé.
  useEffect(() => {
    if (!params.has('desde') && !params.has('conf')) return;
    router.replace('/meu-dia', { scroll: false });
  }, [params, router]);

  // O shell já segura sessão e perfil; conta quebrada é narrada pelo
  // `AccountAccessAlert` acima desta página.
  if (!userId || !accountId || accountStatus !== 'ready') return null;

  return (
    <AreaDeTrabalho
      userId={userId}
      accountId={accountId}
      profileId={profile?.id ?? null}
      primeiroNome={profile?.full_name?.trim().split(/\s+/)[0] || null}
      acesso={acesso}
      pedido={pedido}
      onAtualizar={() => setPedido(montarPedido(userId, null))}
    />
  );
}

/**
 * ⚠️ Componente SEPARADO da página, e não o corpo dela: os hooks abaixo
 * exigem `userId`/`accountId` resolvidos, e a página tem uma saída
 * antecipada (`return null`) enquanto a sessão carrega. Chamar hook depois
 * de um `return` condicional quebra a regra dos hooks.
 */
function AreaDeTrabalho({
  userId,
  accountId,
  profileId,
  primeiroNome,
  acesso,
  pedido,
  onAtualizar,
}: {
  userId: string;
  accountId: string;
  profileId: string | null;
  primeiroNome: string | null;
  acesso: ContextoDeAcesso;
  pedido: Pedido;
  onAtualizar: () => void;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');

  const resumo = useResumoDoDia({
    userId,
    accountId,
    ctx: acesso,
    desdeMs: pedido.desdeMs,
    versao: pedido.agoraMs,
  });
  const area = useAreaDeTrabalho({
    userId,
    profileId,
    accountId,
    ctx: acesso,
    versao: pedido.agoraMs,
  });
  const {
    channels,
    loading: conexoesCarregando,
    falhou: conexoesFalharam,
    recarregar: recarregarConexoes,
  } = useChannelHealth();
  const { saude, recarregar: recarregarAgendador } = useAgendadorSaude();

  // ⚠️ Só as conexões que o perfil enxerga: um perfil restrito ao
  // trabalhista não tem o que fazer com a conexão do bancário caída — e o
  // aviso que não é seu é o que ensina a ignorar o bloco.
  //
  // ⚠️ A sonda que FALHOU vira `falhou`, nunca zero: a lista vazia dela tem
  // dois significados, e só um deles autoriza dizer "nada a corrigir".
  const conexoes: EstadoDaFonte = conexoesCarregando
    ? { status: 'carregando' }
    : conexoesFalharam
      ? { status: 'falhou' }
      : {
          status: 'pronto',
          contagem: {
            quantidade: canaisVisiveis(acesso, channels).filter(
              (c) => c.tone === 'down'
            ).length,
          },
        };

  // Conexão de pé, ouvindo, sem erro — e entregando tarde (1002). Fonte
  // SEPARADA da de cima: o conserto é outro, e somá-las faria a frase
  // "fora do ar" mentir sobre uma conexão que está entregando.
  //
  // ⚠️ O teste é `detail === 'lagging'`, não `tone === 'warn'`: `warn`
  // também cobre `stale`, `pairing` e `lastError`, que são transitórios e
  // encheriam o bloco de alarme que se resolve sozinho — e um bloco que
  // acende à toa é um bloco que se aprende a ignorar.
  const conexoesAtrasadas: EstadoDaFonte = conexoesCarregando
    ? { status: 'carregando' }
    : conexoesFalharam
      ? { status: 'falhou' }
      : {
          status: 'pronto',
          contagem: {
            quantidade: canaisVisiveis(acesso, channels).filter(
              (c) => c.detail === 'lagging'
            ).length,
          },
        };

  const veTarefas = podeVerTela(acesso, 'tarefas');
  const veContatos = podeVerTela(acesso, 'contacts');
  const veInbox = podeVerTela(acesso, 'inbox');
  const veNotificacoes = podeVerTela(acesso, 'notifications');
  const veAgendadas = podeVerTela(acesso, 'agendadas');
  const veAgenda = podeVerTela(acesso, 'agenda');
  const veFunis = podeVerTela(acesso, 'pipelines');
  const veAutomacoes = podeVerTela(acesso, 'automations');
  const veCorrecoes = useCan('view-reports');
  // Por SEÇÃO: a tela de Configurações não é recortável, mas as seções são.
  const veConexoes = podeVerSecao(acesso, 'channels');
  const veIntegracoes = podeVerSecao(acesso, 'integracoes');

  const agora = new Date(pedido.agoraMs);
  const hora = agora.getHours();
  const saudacao = primeiroNome
    ? hora < 12
      ? tResumo('greetingMorning', { nome: primeiroNome })
      : hora < 18
        ? tResumo('greetingAfternoon', { nome: primeiroNome })
        : tResumo('greetingEvening', { nome: primeiroNome })
    : hora < 12
      ? tResumo('greetingMorningPlain')
      : hora < 18
        ? tResumo('greetingAfternoonPlain')
        : tResumo('greetingEveningPlain');

  /**
   * ⚠️ O "Atualizar" precisa alcançar as DUAS sondas de saúde, que têm laço
   * próprio e não enxergam o `pedido`: sem isso, o operador conserta a
   * conexão, clica em Atualizar e o bloco continua vermelho até o próximo
   * tique — até cinco minutos no agendador (Codex, PR #202).
   */
  const atualizarTudo = () => {
    onAtualizar();
    recarregarConexoes();
    recarregarAgendador();
  };

  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora faz o mesmo que o "Atualizar". ⚠️ Os blocos voltam
  // a "carregando" por um instante, como no botão — e é o certo aqui: esta tela
  // AFIRMA ("tudo em ordem", "0 vencidas"), e afirmar sobre números velhos
  // seria pior que piscar.
  useAoVoltarParaOApp(atualizarTudo);

  const carregando = [
    resumo.novidades,
    resumo.tarefas,
    resumo.conversas,
    resumo.fila,
    area.correcoes,
    area.integracoes,
    area.resultados,
    area.negocios,
    area.agenda,
  ].some((b) => b.status === 'carregando');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">
            {agora.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1 className="text-foreground mt-0.5 text-xl font-semibold">
            {saudacao}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {carregando && (
            <span role="status" className="text-muted-foreground text-xs">
              {t('loading')}
            </span>
          )}
          <Button
            variant="outline"
            onClick={atualizarTudo}
            disabled={carregando}
            aria-busy={carregando}
          >
            {tResumo('refresh')}
          </Button>
        </div>
      </div>

      {/* ⚠️ Grid de SEIS colunas: a primeira fileira são os três blocos
          pessoais (o que está com a pessoa AGORA), e as duas de baixo, os de
          operação, em meias larguras. A ordem não é estética — é a de quem
          abre a tela para trabalhar: primeiro o que é seu, depois o que
          quebrou, por último o que já andou. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        <section className="border-border bg-card rounded-xl border p-4 shadow-sm lg:col-span-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {pedido.daConfirmacao
              ? tResumo('sinceLast', {
                  quando: new Date(pedido.desdeMs).toLocaleString(undefined, {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })
              : tResumo('last24h')}
          </h2>
          <Novidades
            bloco={resumo.novidades}
            veNotificacoes={veNotificacoes}
            onContinuar={NADA}
          />
        </section>

        <section className="border-border bg-card rounded-xl border p-4 shadow-sm lg:col-span-2">
          <Cabecalho
            icone={<ListTodo className="size-4" aria-hidden />}
            titulo={tResumo('tasksTitle')}
            direita={
              resumo.tarefas.status === 'pronto' ? (
                <span className="text-sm">
                  {tResumo('tasksOverdue', {
                    count: resumo.tarefas.dados.totais.vencidas,
                  })}
                </span>
              ) : null
            }
          />
          <Tarefas
            bloco={resumo.tarefas}
            hoje={diaLocal(agora)}
            veTarefas={veTarefas}
            veContatos={veContatos}
            onContinuar={NADA}
          />
        </section>

        <section className="border-border bg-card rounded-xl border p-4 shadow-sm lg:col-span-2">
          <Cabecalho
            icone={<MessageCircle className="size-4" aria-hidden />}
            titulo={tResumo('conversationsTitle')}
            direita={null}
          />
          <Conversas
            conversas={resumo.conversas}
            fila={resumo.fila}
            temConfirmacaoAnterior={pedido.daConfirmacao}
            veInbox={veInbox}
            onContinuar={NADA}
          />
        </section>

        {/* ⚠️ Só o ADMINISTRADOR vê o que precisa ser corrigido (pedido do
            operador, 13/09/2026). É a régua das abas analíticas do funil
            (`view-reports`), e pela mesma razão: agendada que não saiu,
            conexão fora do ar, automação que falhou e entrada que não virou
            atendimento são a saúde da OPERAÇÃO — quem conserta é quem
            administra, e para o atendente seria um alarme sobre o qual ele
            não pode agir. ⚠️ `useCan` deriva do acesso EFETIVO, então o
            "Ver como" esconde o bloco junto; e devolve `false` enquanto o
            perfil carrega, de propósito — o bloco entra depois, em vez de
            piscar para quem não o vê. */}
        {veCorrecoes && (
          <div className="lg:col-span-3">
            <BlocoDeCorrecoes
              correcoes={area.correcoes}
              integracoes={area.integracoes}
              conexoes={conexoes}
              conexoesAtrasadas={conexoesAtrasadas}
              agendadorParado={
                saude === null ? null : agendadorEstaParado(saude)
              }
              veAgendadas={veAgendadas}
              veAutomacoes={veAutomacoes}
              veConexoes={veConexoes}
              veIntegracoes={veIntegracoes}
              veInbox={veInbox}
              veContatos={veContatos}
            />
          </div>
        )}

        <div className="lg:col-span-3">
          <BlocoDeResultados
            bloco={area.resultados}
            veTarefas={veTarefas}
            veFunis={veFunis}
            veContatos={veContatos}
          />
        </div>

        <div className="lg:col-span-3">
          <BlocoDeNegocios bloco={area.negocios} veFunis={veFunis} />
        </div>

        <div className="lg:col-span-3">
          <BlocoDaAgenda
            bloco={area.agenda}
            agoraMs={pedido.agoraMs}
            veAgenda={veAgenda}
          />
        </div>
      </div>
    </div>
  );
}
