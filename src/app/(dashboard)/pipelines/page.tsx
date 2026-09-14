"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Automation,
  AutomationStep,
  Pipeline,
  PipelineStage,
  Deal,
} from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
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
  normalizarDealDoQuadro,
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

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const tAuto = useTranslations("Pipelines.automacoes");
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
  const [deals, setDeals] = useState<DealDoQuadro[]>([]);
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
  const salvarRetornoDoQuadro = useCallback(() => {
    gravarRetorno({
      pipelineId: selectedPipelineId,
      scrollLeft: quadroRef.current?.scrollLeft ?? 0,
      scrollTop: quadroRef.current?.closest("main")?.scrollTop ?? 0,
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
  const [vistaEscolhida, setVista] = useState<VistaDoFunil>(VISTA_PADRAO);
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

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

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
   * Os negócios do quadro. `null` = as duas consultas falharam (o select do
   * quadro e o plano B) — mesmo motivo do `buscarEtapas`. Quem já usava
   * `loadDeals` continua recebendo `[]`, com o toast.
   */
  const buscarNegocios = useCallback(
    async (pipelineId: string): Promise<DealDoQuadro[] | null> => {
      // A MESMA consulta para os dois selects: qualquer mudança de escopo
      // (filtro, ordem) vale automaticamente no plano B — divergir os dois é
      // exatamente o tipo de bug que só aparece quando ninguém está olhando.
      const buscar = (select: string) =>
        supabase
          .from("deals")
          .select(select)
          .eq("pipeline_id", pipelineId)
          .order("created_at", { ascending: false });
      const mapear = (linhas: unknown) =>
        ((linhas ?? []) as RawDealDoQuadro[]).map(normalizarDealDoQuadro);

      if (!embedDoQuadroRecusado) {
        const { data, error } = await buscar(DEAL_SELECT_DO_QUADRO);
        if (!error) return mapear(data);
        // ⚠️ Um embed recusado pelo PostgREST não pode derrubar o Kanban: sem
        // este plano B o quadro abriria VAZIO, sem mensagem nenhuma. Loga (os
        // campos do erro do Supabase não são enumeráveis) e refaz com o
        // select antigo — o quadro fica de pé, sem conversa/etiquetas nos
        // cards (e negócio pré-910 volta a abrir o formulário no clique).
        console.error("Failed to load deals (select do quadro):", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        embedDoQuadroRecusado = true;
      }

      const { data: basico, error: erroBasico } = await buscar(DEAL_SELECT_BASICO);
      if (erroBasico) {
        // ⚠️ O plano B também pode falhar (rede, RLS) — descartar ESTE erro
        // reproduzia o defeito original: colunas "vazias" com cara de funil
        // sem negócio. Toast + `null`: o `loadDeals` o converte na lista
        // vazia explícita de sempre, e a recarga da volta ao app mantém o
        // quadro.
        console.error("Failed to load deals (select básico):", {
          message: erroBasico.message,
          details: erroBasico.details,
          hint: erroBasico.hint,
          code: erroBasico.code,
        });
        toast.error(t("toastFailedLoadDeals"));
        return null;
      }
      return mapear(basico);
    },
    [supabase, t],
  );

  const loadDeals = useCallback(
    async (pipelineId: string): Promise<DealDoQuadro[]> =>
      (await buscarNegocios(pipelineId)) ?? [],
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
  const loadAutomations = useCallback(async () => {
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load stage automations:", error.message);
      return [];
    }
    return (data ?? []) as Automation[];
  }, [supabase]);

  /**
   * Passos + os nomes que os cartões exibem.
   *
   * ⚠️ Só o PRIMEIRO passo aparece no cartão, mas a consulta traz todos —
   * é a contagem ("+2 ações") que precisa do resto, e limitar a 1 por
   * automação exigiria uma consulta por linha.
   *
   * Falha em silêncio, como o resto desta página: sem os passos o cartão
   * mostra "sem ações", que é menos ruim que um quadro que não abre.
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
        const doRetorno = lerRetorno()?.pipelineId;
        setSelectedPipelineId((prev) => {
          if (prev && visiveis.some((p) => p.id === prev)) return prev;
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
  }, [loadPipelines, seedDefaultPipeline, acesso]);

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
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
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

  const refreshAutomations = useCallback(async () => {
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
    const list = funisVisiveis(acesso, await loadPipelines());
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId, acesso]);

  /**
   * Versão das mudanças LOCAIS do quadro. Toda ação que mexe nos negócios ou
   * nas etapas por aqui (arrastar, salvar, apagar, editar as etapas) a
   * avança, e a recarga da volta ao app só grava se a versão ainda for a de
   * quando partiu. Sem isso, uma recarga que saiu ANTES de um arrasto voltava
   * DEPOIS dele e devolvia o card à etapa antiga — e nada recarregaria de novo
   * (Codex, PR #216, 2ª rodada).
   */
  const versaoDoQuadroRef = useRef(0);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    versaoDoQuadroRef.current += 1;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    versaoDoQuadroRef.current += 1;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora atualiza as etapas e os negócios do funil aberto.
  // ⚠️ Quatro cercas (as três últimas, do Codex no PR #216):
  // - NUNCA a carga inicial: ela liga o `loading`, que desmonta o quadro e
  //   perde a rolagem e o retorno do inbox (ver retorno.ts);
  // - resposta de funil que já não está aberto é DESCARTADA: trocar de funil
  //   com a recarga no ar deixaria o quadro de B com as etapas e os negócios
  //   de A;
  // - resposta que saiu antes de uma mudança LOCAL também é descartada
  //   (`versaoDoQuadroRef`): ela desfaria o arrasto ou o salvamento;
  // - consulta que FALHOU mantém o quadro: voltar ao app antes de a rede do
  //   celular voltar esvaziava o funil. Só grava com as DUAS consultas certas.
  const funilAbertoRef = useRef(selectedPipelineId);
  useEffect(() => {
    funilAbertoRef.current = selectedPipelineId;
  }, [selectedPipelineId]);
  useAoVoltarParaOApp(() => {
    const funil = selectedPipelineId;
    if (!funil) return;
    const versao = versaoDoQuadroRef.current;
    void (async () => {
      const [etapas, negocios] = await Promise.all([
        buscarEtapas(funil),
        buscarNegocios(funil),
      ]);
      if (funilAbertoRef.current !== funil) return;
      if (versaoDoQuadroRef.current !== versao) return;
      if (!etapas || !negocios) return;
      setStages(etapas);
      setDeals(negocios);
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
      const carimbo = statusAoEntrarNaEtapa(stages, newStageId);
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId
            ? { ...d, stage_id: newStageId, ...(carimbo ? { status: carimbo } : {}) }
            : d,
        ),
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
        .select("id");
      if (error || !linhas || linhas.length === 0) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
        return;
      }
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
            automations={automations}
            pipelineId={selectedPipelineId}
            campos={campos}
            quadroRef={quadroRef}
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
