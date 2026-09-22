"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Automation, Deal, PipelineStage } from "@/types";
import type { CbChannel } from "@/lib/cb-channels/repo";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/dashboard/skeleton";
import { MessageSquare, Plus, Zap } from "lucide-react";
import { useSinalDeExecucoes } from "@/hooks/use-sinal-de-execucoes";
import { useChannels } from "@/hooks/use-channels";
import { formatCurrency } from "@/lib/currency";
import { contarAtivasNaEtapa } from "@/lib/automations/por-etapa";
import { useTranslations } from "next-intl";
import {
  temConteudo,
  type CardDoQuadro,
  type DealDoQuadro,
} from "@/lib/pipelines/cartao";
import type { CamposDoCard } from "@/lib/pipelines/campos-do-card";
import { gravarRetorno, lerRetorno } from "@/lib/pipelines/retorno";
import { urlDoInbox } from "@/lib/inbox/url";

/**
 * Quantos cards uma coluna desenha de uma vez.
 *
 * ⚠️⚠️ O PR #227 consertou o DADO (a consulta de `deals` da página passou a
 * paginar); o RENDER continuava desenhando TUDO. Medido contra o que a
 * migração da Kommo traz: o funil "Trabalhista - Comercial" fica com ~8.400
 * cards, e a coluna "Perdido" sozinha com 2.719. Um `deals.map` por coluna
 * monta 8.400 componentes React e registra 8.400 `useDraggable` num commit
 * só, e a coluna estica a página para centenas de milhares de pixels: no
 * computador tranca a thread principal, e no CRM instalado no iPhone o
 * provável é o app ser morto pelo sistema — a tela principal do funil deixa
 * de abrir. Em 22/09/2026, depois da primeira carga da Kommo, ele tinha 3.673.
 *
 * 100 POR COLUNA, no molde da lista de leads (`funil/lista-de-leads.tsx`,
 * que usa o mesmo número para a tabela inteira). Com as colunas de um funil
 * real isso dá algumas centenas de cards no primeiro desenho — a faixa que
 * a produção já prova hoje —, contra os 8.400 de uma coluna sem teto.
 *
 * Sem biblioteca de virtualização, de propósito: o "carregar mais" é uma
 * linha de estado, e virtualizar DENTRO de um `DndContext` (cada card é um
 * `useDraggable`, a coluna é um `useDroppable`) é outra obra.
 */
export const CARDS_POR_COLUNA = 100;

/**
 * Os cards que a coluna desenha: os `limite` primeiros, mais o card que
 * ACABOU de ser solto aqui quando ele cairia fora do teto.
 *
 * ⚠️ A segunda metade não é zelo: sem ela o arrasto SOME com o card. A
 * ordem do quadro é `created_at DESC, id ASC` (a consulta da página) e
 * mover não reordena nada — o negócio de meses atrás arrastado para
 * "Perdido" entra na posição ~2.700 de uma coluna que desenha 100, e o
 * operador vê o card desaparecer no instante em que o soltou, sem erro
 * nenhum. Ele entra no TOPO porque é a única posição que existe qualquer
 * que seja o teto (a natural dele está atrás do "carregar mais").
 *
 * Nunca duplica: só entra quando NÃO está entre os visíveis.
 */
export function cardsDaColuna<T extends { id: string }>(
  deals: T[],
  limite: number,
  recemSolto: string | null,
): T[] {
  if (deals.length <= limite) return deals;
  const visiveis = deals.slice(0, limite);
  if (!recemSolto || visiveis.some((d) => d.id === recemSolto)) return visiveis;
  // Nulo quando o card foi solto em OUTRA coluna — o id é do quadro inteiro.
  const solto = deals.find((d) => d.id === recemSolto);
  return solto ? [solto, ...visiveis] : visiveis;
}

/**
 * Os ids que as colunas desenham com estes tetos — a regra do render
 * (`cardsDaColuna`), para a página baixar na carga o conteúdo destes cards
 * (ver `DEAL_SELECT_ENXUTO`). Cada card conta na coluna da própria etapa, na
 * ordem da lista. Fica de fora o card recém-solto que o render fixa no topo
 * de uma coluna cheia: esse a coluna pede à parte, depois da carga.
 */
export function idsDesenhados(
  cards: readonly { id: string; stage_id: string }[],
  limites: Record<string, number>,
): string[] {
  const porEtapa = new Map<string, { id: string }[]>();
  for (const card of cards) {
    const coluna = porEtapa.get(card.stage_id);
    if (coluna) coluna.push(card);
    else porEtapa.set(card.stage_id, [card]);
  }
  return [...porEtapa].flatMap(([etapa, coluna]) =>
    cardsDaColuna(coluna, limites[etapa] ?? CARDS_POR_COLUNA, null).map((c) => c.id),
  );
}

/**
 * Os tetos por coluna, carimbados com o funil a que pertencem. Exportado
 * porque a PÁGINA cria o ref e o quadro só o alimenta.
 */
export interface TetosDoQuadro {
  funil: string;
  porEtapa: Record<string, number>;
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  /** TODOS os cards do funil; os que a coluna não desenha, só enxutos. */
  deals: CardDoQuadro[];
  /**
   * Os cards DESENHADOS que ainda não têm conteúdo — "mostrar mais", o teto
   * que a volta do inbox restaura, o card que um arrasto expôs —, com o
   * funil da coluna. A página deduplica e baixa; a coluna só avisa.
   */
  onFaltaConteudo: (ids: string[], funil: string) => void;
  /** Automações da conta, para a etiqueta por coluna (Fase 5). */
  automations: Automation[];
  /** O funil exibido — carimba o ponto de retorno ao sair para o inbox. */
  pipelineId: string;
  /** O que os cards exibem (popover da barra, por dispositivo). */
  campos: CamposDoCard;
  /**
   * Criado pela PÁGINA e atachado aqui no `.pipeline-scroll`: a página
   * também precisa medir a rolagem (o link do formulário de negócio grava o
   * retorno da mesma jornada).
   */
  quadroRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Idem: os tetos por coluna são estado DAQUI, mas a página é quem grava o
   * retorno pelo link "ver conversa" do formulário do negócio — aberto pelo
   * lápis de um card que pode ser o de número 150 de uma coluna expandida.
   * Sem este espelho, aquela saída grava rolagem sem tetos e a volta cai num
   * quadro de 100 cards, com o card de origem ausente e o `scrollTop`
   * grampeado (achado do Codex no PR #231, 2ª rodada).
   *
   * Carimbado com o funil: o quadro DESMONTA ao trocar para a Lista, e o
   * `useEffect` de limpeza não roda a troca de funil feita de lá — sem o
   * carimbo, o retorno do funil B levaria os tetos do funil A.
   */
  limitesRef: React.MutableRefObject<TetosDoQuadro>;
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenAutomations: (stage: PipelineStage) => void;
}

export function PipelineBoard({
  stages,
  deals,
  onFaltaConteudo,
  automations,
  pipelineId,
  campos,
  quadroRef,
  limitesRef,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  onOpenAutomations,
}: PipelineBoardProps) {
  const router = useRouter();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  /**
   * Quanto cada coluna já revelou, CARIMBADO com o funil a que pertence.
   *
   * ⚠️ Trocar de funil tem de voltar ao teto inicial, senão a coluna do
   * funil novo abre expandida com o limite que o operador subiu no
   * anterior. E a volta NÃO pode ser um efeito: `setState` síncrono em
   * efeito é ERRO do React Compiler neste projeto (PRs #92/#94). Carimbar o
   * dono e comparar contra o prop do render ATUAL é o mesmo padrão dos
   * campos personalizados (`{ de, mapa }`) — e não tem o quadro em que o
   * efeito ainda não rodou.
   */
  const [limites, setLimites] = useState<{
    funil: string;
    porEtapa: Record<string, number>;
  }>({ funil: pipelineId, porEtapa: {} });
  // `useMemo` para o `{}` do ramo vazio não ganhar identidade nova a cada
  // render — sem ele, o efeito que alimenta `limitesRef` rodaria sempre.
  const limitesDoFunil = useMemo(
    () => (limites.funil === pipelineId ? limites.porEtapa : {}),
    [limites, pipelineId],
  );
  /**
   * Espelho dos tetos para `navegarParaInbox` ler sem virar dependência dele
   * — ver o porquê lá. Efeito passivo basta: o valor só precisa estar em dia
   * quando o operador CLICA, que é muito depois de qualquer commit.
   *
   * ⚠️ O ref é da PÁGINA (prop), não deste componente: a outra saída para o
   * inbox — o link do formulário do negócio — é gravada lá, e um ref local
   * seria invisível para ela.
   */
  useEffect(() => {
    limitesRef.current = { funil: pipelineId, porEtapa: limitesDoFunil };
  }, [limitesRef, pipelineId, limitesDoFunil]);
  /**
   * O último card solto. Só existe para `cardsDaColuna` poder trazê-lo para
   * dentro do teto — ver o porquê lá.
   */
  const [recemSolto, setRecemSolto] = useState<string | null>(null);

  const mostrarMais = useCallback(
    (stageId: string) => {
      setLimites((atual) => {
        const base = atual.funil === pipelineId ? atual.porEtapa : {};
        return {
          funil: pipelineId,
          porEtapa: {
            ...base,
            [stageId]: (base[stageId] ?? CARDS_POR_COLUNA) + CARDS_POR_COLUNA,
          },
        };
      });
    },
    [pipelineId],
  );
  // UMA busca de canais para o quadro inteiro. Dentro do card, o hook
  // disparava um GET /api/cb/channels POR CARD (120 numa conta real) a cada
  // montagem — achado da revisão do PR #71.
  const { channels } = useChannels();
  // Quais clientes têm automação agendada (985) — UMA consulta para o quadro
  // inteiro. O mapa é memoizado por identidade do resumo: sem isso, um objeto
  // novo a cada render derrubaria o `memo` dos ~120 cards.
  const { resumo: sinalDeExecucoes } = useSinalDeExecucoes();
  const esperasPorContato = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const [id, info] of Object.entries(sinalDeExecucoes?.porContato ?? {})) {
      mapa[id] = info.esperas;
    }
    return mapa;
  }, [sinalDeExecucoes]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, CardDoQuadro[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  /**
   * As duas portas de saída para o inbox (corpo do card e botão da coluna)
   * gravam o ponto de retorno ANTES de navegar — é o que permite à volta
   * cair no mesmo funil, na mesma rolagem. O scroll vertical da página é o
   * `<main>` do dashboard-shell (único ancestral com overflow-y), alcançado
   * por `closest` para não acoplar a shell a esta feature.
   *
   * `useCallback` até o card: com handlers estáveis, o `memo` do DealCard
   * segura o re-render dos ~120 cards quando um diálogo irmão digita.
   */
  const navegarParaInbox = useCallback(
    (destino: { c?: string; etapa?: string }) => {
      const quadro = quadroRef.current;
      gravarRetorno({
        pipelineId,
        scrollLeft: quadro?.scrollLeft ?? 0,
        scrollTop: quadro?.closest("main")?.scrollTop ?? 0,
        // ⚠️ Os tetos viajam junto com a rolagem: quem abriu a conversa a
        // partir do card 150 volta, sem eles, para um quadro de 100 — o card
        // de origem não existe e o `scrollTop` é grampeado pela altura menor.
        //
        // ⚠️ Lido por REF, nunca por dependência: `limitesDoFunil` ganha
        // identidade nova a cada render, e pô-lo aqui desestabilizaria este
        // callback — que é o que segura o `memo` do DealCard e impede os
        // ~120 cards de redesenharem a cada tecla digitada num diálogo irmão
        // (o achado da revisão do PR #71, registrado logo acima).
        limites:
          limitesRef.current.funil === pipelineId
            ? limitesRef.current.porEtapa
            : {},
      });
      router.push(urlDoInbox({ ...destino, de: "funil" }));
    },
    [pipelineId, quadroRef, limitesRef, router],
  );
  const abrirConversa = useCallback(
    (conversationId: string) => navegarParaInbox({ c: conversationId }),
    [navegarParaInbox],
  );
  const verConversas = useCallback(
    (stageId: string) => navegarParaInbox({ etapa: stageId }),
    [navegarParaInbox],
  );

  /**
   * A volta: aplica o retorno gravado acima. O registro NÃO é apagado — ele
   * expira (ver retorno.ts): apagar no consumo perdia a restauração quando o
   * quadro desmontava antes dos rAF, e quebrava o ir-e-voltar repetido da
   * mesma jornada. `aplicadoRef` impede reaplicar no MESMO mount quando
   * `sortedStages` troca de identidade (refreshStages).
   *
   * Dispara quando as colunas existem — etapas e negócios chegam no MESMO
   * commit (Promise.all na página), então aqui o quadro já tem a largura e
   * a altura reais. ⚠️ O `loading` da página NÃO serviria de gatilho: ele
   * cobre só a carga dos funis, e restaurar sobre um quadro vazio grampeia
   * o scroll em zero.
   */
  const aplicadoRef = useRef(false);
  useEffect(() => {
    if (aplicadoRef.current) return;
    if (sortedStages.length === 0) return;
    const retorno = lerRetorno();
    if (!retorno) return;
    // Funil apagado/trocado no meio do caminho: o registro não é deste quadro.
    if (retorno.pipelineId !== pipelineId) return;
    // Dois rAF: o primeiro devolve o controle depois do commit, o segundo
    // depois do layout — só aí scrollWidth/scrollHeight são reais. Os ids
    // são cancelados no cleanup: sem isso, desmontar na janela (trocar para
    // a vista de automações) dispararia scrollTo contra ref nula.
    // ⚠️ `aplicadoRef` só é marcado DEPOIS de aplicar, dentro do rAF: no
    // StrictMode o efeito roda, o cleanup cancela os rAF e o efeito roda de
    // novo — marcado antes, a segunda passada pularia a restauração.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      // ⚠️ Os tetos voltam ANTES da rolagem, e é por isso que eles ficam no
      // PRIMEIRO quadro: restaurar 150 cards numa coluna muda a altura do
      // quadro, e o `scrollTo` do segundo mediria a altura menor e seria
      // grampeado. Aqui dentro, e não no corpo do efeito, porque `setState`
      // síncrono em efeito é ERRO do React Compiler neste projeto.
      if (Object.keys(retorno.limites).length > 0) {
        setLimites({ funil: retorno.pipelineId, porEtapa: retorno.limites });
      }
      raf2 = requestAnimationFrame(() => {
        // ⚠️ `behavior: "instant"` é obrigatório: `.pipeline-scroll` tem
        // `scroll-behavior: smooth` no styled-jsx abaixo, e restaurar
        // obedecendo o CSS viraria uma varredura animada a cada volta.
        quadroRef.current?.scrollTo({
          left: retorno.scrollLeft,
          behavior: "instant",
        });
        quadroRef.current
          ?.closest("main")
          ?.scrollTo({ top: retorno.scrollTop, behavior: "instant" });
        aplicadoRef.current = true;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [sortedStages, pipelineId, quadroRef]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  // Só card com conteúdo é arrastável (o que ainda carrega não registra
  // `useDraggable`), mas o tipo não sabe disso.
  const arrastado = activeDealId ? deals.find((d) => d.id === activeDealId) : undefined;
  const activeDeal = arrastado && temConteudo(arrastado) ? arrastado : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    // Só marca quando o movimento REALMENTE acontece (as três saídas acima
    // devolvem o card ao lugar) — senão a coluna de origem passaria a fixar
    // no topo um card que ninguém moveu.
    setRecemSolto(dealId);
    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div
        ref={quadroRef}
        className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none"
      >
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              automacoesAtivas={contarAtivasNaEtapa(automations, stage.id)}
              campos={campos}
              channels={channels}
              esperasPorContato={esperasPorContato}
              limite={limitesDoFunil[stage.id] ?? CARDS_POR_COLUNA}
              recemSolto={recemSolto}
              onMostrarMais={mostrarMais}
              onFaltaConteudo={onFaltaConteudo}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              onAbrirConversa={abrirConversa}
              onVerConversas={verConversas}
              onOpenAutomations={onOpenAutomations}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              campos={campos}
              channels={channels}
              onEdit={() => {}}
              onAbrirConversa={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  automacoesAtivas,
  campos,
  channels,
  esperasPorContato,
  limite,
  recemSolto,
  onMostrarMais,
  onFaltaConteudo,
  onAddDeal,
  onEditDeal,
  onAbrirConversa,
  onVerConversas,
  onOpenAutomations,
}: {
  stage: PipelineStage;
  deals: CardDoQuadro[];
  totalValue: number;
  automacoesAtivas: number;
  campos: CamposDoCard;
  channels: CbChannel[];
  /** Quantos cards desta coluna desenhar — ver `CARDS_POR_COLUNA`. */
  limite: number;
  /** O último card solto no quadro (pode ser de outra coluna). */
  recemSolto: string | null;
  onMostrarMais: (stageId: string) => void;
  onFaltaConteudo: (ids: string[], funil: string) => void;
  /**
   * contato → quantas automações agendadas (985). Um mapa só para o quadro
   * inteiro, buscado UMA vez no board: um hook por card seria uma requisição
   * por card, e um objeto novo por render quebraria o `memo` do `DealCard`.
   */
  esperasPorContato: Record<string, number>;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onAbrirConversa: (conversationId: string) => void;
  onVerConversas: (stageId: string) => void;
  onOpenAutomations: (stage: PipelineStage) => void;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // ⚠️ O contador do cabeçalho e o somatório continuam vindo de `deals`, a
  // coluna INTEIRA: o teto é de desenho, não de dado, e um "100" no
  // distintivo de uma coluna com 2.719 cards seria mentira.
  const visiveis = cardsDaColuna(deals, limite, recemSolto);
  const escondidos = deals.length - visiveis.length;
  // O desenhado que ainda não tem conteúdo é pedido à página, que não repete
  // o que já está a caminho. ⚠️ `deals` nas dependências, e não só o texto
  // dos ids: uma recarga que devolva à coluna o MESMO conjunto sem conteúdo
  // (ou uma falha seguida de outra mudança do quadro) tem de pedir de novo.
  const faltam = visiveis
    .filter((d) => !temConteudo(d))
    .map((d) => d.id)
    .join(",");
  useEffect(() => {
    if (faltam) onFaltaConteudo(faltam.split(","), stage.pipeline_id);
  }, [faltam, deals, stage.pipeline_id, onFaltaConteudo]);

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between gap-1 pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {/* As conversas desta etapa, na caixa de entrada — abre o inbox com
              o filtro de etapa já semeado (?etapa=), gravando o retorno como
              o clique no card: é a mesma jornada de ida e volta. */}
          <button
            type="button"
            onClick={() => onVerConversas(stage.id)}
            aria-label={t("stageConversations")}
            title={t("stageConversations")}
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
          {/* Automações desta coluna (Fase 5). Fica visível mesmo com zero:
              é por aqui que se CRIA a primeira, e um botão que só aparece
              depois de já existir automação não ensina ninguém.

              ⚠️ O número conta o que dispara e está LIGADO — inclusive as
              regras de etapa nenhuma, que valem para todas. Ver
              `contarAtivasNaEtapa`. */}
          <button
            type="button"
            onClick={() => onOpenAutomations(stage)}
            aria-label={t("stageAutomations", { count: automacoesAtivas })}
            title={t("stageAutomations", { count: automacoesAtivas })}
            className={
              automacoesAtivas > 0
                ? "inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                : "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            }
          >
            <Zap className="h-3 w-3" />
            {automacoesAtivas > 0 && (
              <span className="tabular-nums">{automacoesAtivas}</span>
            )}
          </button>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {deals.length}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(totalValue)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          visiveis.map((deal) =>
            temConteudo(deal) ? (
              <DraggableDealCard
                key={deal.id}
                deal={deal}
                stage={stage}
                campos={campos}
                channels={channels}
                esperasDeAutomacao={
                  esperasPorContato[deal.contact_id ?? ""] ?? 0
                }
                onEdit={onEditDeal}
                onAbrirConversa={onAbrirConversa}
              />
            ) : (
              <CardCarregando key={deal.id} titulo={deal.title} />
            ),
          )
        )}

        {/* Dentro da área de soltura, de propósito: quem arrasta até o fim
            de uma coluna cheia solta em cima deste botão, e fora dela o
            gesto cairia no vão entre o quadro e "Adicionar negócio". */}
        {escondidos > 0 && (
          <button
            type="button"
            onClick={() => onMostrarMais(stage.id)}
            className="w-full rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t("loadMoreCards", {
              n: Math.min(CARDS_POR_COLUNA, escondidos),
            })}
          </button>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  campos,
  channels,
  esperasDeAutomacao,
  onEdit,
  onAbrirConversa,
}: {
  deal: DealDoQuadro;
  stage: PipelineStage;
  campos: CamposDoCard;
  channels: CbChannel[];
  /** Número primitivo, para não quebrar o `memo` do card. */
  esperasDeAutomacao: number;
  onEdit: (deal: Deal) => void;
  onAbrirConversa: (conversationId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        campos={campos}
        channels={channels}
        esperasDeAutomacao={esperasDeAutomacao}
        onEdit={onEdit}
        onAbrirConversa={onAbrirConversa}
      />
    </div>
  );
}

/**
 * O card desenhado cujo conteúdo ainda não chegou: no lugar certo, com o
 * título que a lista enxuta já tem — nunca some da coluna nem muda o
 * contador. Mesma moldura do `DealCard`, para a altura não pular quando o
 * conteúdo chega. Não é arrastável nem clicável: os dois precisam do
 * negócio inteiro.
 */
function CardCarregando({ titulo }: { titulo: string }) {
  return (
    <div
      aria-busy="true"
      className="rounded-xl border border-border/50 bg-muted/70 py-3 pl-4 pr-3 shadow-sm"
    >
      <p className="truncate text-sm font-semibold text-muted-foreground">{titulo}</p>
      <Skeleton className="mt-3 h-3 w-2/3 rounded" />
      <Skeleton className="mt-3 h-3 w-1/3 rounded" />
    </div>
  );
}
