"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
  type RawConversation,
} from "@/lib/inbox/conversations";
import { buscarPaginado } from "@/lib/supabase/paginar";
import {
  aplicarFiltros,
  canalDaConversa,
  casaComASituacao,
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  mapaDeEtapasPorContato,
  recorteTemDoisNiveis,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import {
  coresPorCanal,
  corDoCanal,
  type CorDeCanal,
} from "@/lib/cb-channels/cores";
import {
  TERMO_MINIMO,
  termoBuscavel,
  type AchadoNoTexto,
} from "@/lib/inbox/busca-em-mensagens";
import { InboxFilters } from "@/components/inbox/inbox-filters";
import { VisoesSalvas } from "@/components/inbox/visoes-salvas";
import { useFiltrosSalvos } from "@/hooks/use-filtros-salvos";
import {
  limparOrfaos,
  type CatalogosDoFiltro,
} from "@/lib/inbox/filtros-salvos";
import { tituloDaConversa } from "@/lib/cb-groups/display";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  ConversationStatus,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";
import {
  AlarmClock,
  CircleDollarSign,
  Hourglass,
  Zap,
  Search,
  Users,
  Star,
  MessageSquareText,
  MessageSquarePlus,
} from "lucide-react";
import { atrasoDeResposta } from "@/lib/inbox/atraso";
import { restanteParaExibir, type CanalDeSaida } from "@/lib/inbox/janela-24h";
import { seloDaJanela, type CorDaJanela } from "@/lib/inbox/selo-da-janela";
import { formatDistanceToNow } from "date-fns";
import { LOCALE_DAS_DATAS } from "@/lib/idioma-das-datas";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { NovaConversaDialog } from "@/components/inbox/nova-conversa-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBuscaEmMensagens } from "@/hooks/use-busca-em-mensagens";
import { useSinalDeExecucoes } from "@/hooks/use-sinal-de-execucoes";
import { dividasPorContato, idsInadimplentes, leituraAindaFresca, motivoDaNeutralizacao, type RespostaDoResumo } from "@/lib/asaas/aviso-na-conversa";
import { dinheiro, type ResumoDeDivida } from "@/lib/asaas/inadimplencia";
import { useChannels } from "@/hooks/use-channels";
import { useAuth } from "@/hooks/use-auth";
import { canaisVisiveis, conversaNoEscopo } from "@/lib/perfis/escopo";
import { canSendMessages, isAccountRole } from "@/lib/auth/roles";
import { useFavoritas } from "@/hooks/use-favoritas";
import { ehInstagram } from "@/lib/cb-channels/transporte";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /**
   * O termo da busca, já assentado (ver `termoAplicado` em
   * `useBuscaEmMensagens`), para quem estiver fora desta lista.
   *
   * ⚠️ Existe porque a caixa de busca mora AQUI e o fio da conversa é irmão,
   * não filho: sem este aviso ao pai, o fio não tem como saber que existe uma
   * busca em curso — e é ele quem precisa rolar até a mensagem e destacá-la.
   * O estado continua sendo desta lista; o pai só ESPELHA, para repassar.
   * Subir o `useState` da caixa para a página faria o fio inteiro
   * re-renderizar a cada tecla digitada.
   */
  onTermoDeBusca?: (termo: string) => void;
  /**
   * Abriu uma conversa pelo botão "nova conversa". O pai é quem sabe
   * recarregar a lista e navegar até ela (`?c=`), então o botão mora aqui só
   * visualmente — sem o callback ele nem aparece.
   */
  onConversaAberta?: (conversationId: string) => void;
  /**
   * Etapa de funil vinda da URL (`?etapa=`, botão da coluna do quadro).
   * Semeia o filtro UMA vez, no estado inicial — a lista não remonta quando
   * a URL muda (App Router preserva o state em navegação na mesma rota),
   * então o seed não reaplica por cima de um filtro que o operador limpou.
   * O recorte em si espera os dados (`recorteDeEtapaConfiavel` no ctx).
   */
  etapaInicial?: string | null;
  /**
   * `de === "funil"` na URL — a jornada quadro→inbox está viva. ⚠️ Quando ela
   * MORRE (clique em "Caixa de entrada" na sidebar, numa notificação: a URL
   * limpa, a faixa "Voltar ao funil" some), o filtro SEMEADO morre junto —
   * sem isso, a página não remonta e a lista continuava recortada por uma
   * etapa que nada na tela explicava. Só o seed é limpo: etapa escolhida à
   * mão no painel não é tocada.
   */
  jornadaDoFunil?: boolean;
  /**
   * Quem está INADIMPLENTE no Asaas (Fase 1b do plano da integração) — a
   * resposta em lote da página (`useInadimplencia`), compartilhada com o
   * fio. `null` = ainda não sei / desconectado: o ícone cala e o filtro é
   * neutralizado (`ContextoDosFiltros.inadimplentes`).
   */
  inadimplencia?: RespostaDoResumo | null;
}

// Situação da conversa na LINHA (pedido do operador, 2026-09-03 — "hoje a
// gente só tem um círculo pequeno colorido"): pastilha ESCRITA só para
// pendente e encerrada. "Aberta" é o normal da caixa (98% das linhas) e não
// leva marca nenhuma: escrevê-la em todas viraria o rótulo que o olho
// aprende a ignorar — a lição do rótulo de canal. Houve um ANEL colorido no
// avatar (violeta/âmbar/cinza) por algumas horas; o operador o tirou no
// mesmo dia ("está atrapalhando") — a foto do contato (973) e o anel
// disputavam o mesmo círculo. A paleta é a do cabeçalho do fio.
const STATUS_PILL: Record<Exclude<ConversationStatus, "open">, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  closed: "bg-muted text-muted-foreground",
};



export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  onTermoDeBusca,
  onConversaAberta,
  etapaInicial = null,
  jornadaDoFunil = false,
  inadimplencia = null,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);

  // ⚠️ A busca fica SEPARADA dos filtros, e de propósito. Ela responde "onde
  // está aquela conversa" (nome, telefone, nome do grupo, texto da última
  // mensagem); os filtros respondem "quais conversas se parecem com isto".
  // Trocar uma pela outra apagaria a busca por texto de mensagem e por nome
  // de grupo, que é o que a revisão prévia desta fase encontrou.
  const [search, setSearch] = useState("");
  /**
   * "Buscar também dentro das mensagens" — DESLIGADO por padrão (decisão do
   * operador, 09/09/2026). Ligado, a caixa passa a perguntar ao banco pelo
   * histórico inteiro (RPC 929) e o fio destaca o que casou; desligado, a
   * busca olha só nome, número, grupo e última mensagem. Sempre ligada, a
   * busca por um nome trazia junto toda conversa em que o nome foi CITADO.
   * Estado de sessão, sem persistência: "por padrão" quer dizer a cada
   * abertura da caixa.
   */
  const [buscarNasMensagens, setBuscarNasMensagens] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosDoInbox>(() =>
    etapaInicial ? { ...FILTROS_VAZIOS, etapaId: etapaInicial } : FILTROS_VAZIOS,
  );
  const [loading, setLoading] = useState(true);
  // Relógio do alerta de atraso (972). A linha não muda no banco quando os 10
  // minutos vencem — quem muda é o tempo —, então a lista re-renderiza a cada
  // minuto, o mesmo tique do Radar. Um estado só, passado às linhas: um
  // intervalo por linha seriam duzentos relógios para a mesma hora.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [etapas, setEtapas] = useState<PipelineStage[]>([]);
  // Nome do funil de cada etapa — só é usado quando há mais de um funil, e aí
  // vira load-bearing: dois funis costumam ter "Lead" e "Qualificado" com o
  // mesmo nome, e o seletor mostraria dois itens idênticos ordenados por
  // posição, sem o operador poder distingui-los.
  const [funis, setFunis] = useState<Map<string, string>>(new Map());
  // ⚠️ Sem isto o filtro de etapa RESPONDE ERRADO em vez de sumir. O gate dele
  // olha `pipeline_stages`, que é OUTRA consulta: se `deals` falhar sozinha, o
  // seletor aparece completo, escolher qualquer etapa devolve zero e escolher
  // "Sem negócio" devolve as 64 — a resposta exatamente invertida, sem erro na
  // tela.
  // O estado do PAR de consultas que sustenta o filtro de etapa
  // (`pipeline_stages` + `deals`): "carregando" segura o spinner do deep
  // link `?etapa=`, "ok" libera o recorte, "indisponivel" liga o aviso
  // inline. Um enum, e não dois booleans, para o estado impossível
  // (resolvido-mas-não-resolvido) não existir.
  const [etapasStatus, setEtapasStatus] = useState<
    "carregando" | "ok" | "indisponivel"
  >("carregando");
  const [temPerfis, setTemPerfis] = useState(false);
  // Os CATÁLOGOS do painel (etiquetas, perfis, etapas, funis) já chegaram —
  // é o que a semente do filtro padrão espera para limpar id morto. Separado
  // de `etapasStatus` DE PROPÓSITO: aquele depende também de TODOS os
  // negócios da conta (5.224 em 21/09/2026, seis páginas), e a semente
  // esperava por eles mesmo quando o padrão nem recorta por etapa — a caixa
  // de entrada ficava no spinner até o último negócio chegar. Só vai de
  // `false` a `true`, como `etapasStatus` só sai de "carregando".
  const [catalogosProntos, setCatalogosProntos] = useState(false);
  // `contact_id` → etapas dos negócios dele. Busca separada porque `deals` NÃO
  // vem no CONVERSATION_SELECT — e não pode vir: aquele select é compartilhado
  // com a API pública v1, e embutir negócio ali mudaria o contrato público.
  // ⚠️ Esta segunda busca MORRE na fatia B, quando tudo virar uma consulta só.
  const [etapaPorContato, setEtapaPorContato] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  // Conta sem canais (ou deploy pré-901): a lista fica vazia e o seletor
  // simplesmente não aparece.
  const {
    channels,
    loading: canaisCarregando,
    falhou: canaisFalharam,
    recarregar: recarregarCanais,
  } = useChannels();
  // Quais clientes têm automação AGENDADA (985) — UMA consulta para a lista
  // inteira, não uma por linha. `null` = ainda não sei, e a marca cala: sem a
  // distinção, "não carregou" viraria a afirmação "não tem robô rodando".
  const { resumo: sinalDeExecucoes } = useSinalDeExecucoes(true, resyncToken);
  // A dívida por contato (Asaas, Fase 1b): ícone da linha e conjunto do
  // filtro saem da MESMA régua. Recalcula com o tique do minuto para os
  // dias de atraso virarem à meia-noite sem recarregar.
  const dividasDoAsaas = useMemo(
    () => (inadimplencia ? dividasPorContato(inadimplencia, new Date(agora)) : null),
    [inadimplencia, agora],
  );
  const idsInadimplentesDoAsaas = useMemo(
    () => idsInadimplentes(inadimplencia, new Date(agora)),
    [inadimplencia, agora],
  );
  // Favoritas são de CADA MEMBRO (migration 924) — o hook já lê só as minhas.
  // `resyncToken` porque `cb_conversation_favorites` não está no realtime:
  // marcar no celular não apareceria nesta aba até recarregar a página.
  const {
    favoritas,
    pronto: favoritasProntas,
    falhouAoCarregar: falhouFavoritas,
    alternar: alternarFavorita,
  } = useFavoritas(resyncToken);

  // Filtros salvos da conta (967). Leitura direta sob RLS; escrita só admin,
  // conferida por rowcount dentro do hook.
  const {
    salvos: filtrosSalvos,
    padraoId: filtroPadraoId,
    carregando: salvosCarregando,
    falhou: salvosFalhou,
    criar: criarFiltroSalvo,
    regravar: regravarFiltroSalvo,
    renomear: renomearFiltroSalvo,
    apagar: apagarFiltroSalvo,
    definirPadrao: definirFiltroPadrao,
  } = useFiltrosSalvos();

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // ⚠️⚠️ PAGINADA desde 19/09/2026. Era uma consulta só, sem `range` e
      // sem `count`, e o PostgREST corta em ~1000 linhas SEM AVISAR: passando
      // de mil conversas, a caixa de entrada esconderia o excedente em
      // silêncio, a busca (que atravessa as abas) deixaria de achar cliente
      // que existe, e o contador "Exibindo N de M" mentiria. A consulta de
      // `deals` logo abaixo já paginava por esta razão; esta, não. Hoje são
      // ~970 conversas, crescendo ~30 por semana.
      const resultado = await buscarPaginado<RawConversation>(
        async (de, ate) => {
          const { data, error, count } = await supabase
            .from("conversations")
            .select(CONVERSATION_SELECT, { count: "exact" })
            // ⚠️ `nullsFirst: false` é load-bearing desde os grupos (906). Em
            // ordem DECRESCENTE o Postgres põe NULL PRIMEIRO por padrão, e um
            // grupo sincronizado em que ninguém falou ainda tem
            // `last_message_at` nulo. Sem isto, ligar o interruptor num número
            // com 58 grupos empurra as conversas ativas para baixo de 58 linhas
            // vazias — o inbox vira inútil no exato instante em que o operador
            // liga o recurso.
            .order("last_message_at", { ascending: false, nullsFirst: false })
            // ⚠️ E o desempate por `id`: as conversas SEM mensagem empatam
            // todas em NULL, que é exatamente onde a página quebra.
            .order("id", { ascending: true })
            .range(de, ate);
          return { data: (data ?? null) as RawConversation[] | null, error, count };
        },
      );

      if (cancelled) return;

      if (!resultado.linhas) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          motivo: resultado.motivo,
          message: resultado.erro?.message,
          details: resultado.erro?.details,
          hint: resultado.erro?.hint,
          code: resultado.erro?.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(resultado.linhas));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // As buscas abaixo alimentam SÓ o painel de filtros. Rodam sob RLS, então já
  // vêm escopadas à conta.
  //
  // ⚠️ NENHUMA delas pode falhar "em silêncio" de verdade. Um filtro que
  // aparece sem os dados por trás não some: ele RESPONDE ERRADO, com cara de
  // resposta certa. Por isso cada uma tem um sinalizador próprio, e o painel
  // esconde o campo cujo dado não chegou — some é honesto, mentir não é.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // TODOS os negócios da conta, PAGINANDO além do teto de ~1000 linhas do
    // PostgREST. Antes a consulta era única e o `count: 'exact'` só DETECTAVA
    // a truncagem — passar de 1000 negócios derrubava o filtro de etapa para
    // sempre (achado da revisão do PR #71); agora o count fecha o laço.
    // `linhas: null` = não dá para confiar (erro, ou dado mudando no meio).
    // O laço saiu daqui para `src/lib/supabase/paginar.ts` em 19/09/2026, ao
    // consertar o quadro do funil e a lista de conversas, que não paginavam.
    const buscarDeals = () =>
      buscarPaginado<{ contact_id: string | null; stage_id: string | null }>(
        async (de, ate) => {
          const { data, error, count } = await supabase
            .from("deals")
            .select("contact_id, stage_id", { count: "exact" })
            // ⚠️ `range` sem `order` é LIMIT/OFFSET sobre ordem INDEFINIDA
            // (#25): um card arrastado entre duas páginas muda de posição no
            // seq scan e a página seguinte repete/omite linhas — o contato
            // omitido some de "Funil: X" e passa a casar "Sem negócio", sem
            // erro em lugar nenhum. `id` é PK: estável e barato.
            .order("id", { ascending: true })
            .range(de, ate);
          return {
            data: (data ?? null) as
              | { contact_id: string | null; stage_id: string | null }[]
              | null,
            error,
            count,
          };
        },
      );

    // As duas cargas saem JUNTAS, mas são ASSENTADAS em dois tempos: os
    // catálogos (quatro consultas pequenas) liberam a semente do filtro
    // padrão; os negócios (a consulta grande) liberam só o recorte por etapa.
    const catalogos = Promise.all([
      supabase.from("tags").select("*").order("name"),
      supabase.from("profiles").select("*").order("full_name"),
      supabase
        .from("pipeline_stages")
        .select("*")
        .order("position", { ascending: true }),
      supabase.from("pipelines").select("id, name"),
    ]);
    const negocios = buscarDeals();

    (async () => {
      const [tagsRes, profilesRes, etapasRes, funisRes] = await catalogos;
      if (cancelled) return;

      if (tagsRes.data) setTags(tagsRes.data as Tag[]);

      setTemPerfis(!profilesRes.error && (profilesRes.data?.length ?? 0) > 0);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);

      if (etapasRes.data) setEtapas(etapasRes.data as PipelineStage[]);
      if (funisRes.data) {
        setFunis(
          new Map(
            (funisRes.data as { id: string; name: string }[]).map((p) => [
              p.id,
              p.name,
            ]),
          ),
        );
      }

      setCatalogosProntos(true);

      const { linhas } = await negocios;
      if (cancelled) return;
      setEtapasStatus(linhas && etapasRes.data ? "ok" : "indisponivel");
      if (linhas) setEtapaPorContato(mapaDeEtapasPorContato(linhas));
    })();
    return () => {
      cancelled = true;
    };
    // `resyncToken` porque negócio muda de etapa e etiqueta é criada em OUTRA
    // tela: `contacts`, `contact_tags` e `deals` não estão na publication do
    // realtime, então sem isto a aba aberta do inbox filtraria por um mundo
    // congelado no momento em que foi aberta.
  }, [resyncToken]);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  // O seletor de tipo só aparece quando existe grupo. Numa conta sem nenhum —
  // que é toda conta até alguém ligar o interruptor — ele não decide nada e
  // só ocupa espaço. Mesma convenção do filtro de canal, que some com menos
  // de 2 canais.
  const temGrupos = useMemo(
    () => conversations.some((c) => !!c.group_id),
    [conversations],
  );

  // A metade da busca que mora no banco: quais conversas têm alguma mensagem
  // com este texto, no histórico inteiro (RPC 929). A outra metade — nome,
  // telefone, grupo, última mensagem — continua sendo resolvida em JS.
  const {
    achados: achadosNoTexto,
    buscando: buscandoNoTexto,
    falhou: falhouBuscaNoTexto,
    termoAplicado,
  } = useBuscaEmMensagens(search, buscarNasMensagens);

  // Espelha o termo assentado para quem estiver fora da lista (o fio da
  // conversa, que precisa dele para destacar as mensagens que casaram).
  useEffect(() => {
    onTermoDeBusca?.(termoAplicado);
  }, [termoAplicado, onTermoDeBusca]);

  // `aplicarFiltros` só precisa saber QUAIS conversas casaram; o trecho é da
  // linha. Memoizado pela identidade do mapa, que só muda quando a resposta
  // muda.
  const idsAchadosNoTexto = useMemo(
    () => new Set(achadosNoTexto.keys()),
    [achadosNoTexto],
  );

  // Todo o recorte mora em `src/lib/inbox/filtros.ts`, testado lá — inclusive
  // a neutralização do filtro de etapa sem dados: `recorteDeEtapaConfiavel` é
  // campo OBRIGATÓRIO do ctx (como `achadasNoTexto`), então quem consumir
  // `aplicarFiltros` em outra tela é cobrado pelo compilador. Enquanto os
  // dados não chegam, o spinner de `aguardandoEtapas` segura a tela; se
  // chegarem inutilizáveis, o aviso inline abaixo da busca assume.
  // Recorte por perfil (Fase 3) como PREDICADO, não import dentro de
  // filtros.ts — escopo.ts importa canalDaConversa de lá, e o import na
  // direção contrária fecharia ciclo de módulos.
  const { acesso } = useAuth();
  // ⚠️ Memoizado porque `canaisVisiveis` FILTRA quando o perfil tem recorte,
  // e `.filter()` devolve array novo a cada render. Ele desce como prop para
  // o diálogo de nova conversa, cujo efeito de pré-seleção depende desta
  // lista — com identidade nova a cada render, o efeito reexecutaria sem
  // parar. (Sem recorte a função devolve a MESMA referência, então o
  // problema só apareceria numa conta com perfil configurado — o tipo de
  // coisa que passa no teste de hoje e quebra quando o primeiro perfil
  // nascer.)
  //
  // ⚠️ E o menu de FILTROS SALVOS olha esta mesma lista: separá-las faria o
  // menu esconder (ou oferecer) um filtro por um critério que o painel de
  // filtros não usa.
  const canaisDoPerfil = useMemo(
    () => canaisVisiveis(acesso, channels),
    [acesso, channels],
  );
  // Nova conversa é INICIAR conversa — e no Instagram só o cliente inicia
  // (a API não tem como escrever para quem nunca escreveu). O diálogo não
  // oferece a conexão do Instagram. Memoizado pelo mesmo motivo acima: o
  // efeito de pré-seleção do diálogo depende da identidade desta lista.
  const canaisParaAbrirConversa = useMemo(
    () => canaisDoPerfil.filter((c) => !ehInstagram(c)),
    [canaisDoPerfil],
  );
  // Cor por conexão, para a bolinha da linha. Memoizada porque o `Map` é
  // recriado a cada render e as linhas o consultam uma vez cada.
  const coresDosCanais = useMemo(() => coresPorCanal(channels), [channels]);
  // O número por onde cada linha RESPONDE, para o selo da janela de 24h — a
  // mesma resolução do fio (`activeChannel`): o canal da conversa, senão o
  // padrão da conta. As duas peças são memoizadas porque as linhas as
  // consultam uma vez cada; quem gateia por carga/falha é o `map` abaixo.
  const canaisPorId = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );
  const canalPadrao = useMemo(
    () => channels.find((c) => c.is_default) ?? null,
    [channels],
  );
  const foraDoPerfil = useCallback(
    (c: Conversation) => !conversaNoEscopo(acesso, c),
    [acesso],
  );


  /**
   * Os catálogos que dão NOME aos ids de um filtro salvo, e que dizem quais
   * ids ainda existem.
   *
   * ⚠️ São os mesmos que o painel recebe, de propósito: um menu que resolvesse
   * nomes por outra lista descreveria o recorte de um jeito e as pastilhas de
   * outro, lado a lado na mesma tela.
   */
  const catalogosDoFiltro: CatalogosDoFiltro = useMemo(
    () => ({
      canais: canaisDoPerfil,
      responsaveis: temPerfis ? profiles : [],
      etapas,
      funis,
      etiquetas: tags,
    }),
    [canaisDoPerfil, temPerfis, profiles, etapas, funis, tags],
  );

  /**
   * ⚠️ Aplicar um filtro salvo passa por `limparOrfaos` SEMPRE.
   *
   * Um recorte gravado em maio pode apontar para etapa removida, conexão
   * desconectada ou etiqueta apagada — e id morto não dá erro: ele devolve
   * ZERO conversas, com cara de resposta certa. A limpeza só descarta o que o
   * catálogo carregado prova estar morto (catálogo vazio não prova nada, ver o
   * módulo), então o pior caso é o filtro ainda recortar demais — nunca a tela
   * afirmar que não há conversa nenhuma.
   */
  /**
   * A BASE da visão: o chip clicado por último (ou o padrão semeado). É o
   * que permite oferecer "Salvar alterações em X" quando o operador parte
   * de um filtro salvo e mexe — sem ela, só existiria "salvar como novo".
   * Some ao clicar em "Todas" ou ao limpar; NÃO some ao mexer (é para isso
   * que serve). Ver `lib/inbox/visoes.ts`.
   */
  const [visaoBaseId, setVisaoBaseId] = useState<string | null>(null);
  /** Espelho de `filtros` para efeitos que não podem depender dele (a semente do padrão). */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    filtrosRef.current = filtros;
  }, [filtros]);
  const aplicarVisao = useCallback(
    (f: FiltrosDoInbox | null, baseId: string | null) => {
      setVisaoBaseId(baseId);
      // ⚠️ A ABA fica como está, nos dois caminhos. A visão salva não carrega
      // situação (`lerFiltroSalvo`), e "Todas" limpa só o recorte do painel:
      // a aba é onde o operador ESTÁ, não o que ele recorta. Até 03/09 o chip
      // substituía o recorte inteiro, e quem estava em Encerradas era jogado
      // de volta para Abertas (queixa do operador).
      setFiltros((prev) => ({ ...(f ?? FILTROS_VAZIOS), status: prev.status }));
    },
    [],
  );

  // `stage_id` → `pipeline_id`, para o primeiro nível do recorte (escolher só
  // o funil). Sai da MESMA consulta de `pipeline_stages` que alimenta o
  // seletor, então nunca discorda dele.
  const funilPorEtapa = useMemo(
    () => new Map(etapas.map((e) => [e.id, e.pipeline_id])),
    [etapas],
  );

  // ⚠️ Com o TERMO da busca, não com string vazia: na aba padrão a busca
  // atravessa para as encerradas (`casaComASituacao`), e contar só as
  // ativas daria "Exibindo 2 de 1" ao achar uma encerrada (Codex, PR #106).
  // O universo do contador é o mesmo que o do recorte.
  const totalDaAba = useMemo(
    () =>
      conversations.filter((c) => casaComASituacao(c, filtros.status, search))
        .length,
    [conversations, filtros.status, search],
  );

  const filtered = useMemo(
    () =>
      aplicarFiltros(conversations, filtros, {
        favoritas,
        etapaPorContato,
        funilPorEtapa,
        busca: search,
        achadasNoTexto: idsAchadosNoTexto,
        recorteDeEtapaConfiavel: etapasStatus === "ok",
        foraDoPerfil,
        // O mesmo tique de um minuto que acende o selo na linha — o recorte
        // "em atraso" tem de virar sozinho quando os 10 minutos vencem.
        agoraMs: agora,
        // `null` neutraliza o filtro "Inadimplentes" — ver `idsInadimplentes`.
        inadimplentes: idsInadimplentesDoAsaas,
      }),
    [
      conversations,
      filtros,
      etapasStatus,
      agora,
      favoritas,
      idsInadimplentesDoAsaas,
      etapaPorContato,
      funilPorEtapa,
      search,
      idsAchadosNoTexto,
      foraDoPerfil,
    ],
  );
  const aguardandoEtapas =
    (filtros.etapaId !== null || filtros.funilId !== null) &&
    etapasStatus === "carregando";

  /**
   * Ciclo de vida do filtro SEMEADO por `?etapa=` (e só dele — etapa
   * escolhida à mão no painel não passa por aqui):
   * · a jornada do funil acaba (URL limpa pela sidebar/notificação — a
   *   página NÃO remonta) → o seed morre junto com a faixa, senão a lista
   *   ficava recortada sem nada na tela explicando;
   * · os dados chegam e a etapa semeada NÃO existe (link velho, etapa
   *   apagada) → o seed é descartado, senão a lista abria "nenhuma
   *   conversa" sem aviso.
   */
  const seedDeEtapaRef = useRef(etapaInicial);
  const jornadaAnteriorRef = useRef(jornadaDoFunil);
  useEffect(() => {
    const seed = seedDeEtapaRef.current;
    const jornadaAcabou = jornadaAnteriorRef.current && !jornadaDoFunil;
    jornadaAnteriorRef.current = jornadaDoFunil;
    if (!seed) return;
    const daSemeada = etapas.find((e) => e.id === seed);
    const seedSumiu = etapasStatus === "ok" && !daSemeada;
    if (!jornadaAcabou && !seedSumiu) {
      // ⚠️ O funil da etapa semeada é preenchido AQUI, quando as etapas
      // chegam — a URL traz só a etapa. Sem isto o painel de dois níveis
      // abriria em "Qualquer funil" com uma etapa escolhida, que é um estado
      // que o seletor não sabe mostrar (o segundo nível nem apareceria).
      //
      // ⚠️ E SÓ onde esse seletor existe. Numa conta de um funil só — ou com
      // a consulta de `pipelines` falhando sozinha — o painel é a lista
      // chapada de sempre: carimbar `funilId` ali deixaria um recorte de
      // funil ativo sem campo nenhum que o mostrasse, e "Qualquer etapa"
      // (que significa "não filtro por etapa") passaria a esconder quem não
      // tem negócio. Achado do Codex no PR #73.
      if (daSemeada && recorteTemDoisNiveis(etapas, funis)) {
        setFiltros((prev) =>
          prev.etapaId === seed && prev.funilId === null
            ? { ...prev, funilId: daSemeada.pipeline_id }
            : prev,
        );
      }
      return;
    }
    seedDeEtapaRef.current = null;
    // Os DOIS níveis morrem juntos: o funil só está aqui porque a etapa o
    // trouxe, e deixá-lo de pé manteria a lista recortada pelo funil inteiro
    // sem nada na tela explicando.
    setFiltros((prev) =>
      prev.etapaId === seed ? { ...prev, etapaId: null, funilId: null } : prev,
    );
  }, [jornadaDoFunil, etapasStatus, etapas, funis]);

  /**
   * ⚠️ A SEMENTE DO FILTRO PADRÃO (968) — UMA VEZ, E SÓ UMA.
   *
   * O padrão chega de uma consulta, depois do primeiro render. Reaplicá-lo a
   * cada mudança faria o filtro que o operador acabou de limpar VOLTAR
   * sozinho — por isso `padraoSemeado` vira `true` na primeira decisão, dê no
   * que der (inclusive quando a decisão é "não há padrão").
   *
   * ⚠️ `?etapa=` do funil VENCE o padrão. Chegar pelo botão da coluna é gesto
   * explícito, com a faixa "Voltar ao funil" na tela explicando o recorte;
   * somar o padrão por cima mostraria MENOS conversas do que a coluna
   * prometeu, e a faixa passaria a mentir.
   *
   * ⚠️ Espera os catálogos de etapa antes de semear. `limparOrfaos` só
   * descarta o que o catálogo carregado prova estar morto — semear antes
   * deles aplicaria uma etapa apagada, e aí a caixa abriria VAZIA com cara de
   * "não há conversa nenhuma". Enquanto espera, a lista segura o mesmo
   * spinner do deep link (ver `esperandoPadrao`), em vez de pintar a lista
   * inteira e pular para 8 linhas um segundo depois.
   */
  const semeouPadraoRef = useRef(false);
  useEffect(() => {
    if (semeouPadraoRef.current) return;
    if (etapaInicial) {
      semeouPadraoRef.current = true;
      return;
    }
    if (salvosCarregando) return;
    const padrao = filtroPadraoId
      ? filtrosSalvos.find((f) => f.id === filtroPadraoId)
      : undefined;
    if (!padrao) {
      semeouPadraoRef.current = true;
      return;
    }
    // Espera os CATÁLOGOS (a limpeza de órfãos precisa deles), e não os
    // negócios: padrão que recorta por etapa ou funil segura o spinner por
    // conta própria depois de semeado (`aguardandoEtapas`), e o que não
    // recorta não tem por que esperar. Catálogo que falhou também passa —
    // esperar para sempre seria pior, e catálogo vazio não limpa nada.
    if (!catalogosProntos) return;
    semeouPadraoRef.current = true;
    // ⚠️ Só semeia sobre o recorte INTACTO. A consulta demora alguns
    // centésimos e o operador pode ter clicado em "Não lidas" nesse meio —
    // sobrescrever seria o padrão desfazendo uma escolha que a pessoa acabou
    // de fazer, sem nada na tela explicando.
    //
    // O `set-state-in-effect` está desligado aqui pelo mesmo motivo dos
    // outros pontos do projeto (contacts, pipelines, notifications): isto NÃO
    // é estado derivado de prop — é uma semente de uma vez só, vinda de uma
    // consulta, guardada por `semeouPadraoRef` e pelo teste de recorte
    // intacto acima. Não há como derivá-la no render sem reaplicá-la a cada
    // mudança, que é justamente o bug que a ref evita.
    // ⚠️ Lê o recorte pela REF, não pelo updater: um `setState` dentro de
    // outro updater é efeito colateral onde o React exige pureza. A ref
    // espelha `filtros` num efeito próprio (abaixo).
    if (contarFiltrosAtivos(filtrosRef.current) !== 0) return;
    // A base da visão é o padrão: mexer depois oferece "salvar alterações".
    // (Mesma justificativa do `setFiltros` logo abaixo: é semente única.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisaoBaseId(padrao.id);
    // A aba corrente fica: "recorte intacto" não diz nada sobre a aba (ela não
    // conta), e o operador pode ter ido a Encerradas enquanto a consulta voltava.
    setFiltros((prev) => ({
      ...limparOrfaos(padrao.filtros, catalogosDoFiltro),
      status: prev.status,
    }));
  }, [
    etapaInicial,
    salvosCarregando,
    filtroPadraoId,
    filtrosSalvos,
    catalogosProntos,
    catalogosDoFiltro,
  ]);

  /**
   * Segura a lista enquanto o padrão ainda pode entrar — ver acima.
   *
   * ⚠️ NÃO consulta o ref da semente, de propósito: ref não re-renderiza, e
   * ler um durante o render dá tela desatualizada. Não precisa — as duas
   * condições abaixo VIRAM FALSAS por conta própria assim que a semente pode
   * ter rodado (`salvosCarregando` cai quando a consulta volta, e
   * `catalogosProntos` só vai de falso a verdadeiro). O padrão que recorta
   * por etapa passa a segurar a lista por `aguardandoEtapas` no render da
   * semente. Sobra, como antes desta mudança, o render em que os catálogos
   * chegam e o efeito da semente ainda não rodou.
   */
  const esperandoPadrao =
    !etapaInicial &&
    (salvosCarregando || (filtroPadraoId !== null && !catalogosProntos));

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const handleToggleFavorita = useCallback(
    async (conversationId: string) => {
      const ok = await alternarFavorita(conversationId);
      // A estrela já voltou sozinha (o hook faz rollback); o aviso existe
      // porque um marcador que se apaga sem explicação parece bug da tela.
      if (!ok) toast.error(t("favoriteFailed"));
    },
    [alternarFavorita, t]
  );

  // ⚠️ Avisa UMA vez quando a leitura das favoritas falhou. Sem isto a tela
  // mostra todas as estrelas apagadas e "Favoritas" não acha nada — que, para
  // quem marcou vinte conversas ontem, lê como "o sistema perdeu as minhas".
  const jaAvisouFavoritas = useRef(false);
  useEffect(() => {
    if (falhouFavoritas && !jaAvisouFavoritas.current) {
      jaAvisouFavoritas.current = true;
      toast.error(t("favoritesLoadFailed"));
    }
  }, [falhouFavoritas, t]);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed on desktop where it shares the row with
    // the thread + contact sidebar: 320px no `lg` e 360px a partir do `xl`
    // (o operador pediu "um pouco mais" para a prévia, 03/09). ⚠️ Não alargar
    // no `lg`: a 1024px o menu (240) e o painel do contato (360) já deixam
    // só 104px para o fio — com 360 aqui sobrariam 64 (achado do Codex, PR
    // #108). A 1280px sobram 320px, que é onde os 40px cabem.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80 xl:w-[22.5rem]">
      {/* Busca + filtros */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          {/* `min-w-0` porque item de flex nasce com `min-width: auto` e o
              campo tem largura intrínseca — sem ele o botão é empurrado para
              fora da coluna de 320px. */}
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              // O placeholder diz o que a caixa olha AGORA: prometer
              // "mensagem" com o interruptor desligado faria o operador
              // concluir que a mensagem não existe.
              placeholder={
                buscarNasMensagens
                  ? t("searchPlaceholderInMessages")
                  : t("searchPlaceholder")
              }
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>

          {/* Abordar um cliente é falar com ele: mesmo papel que ENVIAR, não
              o de anotar. A rota confere de novo — isto só evita oferecer ao
              `viewer` um botão que responderia 403. */}
          {onConversaAberta && isAccountRole(acesso.papel) && canSendMessages(acesso.papel) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              title={t("novaConversa")}
              aria-label={t("novaConversa")}
              onClick={() => setNovaConversaAberta(true)}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          )}
        </div>

        {onConversaAberta && (
          <NovaConversaDialog
            open={novaConversaAberta}
            onOpenChange={setNovaConversaAberta}
            // As conexões DO PERFIL, como no filtro logo abaixo: oferecer
            // uma conexão fora do escopo faria o operador abrir a conversa
            // num número que ele não deveria usar.
            canais={canaisParaAbrirConversa}
            carregandoCanais={canaisCarregando}
            canaisFalharam={canaisFalharam}
            onRecarregarCanais={recarregarCanais}
            onAberta={onConversaAberta}
          />
        )}

        {/* O interruptor da metade da busca que mora no banco. Só aparece
            com texto na caixa: sem termo não há o que ligar, e a coluna de
            320px não tem linha sobrando para um controle inerte. */}
        {search.trim().length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
            <Checkbox
              checked={buscarNasMensagens}
              onCheckedChange={(checked) =>
                setBuscarNasMensagens(checked === true)
              }
              className="size-3.5"
            />
            {t("searchInsideMessages")}
          </label>
        )}
        {/* O que está acontecendo com a metade da busca que mora no banco.
            ⚠️ As três linhas existem porque, sem elas, os três estados são
            indistinguíveis de "não existe mensagem com esse texto" — e o
            operador conclui que a conversa que ele procura não existe.
            Todas atrás do interruptor: desligado, o banco não é consultado
            e não há o que explicar. */}
        {buscarNasMensagens &&
          search.trim().length > 0 &&
          !termoBuscavel(search) && (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            {t("searchMinChars", { n: TERMO_MINIMO })}
          </p>
        )}
        {falhouBuscaNoTexto && (
          <p className="px-0.5 text-[11px] text-destructive">
            {t("searchInMessagesFailed")}
          </p>
        )}
        {buscandoNoTexto && !falhouBuscaNoTexto && (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            {t("searchingInMessages")}
          </p>
        )}
        {/* Filtro de funil OU de etapa ativo com os dados por trás
            indisponíveis: o recorte foi neutralizado (ver
            `recorteDeEtapaConfiavel`) e isto é o que impede a lista completa
            de passar por "filtrada".
            ⚠️ Os DOIS níveis, não só a etapa: um recorte só de funil cai
            junto, e sem esta linha ele exibia a pastilha do funil sobre a
            lista inteira, sem nada explicando. */}
        {(filtros.etapaId !== null || filtros.funilId !== null) &&
          etapasStatus === "indisponivel" && (
          <p className="px-0.5 text-[11px] text-destructive">
            {t("stageFilterUnavailable")}
          </p>
        )}

        <InboxFilters
          filtros={filtros}
          onChange={setFiltros}
          // O seletor de canal só oferece as conexões DO PERFIL — oferecer
          // as outras seria um filtro que devolve sempre vazio, com cara de
          // "não há conversas". (As linhas de outra área que a BUSCA traz
          // continuam aparecendo; isto recorta só as OPÇÕES do filtro.)
          canais={canaisDoPerfil}
          etiquetas={tags}
          empresas={companies}
          responsaveis={temPerfis ? profiles : []}
          // A lista COMPLETA sempre: é ela que resolve o NOME da pastilha de
          // um filtro ativo (deep link chega antes dos dados; e etapas podem
          // estar íntegras com só a consulta de deals quebrada). Quem gateia
          // OFERECER o campo é `etapasConfiaveis`.
          etapas={etapas}
          etapasConfiaveis={etapasStatus === "ok"}
          funis={funis}
          temGrupos={temGrupos}
          // O interruptor "Inadimplentes" é oferecido com o Asaas conectado
          // (ou já ligado por uma visão salva, para dar como desligar), e a
          // dica de "sem efeito" sai da MESMA régua do recorte.
          asaasNeutralizado={motivoDaNeutralizacao(inadimplencia)}
          // Pelo RELÓGIO, não pelo `leituraFresca` da resposta: ela envelhece
          // na tela (recarga que falha retém a anterior) — ver
          // `leituraAindaFresca`.
          asaasDadosDe={
            inadimplencia?.conectado && !leituraAindaFresca(inadimplencia, new Date(agora))
              ? inadimplencia.atualizadoEm
              : null
          }

          visoes={
            <VisoesSalvas
              salvos={filtrosSalvos}
              padraoId={filtroPadraoId}
              carregando={salvosCarregando}
              falhou={salvosFalhou}
              filtrosAtuais={filtros}
              baseId={visaoBaseId}
              catalogos={catalogosDoFiltro}
              onAplicar={aplicarVisao}
              criar={criarFiltroSalvo}
              regravar={regravarFiltroSalvo}
              renomear={renomearFiltroSalvo}
              apagar={apagarFiltroSalvo}
              definirPadrao={definirFiltroPadrao}
            />
          }
          busca={search}
          onLimparBusca={() => setSearch("")}
          exibindo={filtered.length}
          // ⚠️ O total é o DA ABA, não da conta. Com as encerradas fora da
          // caixa por desenho, "Exibindo 90 de 228" ficaria aceso o dia
          // inteiro sem filtro nenhum — e o contador existe para explicar um
          // recorte que o operador FEZ, não a aba em que ele está.
          total={totalDaAba}
        />

      </div>


      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading || aguardandoEtapas || esperandoPadrao ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                favorita={favoritas.has(conv.id)}
                onToggleFavorita={handleToggleFavorita}
                favoritaHabilitada={favoritasProntas}
                achado={achadosNoTexto.get(conv.id)}
                agora={agora}
                esperasDeAutomacao={
                  sinalDeExecucoes?.porContato[conv.contact_id ?? ""]?.esperas ?? 0
                }
                divida={dividasDoAsaas?.get(conv.contact_id ?? "") ?? null}
                // Numa conta de um número só a bolinha não decide nada e só
                // ocupa espaço — mesma régua do seletor e do filtro de canal.
                // ⚠️ `canalDaConversa`, nunca `conversation.channel_id`: em
                // grupo aquela coluna é SEMPRE nula, e a linha ficaria sem
                // marca justamente onde há dois números envolvidos.
                corDoCanalDaLinha={
                  channels.length >= 2
                    ? corDoCanal(coresDosCanais, canalDaConversa(conv))
                    : null
                }
                // ⚠️ `null` enquanto os canais não chegaram ou a consulta
                // falhou: a lista vazia não pode virar a afirmação "é Meta"
                // — a armadilha do "Expirada" que piscava no cabeçalho do fio
                // (2026-08-31). Conta SEM canal também cai em `null`: o selo
                // depende de saber por qual número se responde.
                canalDeSaidaDaLinha={
                  canaisCarregando || canaisFalharam
                    ? null
                    : (canaisPorId.get(conv.channel_id ?? "") ?? canalPadrao)
                }
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  favorita: boolean;
  onToggleFavorita: (conversationId: string) => void;
  /** `false` enquanto a sessão/conta não resolveu — ver `useFavoritas`. */
  favoritaHabilitada: boolean;
  /**
   * Presente quando esta conversa entrou no resultado pelo CORPO das mensagens
   * (RPC 929). `undefined` no uso normal, sem busca.
   */
  achado?: AchadoNoTexto;
  /**
   * Cor da conexão desta conversa, ou `null` — conta de um número só, canal
   * apagado, ou lista de canais ainda carregando. Sem cor não se desenha
   * bolinha: uma cor de queda apontaria um número que ninguém sabe qual é.
   */
  corDoCanalDaLinha: CorDeCanal | null;
  /** O tique de um minuto da lista — a régua do alerta de atraso lê daqui. */
  agora: number;
  /**
   * Quantas automações estão AGENDADAS para o contato desta conversa (985).
   * `0` = nenhuma, ou ainda não se sabe — a marca cala nos dois casos, porque
   * ausência de marca não pode afirmar "não tem robô rodando".
   */
  esperasDeAutomacao: number;
  /**
   * A dívida do contato desta conversa no Asaas (Fase 1b), ou `null` — em
   * dia, ou ainda não se sabe: a marca cala nos dois casos, porque ausência
   * de marca não pode afirmar "em dia".
   */
  divida: ResumoDeDivida | null;
  /**
   * O número por onde esta linha RESPONDE (o canal da conversa, senão o
   * padrão da conta — a resolução do fio), para o selo da janela de 24h.
   * `null` = desconhecido (canais carregando, consulta falhou, conta sem
   * canal): sem selo.
   */
  canalDeSaidaDaLinha: CanalDeSaida | null;
  t: ReturnType<typeof useTranslations>;
}

/**
 * As cores da ampulheta, por tempo restante (decisão do operador,
 * 10/09/2026). ⚠️ Classes LITERAIS, nunca montadas: o Tailwind varre o fonte
 * e não executa código — a mesma regra da `PALETA_DE_CANAIS`. A padrão é o
 * violeta da marca do robô (`Zap`), da família do `bg-primary` desta conta;
 * âmbar e vermelho são os do selo de atraso, para as duas urgências lerem
 * igual na mesma linha.
 */
const COR_DA_AMPULHETA: Record<CorDaJanela, string> = {
  padrao: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  ambar: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  vermelha: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  favorita,
  onToggleFavorita,
  favoritaHabilitada,
  achado,
  corDoCanalDaLinha,
  agora,
  esperasDeAutomacao,
  divida,
  canalDeSaidaDaLinha,
  t,
}: ConversationItemProps) {
  // As chaves da situação escrita moram no namespace do fio (`statusPending`,
  // `statusClosed`) — é o mesmo texto do menu do cabeçalho, de propósito.
  const tThread = useTranslations("Inbox.messageThread");
  // O "22h restantes" da ampulheta é o MESMO texto da etiqueta do cabeçalho
  // do fio, de propósito — duas frases para o mesmo relógio divergiriam.
  const tTimer = useTranslations("Inbox.sessionTimer");
  const contact = conversation.contact;
  const ehGrupo = !!conversation.group_id;
  const displayName = tituloDaConversa(conversation, {
    semNome: t("groupNoName"),
    desconhecido: t("unknown"),
  });
  const initials = displayName.charAt(0).toUpperCase();
  // Foto do grupo quando houver; senão o ícone de grupo faz o trabalho de
  // dizer, à distância, que aquela linha não é um cliente.
  const avatarUrl = ehGrupo ? conversation.group?.picture_url : contact?.avatar_url;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const handleFavorita = useCallback(() => {
    onToggleFavorita(conversation.id);
  }, [onToggleFavorita, conversation.id]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        // Sem o locale o date-fns fala inglês ("3 minutes") na tela em pt-BR.
        locale: LOCALE_DAS_DATAS,
      })
    : "";

  // Cliente esperando resposta de gente há 10+ minutos (pedido do operador,
  // 2026-09-02). O fato vem do banco (`aguardando_desde`, gatilho da 972); a
  // régua é pura — ver `src/lib/inbox/atraso.ts` para o que conta como
  // resposta e por que broadcast/robô não contam.
  const atraso = atrasoDeResposta(conversation, agora);
  const rotuloDoAtraso = atraso
    ? t(
        atraso.unidade === "min"
          ? "waitMin"
          : atraso.unidade === "h"
            ? "waitHours"
            : "waitDays",
        { n: atraso.n },
      )
    : null;

  // O selo da janela de 24h da Meta (991): só a ampulheta, que expande no
  // hover com o que resta. A régua é pura (`src/lib/inbox/selo-da-janela.ts`)
  // e ESPELHA a do fio; o fato vem do banco (`janela_meta`, o mapa por número
  // da 993). Cor por tempo restante, decisão do operador (10/09/2026): padrão de
  // 24h a 12h, âmbar de 12h a 3h, vermelha abaixo de 3h. Fora das Encerradas;
  // só WhatsApp oficial.
  const selo = seloDaJanela(conversation, canalDeSaidaDaLinha, agora);
  const restanteDaJanela = selo ? restanteParaExibir(selo.restante) : null;
  const rotuloDaJanela = restanteDaJanela
    ? restanteDaJanela.unidade === "h"
      ? tTimer("xhRemaining", { hours: restanteDaJanela.valor })
      : tTimer("xmRemaining", { minutes: restanteDaJanela.valor })
    : null;

  return (
    // ⚠️ A estrela NÃO pode ficar dentro do botão da linha: `<button>` dentro
    // de `<button>` é HTML inválido, e o React nem sempre avisa — o navegador
    // desmonta a árvore sozinho e o clique passa a chegar no elemento errado.
    // Por isso ela é irmã do botão, sobreposta numa faixa que o `pr-9` abaixo
    // reserva para ela.
    <div className="relative">
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-start gap-3 py-3 pl-3 pr-10 text-left transition-colors hover:bg-muted/50",
          isActive && "border-l-2 border-primary bg-muted/70"
        )}
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : ehGrupo ? (
            <Users className="h-5 w-5 text-muted-foreground" />
          ) : (
            initials
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* Ícone junto do nome mesmo quando há foto: com foto de grupo o
                  avatar sozinho não distingue de uma foto de perfil. */}
              {ehGrupo && (
                <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {/* Por qual número esta conversa corre. É bolinha e não trilha
                  na borda porque a borda esquerda da linha já é da SELEÇÃO
                  (`border-l-2 border-primary` no botão) — duas coisas
                  disputando a mesma faixa de 2px, e o twMerge derrubaria uma
                  delas sem avisar. */}
              {corDoCanalDaLinha && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    corDoCanalDaLinha.ponto,
                  )}
                />
              )}
              <span className="truncate text-sm font-medium text-foreground">
                {displayName}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* O alerta de atraso, colado à hora: âmbar até 30 min e
                  VERMELHO depois (`critico`, decisão do operador em 03/09),
                  com o tempo que o cliente espera. Fica na linha de cima
                  porque a de baixo já carrega prévia, não lidas e situação,
                  e um quarto item ali truncaria a prévia em toda linha
                  alertada. */}
              {/* ⚠️ "Tem robô rodando neste cliente" (985). O pedido era
                  lembrar de DESATIVAR o follow-up quando o cliente volta a
                  falar — e é exatamente aí que esta marca aparece, ao lado do
                  selo de atraso. Só o ícone, sem número: a 320px a faixa da
                  direita já leva selo e hora, e o corte aqui é a marca, nunca
                  o nome do cliente. Quantas e quando ficam no `title` e na
                  aba do painel. */}
              {/* A ampulheta da janela de 24h da Meta. Só o ícone: o tempo
                  restante aparece ao passar o mouse (no toque vale só a cor)
                  e no `title`. Vem ANTES do robô e do atraso porque é a
                  marca menos urgente das três; a ampulheta vermelha e o
                  despertador vermelho podem coexistir e se reforçam. */}
              {selo && rotuloDaJanela && (
                <span
                  title={t("janelaDe24h", { tempo: rotuloDaJanela })}
                  className={cn(
                    "group/janela inline-flex items-center rounded-full px-1 py-px text-[10px] font-medium",
                    COR_DA_AMPULHETA[selo.cor],
                  )}
                >
                  <Hourglass className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden pl-0.5 group-hover/janela:inline">
                    {rotuloDaJanela}
                  </span>
                </span>
              )}
              {/* Inadimplente no Asaas (Fase 1b). Só o ícone, VERMELHO, em
                  par claro/escuro — o valor e os dias ficam no `title`, na
                  faixa do fio e na aba Cobranças. Vem antes do robô: é a
                  marca que muda a resposta. Grupo não tem contato e nunca
                  recebe a dívida. */}
              {divida && (
                <span
                  // Prorrogada (dias negativos, C9): sem contagem — "há 0
                  // dias" afirmaria um atraso que não existe.
                  title={
                    divida.dias !== null && divida.dias >= 0
                      ? t("inadimplente", { valor: dinheiro(divida.totalAtualizado), dias: divida.dias })
                      : t("inadimplenteProrrogado", { valor: dinheiro(divida.totalAtualizado) })
                  }
                  className="inline-flex items-center rounded-full bg-red-500/15 px-1 py-px text-red-700 dark:text-red-300"
                >
                  <CircleDollarSign className="h-3 w-3" aria-hidden="true" />
                </span>
              )}
              {esperasDeAutomacao > 0 && (
                <span
                  title={t("automacaoRodando", { n: esperasDeAutomacao })}
                  className="inline-flex items-center rounded-full bg-violet-500/15 px-1 py-px text-violet-600 dark:text-violet-300"
                >
                  <Zap className="h-3 w-3" aria-hidden="true" />
                </span>
              )}
              {atraso && rotuloDoAtraso && (
                <span
                  title={t("awaitingReply", { tempo: rotuloDoAtraso })}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-medium",
                    atraso.critico
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                  )}
                >
                  <AlarmClock className="h-3 w-3" aria-hidden="true" />
                  {rotuloDoAtraso}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            {/* ⚠️ Durante a busca, a prévia de sempre MENTE. Ela mostra a
                ÚLTIMA mensagem da conversa; se o que casou foi uma mensagem de
                três meses atrás, a linha aparece no resultado exibindo um texto
                que não contém o termo — e o operador lê aquilo como defeito da
                busca. Por isso, quando o achado veio do corpo, a prévia dá
                lugar ao trecho que casou de verdade. */}
            {achado ? (
              <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <MessageSquareText className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">
                  {stripWhatsAppFormat(achado.trecho)}
                </span>
                {achado.quantas > 1 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {t("searchHitCount", { n: achado.quantas })}
                  </span>
                )}
              </p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {stripWhatsAppFormat(conversation.last_message_text) ||
                  t("noMessagesYet")}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {conversation.unread_count}
                </span>
              )}
              {conversation.status !== "open" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-medium",
                    STATUS_PILL[conversation.status],
                  )}
                >
                  {conversation.status === "pending"
                    ? tThread("statusPending")
                    : tThread("statusClosed")}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* A estrela fica SEMPRE visível, e não só no hover: metade do uso do
          inbox é em tela de toque, onde hover não existe — um controle que só
          aparece ao passar o mouse simplesmente não existe no celular. */}
      {/* ⚠️ `disabled` enquanto a sessão/conta não resolveu. Sem isso, clicar
          nos primeiros instantes cai fora e o operador leva um "não deu,
          tente de novo" sem que NADA tenha sido enviado ao banco — e se o
          perfil falhar ao carregar, esse erro falso se repetiria a sessão
          inteira. */}
      <button
        type="button"
        onClick={handleFavorita}
        disabled={!favoritaHabilitada}
        aria-pressed={favorita}
        title={favorita ? t("unfavorite") : t("favorite")}
        aria-label={favorita ? t("unfavorite") : t("favorite")}
        className={cn(
          // 36px de alvo: o de 28 ficava a 4px do botão da linha, e num toque
          // impreciso o dedo abria a conversa em vez de favoritar.
          "absolute right-0.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
          favorita
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-muted-foreground"
        )}
      >
        <Star className={cn("h-4 w-4", favorita && "fill-current")} />
      </button>
    </div>
  );
}
