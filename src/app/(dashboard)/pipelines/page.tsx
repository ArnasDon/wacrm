"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buscarPaginado } from "@/lib/supabase/paginar";
import type {
  Automation,
  AutomationStep,
  Pipeline,
  PipelineStage,
  Deal,
} from "@/types";
import {
  PipelineBoard,
  idsDesenhados,
  type TetosDoQuadro,
} from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { AutomationsBoard } from "@/components/pipelines/automations-board";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import {
  VISTA_PADRAO,
  vistaVigente,
  vistasPermitidas,
  type VistaDoFunil,
} from "@/lib/pipelines/vistas";
import { funisVisiveis } from "@/lib/perfis/escopo";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { ListaDeLeads } from "@/components/funil/lista-de-leads";
import { Desempenho } from "@/components/funil/desempenho";
import { Saude } from "@/components/funil/saude";
import { useTranslations } from "next-intl";
import { avisarDrenagemDeFunil } from "@/lib/automations/avisar-drenagem";
import { statusAoEntrarNaEtapa } from "@/lib/pipelines/resultado";
import {
  DEAL_SELECT_BASICO,
  DEAL_SELECT_DO_QUADRO,
  DEAL_SELECT_ENXUTO,
  juntarConteudo,
  normalizarDealDoQuadro,
  type CardDoQuadro,
  type CardSemConteudo,
  type DealDoQuadro,
  type RawDealDoQuadro,
} from "@/lib/pipelines/cartao";
import {
  CAMPOS_PADRAO,
  CHAVE_CAMPOS_DO_CARD,
  normalizarCampos,
  type CamposDoCard,
} from "@/lib/pipelines/campos-do-card";
import { gravarRetorno, lerRetorno } from "@/lib/pipelines/retorno";
import { lerUrlDoFunil } from "@/lib/pipelines/url";
import { CamposDoCardPopover } from "@/components/pipelines/campos-do-card-popover";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// A recusa de embed pelo PostgREST (cache de schema velho pós-migration) é
// PERSISTENTE, não transitória: lembrada aqui, as cargas seguintes vão direto
// ao select básico em vez de pagar duas consultas por troca de funil.
let embedDoQuadroRecusado = false;

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
];

// `useSearchParams` (a volta do construtor de automações pede aba e funil
// pela URL) pede um Suspense em página estática — o mesmo embrulho do inbox
// e de `/automations/new`. Medido em 18/09/2026: HOJE o build passaria sem
// ele, porque a casca do painel só monta a página depois do login, no
// navegador; o embrulho segura o dia em que ela renderizar no servidor.
export default function PipelinesPage() {
  return (
    <Suspense fallback={null}>
      <PipelinesPageInner />
    </Suspense>
  );
}

function PipelinesPageInner() {
  const t = useTranslations("Pipelines.page");
  const tAuto = useTranslations("Pipelines.automacoes");
  const searchParams = useSearchParams();
  // Porta de ENTRADA (`?vista=` e `?funil=`), lida UMA vez na montagem: é por
  // ela que o voltar do construtor de automações devolve o operador à grade
  // do funil de onde saiu. Trocar de aba ou de funil depois não reescreve a
  // URL (ver `lib/pipelines/url.ts`).
  const [pedidoDaUrl] = useState(() => lerUrlDoFunil(searchParams));
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const podeAutomacoes = useCan("manage-automations");
  // Lista, Desempenho e Saúde: leituras da conta INTEIRA, de administrador
  // (decisão do operador, 08/09/2026 — ver `canViewReports`).
  const podeRelatorios = useCan("view-reports");
  const poderesDoFunil = { relatorios: podeRelatorios, automacoes: podeAutomacoes };
  const { acesso, accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  // De QUAL funil são as `stages` em estado: elas chegam depois da seleção,
  // e Desempenho/Saúde precisam distinguir "ainda não chegaram" de "o funil
  // não tem etapa" — os dois são `[]` (Codex, PR #121).
  const [etapasDe, setEtapasDe] = useState<string>("");
  const [deals, setDeals] = useState<CardDoQuadro[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * O que os cards exibem — escolha POR DISPOSITIVO (localStorage). Lida em
   * efeito pós-mount, nunca no inicializador: esta página tem passe SSR, e
   * ler storage síncrono produziria hydration mismatch (mesmo padrão do
   * painel do inbox). O parse fica DENTRO do try — registro corrompido não
   * pode derrubar a página.
   */
  const [campos, setCampos] = useState<CamposDoCard>(CAMPOS_PADRAO);
  useEffect(() => {
    try {
      const cru = localStorage.getItem(CHAVE_CAMPOS_DO_CARD);
      if (cru !== null) setCampos(normalizarCampos(JSON.parse(cru)));
    } catch {
      // Navegação privativa / JSON inválido — fica no padrão.
    }
  }, []);
  const trocarCampos = useCallback((next: CamposDoCard) => {
    setCampos(next);
    try {
      localStorage.setItem(CHAVE_CAMPOS_DO_CARD, JSON.stringify(next));
    } catch {
      // Persistência é melhor esforço; a escolha vale para a sessão.
    }
  }, []);

  /**
   * O `.pipeline-scroll` do quadro. Criado AQUI porque duas saídas para o
   * inbox precisam medi-lo: as do board (card e coluna) e o link "ver
   * conversa" do formulário de negócio — todas gravam o mesmo retorno.
   */
  const quadroRef = useRef<HTMLDivElement>(null);
  /**
   * Pelo MESMO motivo, e é o ponto que faltava: os tetos por coluna são
   * estado do quadro, mas esta saída também precisa deles. Quem abre o
   * formulário pelo lápis de um card e segue o link "ver conversa" grava
   * daqui — e sem os tetos a volta cai num quadro de 100 cards, com o card
   * de origem ausente e a rolagem grampeada, que é exatamente o defeito que
   * os tetos no retorno existem para consertar (Codex, PR #231, 2ª rodada).
   *
   * O quadro alimenta o ref; a leitura confere o carimbo do funil, porque o
   * quadro desmonta na vista Lista e ninguém zera o ref ao trocar de funil
   * de lá.
   */
  const limitesDoQuadroRef = useRef<TetosDoQuadro>({ funil: "", porEtapa: {} });
  const salvarRetornoDoQuadro = useCallback(() => {
    const tetos = limitesDoQuadroRef.current;
    gravarRetorno({
      pipelineId: selectedPipelineId,
      scrollLeft: quadroRef.current?.scrollLeft ?? 0,
      scrollTop: quadroRef.current?.closest("main")?.scrollTop ?? 0,
      limites: tetos.funil === selectedPipelineId ? tetos.porEtapa : {},
    });
  }, [selectedPipelineId]);

  // Automações de funil da conta inteira (Fase 5). Não é por funil de
  // propósito: a regra de gatilho VAZIO vale para toda etapa de todo funil, e
  // filtrar por `pipeline_id` aqui a esconderia — a automação existe, dispara,
  // e a coluna diria que não há nada.
  const [automations, setAutomations] = useState<Automation[]>([]);
  /** Passos por automação, para o resumo do cartão ("Adicionar tag: X"). */
  const [steps, setSteps] = useState<Record<string, AutomationStep[]>>({});
  /** Nomes de tag/etapa/robô, para o cartão não exibir UUID. */
  const [nomes, setNomes] = useState<{
    tags: Record<string, string>;
    etapas: Record<string, string>;
    fluxos: Record<string, string>;
    automacoes: Record<string, string>;
  }>({ tags: {}, etapas: {}, fluxos: {}, automacoes: {} });

  /** "leads" = o Kanban de sempre; "automacoes" = a grade estilo Kommo. */
  // "leads" é o QUADRO (o id ficou pelo diff mínimo; o rótulo virou "Quadro"
  // quando a lista chegou, na Fase 1 do funil comercial).
  const [vistaEscolhida, setVista] = useState<VistaDoFunil>(
    pedidoDaUrl.vista ?? VISTA_PADRAO,
  );
  // ⚠️ A aba vigente é resolvida no RENDER, nunca guardada por efeito: a
  // lente de simulação de perfil troca o papel com a tela montada, e uma aba
  // proibida que sobrevivesse até o efeito rodar mostraria o Desempenho da
  // conta inteira a quem acabou de perder o acesso.
  const vista = vistaVigente(vistaEscolhida, poderesDoFunil);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  /**
   * O catálogo de funis. `null` = a consulta FALHOU — o motivo do
   * `buscarEtapas`: voltar ao app com a rede ainda voltando não pode apagar a
   * lista de funis e a seleção (Codex, PR #216, 4ª rodada). Quem já usava
   * `loadPipelines` continua recebendo `[]`.
   */
  const buscarFunis = useCallback(async (): Promise<Pipeline[] | null> => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return null;
    }
    return (data ?? []) as Pipeline[];
  }, [supabase]);

  const loadPipelines = useCallback(
    async (): Promise<Pipeline[]> => (await buscarFunis()) ?? [],
    [buscarFunis],
  );

  /**
   * As etapas do funil. `null` = a consulta FALHOU, que é diferente de "funil
   * sem etapa" (`[]`): a recarga de quem volta ao app mantém o quadro na
   * falha em vez de esvaziá-lo (Codex, PR #216). Quem já usava `loadStages`
   * continua recebendo `[]`.
   */
  const buscarEtapas = useCallback(
    async (pipelineId: string): Promise<PipelineStage[] | null> => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      if (error) {
        console.error("Failed to load stages:", error.message);
        return null;
      }
      return (data ?? []) as PipelineStage[];
    },
    [supabase],
  );

  const loadStages = useCallback(
    async (pipelineId: string): Promise<PipelineStage[]> =>
      (await buscarEtapas(pipelineId)) ?? [],
    [buscarEtapas],
  );

  /**
   * O conteúdo completo de cards, por id (ver `DEAL_SELECT_ENXUTO`): a carga
   * pede o dos desenhados, a coluna pede o do "mostrar mais". Em fatias de
   * 100 ids, em paralelo — é GET, e cada id custa ~37 caracteres na URL.
   * `null` = falhou (o select do quadro E o plano B).
   */
  const buscarConteudo = useCallback(
    async (ids: string[]): Promise<Map<string, DealDoQuadro> | null> => {
      const buscar = async (select: string) => {
        const fatias: string[][] = [];
        for (let i = 0; i < ids.length; i += 100) fatias.push(ids.slice(i, i + 100));
        const respostas = await Promise.all(
          fatias.map((fatia) => supabase.from("deals").select(select).in("id", fatia)),
        );
        const falha = respostas.find((r) => r.error || !r.data);
        if (falha) return { linhas: null, erro: falha.error };
        const linhas = respostas.flatMap((r) => (r.data ?? []) as unknown as RawDealDoQuadro[]);
        return { linhas: new Map(linhas.map((r) => [r.id, normalizarDealDoQuadro(r)])), erro: null };
      };

      if (!embedDoQuadroRecusado) {
        const doQuadro = await buscar(DEAL_SELECT_DO_QUADRO);
        if (doQuadro.linhas) return doQuadro.linhas;
        // ⚠️ Um embed recusado pelo PostgREST não pode derrubar o Kanban: sem
        // este plano B o quadro abriria VAZIO, sem mensagem nenhuma. Loga (os
        // campos do erro do Supabase não são enumeráveis) e refaz com o
        // select antigo — o quadro fica de pé, sem conversa/etiquetas nos
        // cards (e negócio pré-910 volta a abrir o formulário no clique).
        console.error("Failed to load deals (select do quadro):", {
          message: doQuadro.erro?.message,
          details: doQuadro.erro?.details,
          hint: doQuadro.erro?.hint,
          code: doQuadro.erro?.code,
        });
        embedDoQuadroRecusado = true;
      }

      const basico = await buscar(DEAL_SELECT_BASICO);
      if (!basico.linhas) {
        console.error("Failed to load deals (select básico):", {
          message: basico.erro?.message,
          details: basico.erro?.details,
          hint: basico.erro?.hint,
          code: basico.erro?.code,
        });
        return null;
      }
      return basico.linhas;
    },
    [supabase],
  );

  /**
   * Os negócios do quadro: a lista ENXUTA de todos e o conteúdo dos que as
   * colunas desenham com estes `limites` (ver `DEAL_SELECT_ENXUTO`). `null` =
   * não confie (a lista ou o conteúdo falhou) — mesmo motivo do
   * `buscarEtapas`. Quem já usava `loadDeals` continua recebendo `[]`, com o
   * toast.
   *
   * `limites` são os tetos a respeitar já na carga: os da volta do inbox (a
   * coluna expandida volta com o conteúdo, e a rolagem é restaurada sobre os
   * cards de verdade) e os do quadro na tela, numa recarga.
   */
  const buscarNegocios = useCallback(
    async (
      pipelineId: string,
      limites: Record<string, number> = {},
    ): Promise<CardDoQuadro[] | null> => {
      // ⚠️⚠️ PAGINADA desde 19/09/2026. Antes era uma consulta só, sem
      // `range` e sem `count`: o PostgREST corta em ~1000 linhas SEM AVISAR,
      // então um funil com mais de mil cards mostrava os 1.000 mais RECENTES
      // e contava errado nas colunas, em silêncio. A lista de conversas já
      // paginava a consulta de `deals` por esta exata razão
      // (`conversation-list.tsx`); o quadro, não. Hoje o Trabalhista -
      // Comercial tem 3.673 cards.
      type Linha = Omit<CardSemConteudo, "semConteudo">;
      const lista = await buscarPaginado<Linha>(async (de, ate) => {
        const { data, error, count } = await supabase
          .from("deals")
          .select(DEAL_SELECT_ENXUTO, { count: "exact" })
          .eq("pipeline_id", pipelineId)
          // ⚠️ O desempate por `id` é o que torna a paginação estável: dois
          // cards com o MESMO `created_at` (a carga da Kommo tem muitos)
          // ficam em ordem indefinida entre uma página e outra, e aí um
          // deles some do quadro e outro vem duas vezes.
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(de, ate);
        return { data: (data ?? null) as Linha[] | null, error, count };
      });
      if (!lista.linhas) {
        // ⚠️ Nunca meia lista com cara de lista inteira: a coleção que mudou
        // no meio da leitura, o teto e a falha viram o toast e a lista vazia
        // explícita de sempre — e a recarga da volta ao app mantém o quadro.
        console.error("Failed to load deals:", {
          motivo: lista.motivo,
          message: lista.erro?.message,
          details: lista.erro?.details,
          hint: lista.erro?.hint,
          code: lista.erro?.code,
        });
        toast.error(t("toastFailedLoadDeals"));
        return null;
      }
      const cards: CardDoQuadro[] = lista.linhas.map((linha) => ({
        ...linha,
        semConteudo: true as const,
      }));
      const ids = idsDesenhados(cards, limites);
      const conteudo = await buscarConteudo(ids);
      if (!conteudo) {
        // O plano B também pode falhar (rede, RLS): quadro de cards
        // "carregando" que nunca chegam seria pior que o toast de sempre.
        toast.error(t("toastFailedLoadDeals"));
        return null;
      }
      return juntarConteudo(cards, ids, conteudo);
    },
    [supabase, t, buscarConteudo],
  );

  const loadDeals = useCallback(
    async (
      pipelineId: string,
      limites?: Record<string, number>,
    ): Promise<CardDoQuadro[]> => (await buscarNegocios(pipelineId, limites)) ?? [],
    [buscarNegocios],
  );

  // Falha em silêncio → lista vazia. A etiqueta some e o painel diz "nenhuma";
  // é fail-open consciente, igual ao `useChannels`: sem as automações o
  // operador perde a INFORMAÇÃO, não o quadro. Travar o Kanban porque um GET
  // não respondeu seria pior.
  //
  // ⚠️ TODAS as automações da conta, não só as de gatilho de etapa (07/09):
  // a grade posiciona também os cartões de CHEGADA — regra de outro gatilho
  // (Calendly, palavra-chave, tag…) que move o card para uma etapa deste
  // funil. Filtrar por `deal_stage_changed` aqui escondia a automação do
  // Calendly, e o operador foi procurá-la no funil e não achou. Quem decide
  // o que vira cartão é `montarGrade`; o raio do Kanban continua contando só
  // o que dispara na etapa (`contarAtivasNaEtapa` ignora os outros gatilhos).
  const buscarAutomacoes = useCallback(async (): Promise<Automation[] | null> => {
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load stage automations:", error.message);
      return null;
    }
    return (data ?? []) as Automation[];
  }, [supabase]);

  // A carga de sempre vira a lista vazia do fail-open acima; só a volta ao
  // app usa o `null` de `buscarAutomacoes`, para não apagar a grade numa
  // falha passageira (Codex, PR #216, 4ª rodada).
  const loadAutomations = useCallback(
    async (): Promise<Automation[]> => (await buscarAutomacoes()) ?? [],
    [buscarAutomacoes],
  );

  /**
   * Passos + os nomes que os cartões exibem.
   *
   * ⚠️ Só o PRIMEIRO passo aparece no cartão, mas a consulta traz todos —
   * é a contagem ("+2 ações") que precisa do resto, e limitar a 1 por
   * automação exigiria uma consulta por linha.
   *
   * Falha em silêncio, como o resto desta página: sem os passos o cartão
   * mostra "sem ações", que é menos ruim que um quadro que não abre. O
   * `falhou` diz se alguma das quatro consultas caiu: a carga de sempre o
   * ignora; a volta ao app não grava por cima do que já está na tela.
   */
  const loadPassosENomes = useCallback(
    async (lista: Automation[]) => {
      const ids = lista.map((a) => a.id);
      const [passosRes, tagsRes, etapasRes, fluxosRes] = await Promise.all([
        ids.length
          ? supabase
              .from("automation_steps")
              .select("*")
              .in("automation_id", ids)
              .order("position")
          : Promise.resolve({ data: [], error: null }),
        supabase.from("tags").select("id, name"),
        supabase.from("pipeline_stages").select("id, name"),
        supabase.from("flows").select("id, name"),
      ]);

      const porAutomacao: Record<string, AutomationStep[]> = {};
      for (const p of (passosRes.data ?? []) as AutomationStep[]) {
        (porAutomacao[p.automation_id] ??= []).push(p);
      }

      const mapear = (linhas: { id: string; name: string }[] | null) =>
        Object.fromEntries((linhas ?? []).map((r) => [r.id, r.name]));

      return {
        falhou: Boolean(
          passosRes.error || tagsRes.error || etapasRes.error || fluxosRes.error,
        ),
        passos: porAutomacao,
        nomes: {
          tags: mapear(tagsRes.data as { id: string; name: string }[] | null),
          etapas: mapear(etapasRes.data as { id: string; name: string }[] | null),
          fluxos: mapear(fluxosRes.data as { id: string; name: string }[] | null),
          automacoes: Object.fromEntries(lista.map((a) => [a.id, a.name])),
        },
      };
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Sales Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      // ⚠️ Recorte por perfil (Fase 4) DEPOIS da decisão de seed, sobre a
      // lista CRUA: com o filtro antes, um perfil cujo escopo não alcança
      // funil nenhum leria "conta sem funis" e SEMEARIA um funil novo na
      // conta, do navegador de um usuário restrito.
      const visiveis = funisVisiveis(acesso, list);
      setPipelines(visiveis);
      if (visiveis.length > 0) {
        // A volta do inbox prefere o funil de onde o operador saiu — desde
        // que o perfil o alcance (o retorno é conferido contra `visiveis`).
        // O registro tem prazo curto (ver retorno.ts) — vencido, cai no
        // primeiro da lista como sempre.
        // O funil pedido pela URL (a volta do construtor de automações) vem
        // antes: é o pedido mais novo, e não expira como o retorno.
        const doRetorno = lerRetorno()?.pipelineId;
        const daUrl = pedidoDaUrl.funil;
        setSelectedPipelineId((prev) => {
          if (prev && visiveis.some((p) => p.id === prev)) return prev;
          if (daUrl && visiveis.some((p) => p.id === daUrl)) return daUrl;
          if (doRetorno && visiveis.some((p) => p.id === doRetorno))
            return doRetorno;
          return visiveis[0].id;
        });
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, acesso, pedidoDaUrl]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEtapasDe("");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // A volta do inbox restaura as colunas expandidas: o conteúdo delas vem
      // já na carga (ver `buscarNegocios`).
      const retorno = lerRetorno();
      const limites =
        retorno?.pipelineId === selectedPipelineId ? retorno.limites : {};
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId, limites),
      ]);
      if (cancelled) return;
      setStages(s);
      setEtapasDe(selectedPipelineId);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  /**
   * Versão das mudanças LOCAIS da página. Toda ação que mexe por aqui nos
   * negócios, nas etapas, nos funis ou nas automações (arrastar, salvar,
   * apagar, editar) a avança — e a troca de funil também —, e a recarga da
   * volta ao app só grava se a versão ainda for a de quando partiu. Sem isso,
   * uma recarga que saiu ANTES de um arrasto voltava DEPOIS dele e devolvia o
   * card à etapa antiga, e nada recarregaria de novo (Codex, PR #216).
   */
  const versaoDoQuadroRef = useRef(0);

  const refreshAutomations = useCallback(async () => {
    versaoDoQuadroRef.current += 1;
    const lista = await loadAutomations();
    setAutomations(lista);
    const extra = await loadPassosENomes(lista);
    setSteps(extra.passos);
    setNomes(extra.nomes);
  }, [loadAutomations, loadPassosENomes]);

  // Uma vez por montagem: automação de funil não muda enquanto se arrasta
  // card. A grade recarrega sozinha depois de duplicar ou trocar as etapas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lista = await loadAutomations();
      if (cancelled) return;
      setAutomations(lista);
      const extra = await loadPassosENomes(lista);
      if (cancelled) return;
      setSteps(extra.passos);
      setNomes(extra.nomes);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAutomations, loadPassosENomes]);

  const refreshPipelines = useCallback(async () => {
    versaoDoQuadroRef.current += 1;
    const list = funisVisiveis(acesso, await loadPipelines());
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId, acesso]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    versaoDoQuadroRef.current += 1;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    versaoDoQuadroRef.current += 1;
    // Os tetos de AGORA: a coluna expandida continua com o conteúdo.
    const tetos = limitesDoQuadroRef.current;
    setDeals(
      await loadDeals(
        selectedPipelineId,
        tetos.funil === selectedPipelineId ? tetos.porEtapa : {},
      ),
    );
  }, [loadDeals, selectedPipelineId]);

  /**
   * O conteúdo dos cards que uma coluna desenha e ainda não tem ("mostrar
   * mais", o card que um arrasto expôs). `emVooRef` impede pedir de novo o
   * que já está a caminho: a coluna avisa a cada mudança do que desenha.
   * Uma falha fica no toast, e os cards seguem "carregando" até o próximo
   * aviso da coluna ou a próxima recarga.
   */
  const emVooRef = useRef(new Set<string>());
  const carregarConteudo = useCallback(
    (ids: string[]) => {
      const emVoo = emVooRef.current;
      const novos = ids.filter((id) => !emVoo.has(id));
      if (novos.length === 0) return;
      for (const id of novos) emVoo.add(id);
      void (async () => {
        const conteudo = await buscarConteudo(novos);
        for (const id of novos) emVoo.delete(id);
        if (!conteudo) {
          toast.error(t("toastFailedLoadDeals"));
          return;
        }
        setDeals((prev) => juntarConteudo(prev, novos, conteudo));
      })();
    },
    [buscarConteudo, t],
  );

  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora atualiza o quadro do funil aberto, a lista de
  // funis e as automações. ⚠️ As cercas (todas menos a primeira, das quatro
  // rodadas do Codex no PR #216):
  // - NUNCA a carga inicial: ela liga o `loading`, que desmonta o quadro e
  //   perde a rolagem e o retorno do inbox (ver retorno.ts);
  // - resposta de funil que já não está aberto, ou que partiu antes de uma
  //   mudança local ou de uma troca de funil, é DESCARTADA (`valeAinda`):
  //   desfaria o arrasto, o salvamento ou a troca;
  // - consulta que FALHOU não grava nada por cima: voltar ao app antes de a
  //   rede do celular voltar esvaziava o quadro, apagava a lista de funis ou
  //   trocava os nomes dos cartões por "(apagado)";
  // - as gravações vão JUNTAS, depois de uma única conferência: gravando a
  //   troca de funil antes, a própria troca avançaria a versão e descartaria
  //   as automações.
  const funilAbertoRef = useRef(selectedPipelineId);
  useEffect(() => {
    funilAbertoRef.current = selectedPipelineId;
    // Trocar de funil também é mudança: sem isto, A → B → A com a recarga no
    // ar passava pela cerca do funil (é A de novo e a versão não andava), e
    // a resposta velha gravava por cima da carga nova de A (Codex, PR #216,
    // 3ª rodada).
    versaoDoQuadroRef.current += 1;
  }, [selectedPipelineId]);
  useAoVoltarParaOApp(() => {
    const funil = selectedPipelineId;
    const versao = versaoDoQuadroRef.current;
    const valeAinda = () =>
      versaoDoQuadroRef.current === versao && funilAbertoRef.current === funil;
    const tetos = limitesDoQuadroRef.current;
    void (async () => {
      const [funis, etapas, negocios, automacoes] = await Promise.all([
        buscarFunis(),
        funil ? buscarEtapas(funil) : Promise.resolve(null),
        funil
          ? buscarNegocios(funil, tetos.funil === funil ? tetos.porEtapa : {})
          : Promise.resolve(null),
        buscarAutomacoes(),
      ]);
      const extra = automacoes ? await loadPassosENomes(automacoes) : null;
      if (!valeAinda()) return;

      // As automações (a grade e os indicadores do quadro) não têm realtime.
      if (automacoes && extra && !extra.falhou) {
        setAutomations(automacoes);
        setSteps(extra.passos);
        setNomes(extra.nomes);
      }

      // O catálogo: o funil criado ou renomeado lá fora aparece, e o apagado
      // (ou tirado do perfil) sai da seleção — a troca carrega o quadro do
      // primeiro que sobrou, e o quadro do funil que sumiu não é gravado.
      if (funis) {
        const visiveis = funisVisiveis(acesso, funis);
        setPipelines(visiveis);
        if (!visiveis.some((p) => p.id === funil)) {
          setSelectedPipelineId(visiveis[0]?.id ?? "");
          return;
        }
      }

      if (etapas && negocios) {
        setStages(etapas);
        setDeals(negocios);
      }
    })();
  });

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Mudança local: a recarga da volta ao app que estiver no ar já não
      // pode gravar por cima (ver `versaoDoQuadroRef`).
      versaoDoQuadroRef.current += 1;
      // Optimistic update — board already animated; just persist.
      // ⚠️ Espelho do gatilho da 950: entrar numa etapa marcada carimba
      // ganho/perdido NO BANCO (BEFORE trigger, mesma escrita). Sem refletir
      // aqui, arrastar para "Contrato Fechado" gravava won mas o selo do
      // card só aparecia no reload — achado da auditoria de 2026-08-29.
      setDeals((prev) =>
        prev.map((d) => {
          if (d.id !== dealId) return d;
          const carimbo = statusAoEntrarNaEtapa(stages, newStageId, d.status);
          return { ...d, stage_id: newStageId, ...(carimbo ? { status: carimbo } : {}) };
        }),
      );
      // `.select("id")` = checagem de ROWCOUNT. Update que casa 0 linhas
      // volta `error: null` com cara de sucesso — acontece quando a RLS
      // barra (o arrasto não é desabilitado para `viewer`, e `deals_update`
      // exige agent+) ou quando outro operador apagou o negócio entre a
      // carga e o gesto. Sem a checagem, o otimista acima (com o carimbo da
      // 950!) exibia um "Ganho" que o banco nunca gravou.
      const { data: linhas, error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId)
        .select("id, status");
      if (error || !linhas || linhas.length === 0) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
        return;
      }
      // O status que o BANCO gravou vence o espelho acima: o quadro não tem
      // realtime, e o `d.status` desta tela pode ser de antes de outro
      // operador fechar ou reabrir o card — o gatilho decide pelo que está
      // gravado, não pelo que a tela lembra (Codex, PR #245).
      const gravado = linhas[0].status as Deal["status"];
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId && d.stage_id === newStageId ? { ...d, status: gravado } : d,
        ),
      );
      // O trigger da 933 já enfileirou o evento. Este aviso só antecipa a
      // drenagem: sem ele a automação da etapa sairia no ciclo de 15 min do
      // agendador, e "arrastou → mandou a mensagem" viraria "arrastou →
      // mandou a mensagem daqui a um quarto de hora".
      avisarDrenagemDeFunil();
    },
    [supabase, stages, refreshDeals, t],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  // A lista (Fase 1 do funil comercial) trabalha sobre as trajetórias da
  // RPC, não sobre `deals` — o negócio inteiro é buscado na hora de editar.
  const handleEditDealPorId = useCallback(
    async (dealId: string) => {
      const { data, error } = await supabase
        .from("deals")
        .select(DEAL_SELECT_BASICO)
        .eq("id", dealId)
        .maybeSingle();
      if (error || !data) {
        toast.error(t("toastFailedLoadDeals"));
        return;
      }
      handleEditDeal(data as Deal);
    },
    [supabase, t, handleEditDeal],
  );

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              {/* ⚠️ "Gerenciar funil" é de ADMIN, e some para os demais.
                  As policies de `pipelines`/`pipeline_stages` já exigiam
                  admin desde a 002/017 — a tela é que oferecia o painel a
                  qualquer um que enxergasse a página, e RLS que barra
                  escrita devolve 0 linhas SEM erro: o atendente renomeava
                  uma etapa, via a mudança na tela e a encontrava intacta no
                  reload (reportado pelo operador em 08/09/2026, simulando o
                  perfil "Bancário - Jurídico"). Esconder, e não desabilitar,
                  segue a regra da grade de automações logo abaixo. */}
              {selectedPipeline && canEditSettings && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => setSettingsOpen(true)}
                    className="text-popover-foreground"
                  >
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    {t("managePipelines")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {/* O que os cards exibem — só na vista de leads, onde há card. */}
          {vista === "leads" && pipelines.length > 0 && (
            <CamposDoCardPopover campos={campos} onChange={trocarCampos} />
          )}
          {/* Leads | Automações — as duas leituras do mesmo funil. */}
          {/* Com uma aba só não há o que alternar — a barra viraria um
              botão aceso permanente, como o seletor de canal com uma
              conexão. */}
          {vistasPermitidas(poderesDoFunil).length > 1 && (
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {/* A grade de automações segue a regra da Fase 2: automação é
                assunto de admin. Para os demais o toggle nem aparece — um
                botão que abre uma grade somente-leitura de regras que a
                pessoa não pode tocar seria convite a reportar "não consigo
                editar" como defeito. Lista, Desempenho e Saúde seguem a
                mesma regra desde 08/09/2026, por decisão do operador. */}
            {vistasPermitidas(poderesDoFunil).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={
                  vista === v
                    ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {tAuto(
                  v === "leads"
                    ? "abaLeads"
                    : v === "lista"
                      ? "abaLista"
                      : v === "desempenho"
                        ? "abaDesempenho"
                        : v === "saude"
                          ? "abaSaude"
                          : "abaAutomacoes",
                )}
              </button>
            ))}
          </div>
          )}
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : vista === "lista" && selectedPipeline ? (
        <ListaDeLeads
          // ⚠️ `key` por funil: sem ela o React reusa a instância e os
          // FILTROS do funil anterior sobrevivem — o operador vê "0 de 37"
          // sobre um funil cheio, com o seletor de etapa em branco porque o
          // id filtrado não existe aqui (Codex, PR #123).
          key={selectedPipeline.id}
          pipeline={selectedPipeline}
          stages={stages}
          etapasCarregadas={etapasDe === selectedPipeline.id}
          onEditDeal={handleEditDealPorId}
          onDealChanged={refreshDeals}
        />
      ) : vista === "desempenho" && selectedPipeline ? (
        <Desempenho
          pipeline={selectedPipeline}
          stages={stages}
          etapasCarregadas={etapasDe === selectedPipeline.id}
          onConfigurar={() => setSettingsOpen(true)}
        />
      ) : vista === "saude" && selectedPipeline ? (
        <Saude
          pipeline={selectedPipeline}
          stages={stages}
          etapasCarregadas={etapasDe === selectedPipeline.id}
          onConfigurar={() => setSettingsOpen(true)}
        />
      ) : vista === "automacoes" && podeAutomacoes ? (
        <AutomationsBoard
          pipelineId={selectedPipelineId}
          stages={stages}
          automations={automations}
          steps={steps}
          nomes={nomes}
          onChanged={refreshAutomations}
        />
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <PipelineBoard
            stages={stages}
            deals={deals}
            onFaltaConteudo={carregarConteudo}
            automations={automations}
            pipelineId={selectedPipelineId}
            campos={campos}
            quadroRef={quadroRef}
            limitesRef={limitesDoQuadroRef}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            // O raio da coluna agora LEVA para a grade em vez de abrir uma
            // caixa: duas telas dizendo a mesma coisa divergem na primeira
            // mudança, e a grade mostra tudo que a caixa mostrava mais o
            // resto do funil.
            onOpenAutomations={() => setVista("automacoes")}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
        // O link "ver conversa" do formulário é a 3ª porta funil→inbox
        // (alcançável pelo lápis do card): entra na mesma jornada — faixa
        // de voltar e retorno de rolagem — que as portas do board.
        origemFunil
        aoIrParaConversa={salvarRetornoDoQuadro}
      />
    </div>
  );
}
