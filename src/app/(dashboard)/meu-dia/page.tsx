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

import { useState } from 'react';
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
import { useAuth } from '@/hooks/use-auth';
import { useChannelHealth } from '@/hooks/use-channel-health';
import { useResumoDoDia } from '@/hooks/use-resumo-do-dia';
import type { EstadoDaFonte } from '@/lib/meu-dia/correcoes';
import { canaisVisiveis } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { podeVerTela } from '@/lib/perfis/visibilidade';
import { lerRegistroDoNavegador } from '@/lib/resumo-do-dia/navegador';
import { inicioDasNovidades } from '@/lib/resumo-do-dia/pendencia';
import type { SaudeDoAgendador } from '@/lib/scheduled/saude';
import { diaLocal } from '@/lib/tasks/prazo';

interface Pedido {
  agoraMs: number;
  desdeMs: number;
  daConfirmacao: boolean;
}

function montarPedido(userId: string | null): Pedido {
  const agoraMs = Date.now();
  const inicio = inicioDasNovidades(
    userId ? lerRegistroDoNavegador(userId) : null,
    agoraMs
  );
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

export default function MeuDiaPage() {
  const { user, accountId, accountStatus, profile, acesso } = useAuth();
  const userId = user?.id ?? null;

  // O pedido nasce no inicializador e só muda no clique em "Atualizar" — o
  // relógio novo (`agoraMs`) é a chave que faz os hooks consultarem de novo.
  const [pedido, setPedido] = useState<Pedido>(() => montarPedido(userId));

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
      onAtualizar={() => setPedido(montarPedido(userId))}
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

  const veTarefas = podeVerTela(acesso, 'tarefas');
  const veContatos = podeVerTela(acesso, 'contacts');
  const veInbox = podeVerTela(acesso, 'inbox');
  const veNotificacoes = podeVerTela(acesso, 'notifications');
  const veAgendadas = podeVerTela(acesso, 'agendadas');
  const veAgenda = podeVerTela(acesso, 'agenda');
  const veFunis = podeVerTela(acesso, 'pipelines');
  const veConfiguracoes = podeVerTela(acesso, 'settings');

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

        <div className="lg:col-span-3">
          <BlocoDeCorrecoes
            correcoes={area.correcoes}
            integracoes={area.integracoes}
            conexoes={conexoes}
            agendadorParado={saude === null ? null : agendadorEstaParado(saude)}
            veAgendadas={veAgendadas}
            veConfiguracoes={veConfiguracoes}
          />
        </div>

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
