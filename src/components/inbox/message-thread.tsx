"use client";

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useChannels } from "@/hooks/use-channels";
import { useLeadEvents } from "@/hooks/use-lead-events";
import { useExecucoesDoFio } from "@/hooks/use-execucoes-do-fio";
import { useConversationNotes } from "@/hooks/use-conversation-notes";
import { useApagarNota } from "@/hooks/use-apagar-nota";
import { useFixarNota } from "@/hooks/use-fixar-nota";
import { useCan } from "@/hooks/use-can";
import { ScheduledBar } from "./scheduled-bar";
import { FaixaDeInadimplencia } from "./faixa-de-inadimplencia";
import { dividaDoContato, type RespostaDoResumo } from "@/lib/asaas/aviso-na-conversa";
import { ExecutarAutomacaoDialog } from "./executar-automacao-dialog";
import { CopiarLinkDaConversa } from "@/components/inbox/copiar-link-da-conversa";
import { AvataresNaConversa } from "./avatares-na-conversa";
import { useQuemVeAConversa } from "@/hooks/use-conversa-aberta";
import { intercalar, type ItemDaLinhaDoTempo } from "@/lib/lead-events/describe";
import {
  janelaFechada,
  minutosRestantes,
  restanteParaExibir,
  ultimaDoClienteNoCanal,
  type CanalDeSaida,
} from "@/lib/inbox/janela-24h";
import { patchDeSituacao } from "@/lib/conversations/situacao";
import { acharNoFio } from "@/lib/inbox/achados-no-fio";
import { semAcento, TERMO_MINIMO } from "@/lib/inbox/busca-em-mensagens";
import {
  DESTAQUE_DO_SALTO_MS,
  seletorDoAlvo,
  type AlvoDoSalto,
  type PedidoDeSalto,
} from "@/lib/inbox/salto-no-fio";
import { Input } from "@/components/ui/input";
import { contarNovasDoCliente } from "@/lib/inbox/nao-lidas-abaixo";
import {
  aberturasDeCanal,
  canalDivergente,
  fioMulticanal,
} from "@/lib/inbox/canais-do-fio";
import {
  coresPorCanal,
  corDoCanal,
  type CorDeCanal,
} from "@/lib/cb-channels/cores";
import {
  aplicarAssinatura,
  assinaturaExistente,
  nomeDePessoa,
  removerAssinatura,
} from "@/lib/assinatura/assinatura";
import { LeadEventLine } from "@/components/lead-events/lead-event-line";
import { NoteLine } from "./note-line";
import { AvisoDeExecucao } from "./aviso-de-execucao";
import { NotaFixadaBar } from "./nota-fixada-bar";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  InteractiveMessagePayload,
  ConversationNote,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  Users,
  Search,
  ChevronUp,
  CornerUpLeft,
  X,
} from "lucide-react";
import { nomeDoGrupo } from "@/lib/cb-groups/display";
import type { CbChannel } from "@/lib/cb-channels/repo";
import { format, isToday, isYesterday } from "date-fns";
import { LOCALE_DAS_DATAS } from "@/lib/idioma-das-datas";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { GaleriaDoFio } from "./media-gallery";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  type SendMediaPayload,
} from "./message-composer";
import { TemplatePicker } from "./template-picker";
import { AiThreadBanner } from "./ai-thread-banner";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ehEvolution } from "@/lib/cb-channels/transporte";
import { IconeDoTransporte } from "@/components/channels/transporte-icone";
import { identidadeDoContato, nomeDoContato } from "@/lib/contacts/identidade";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * Multi-canal: o operador trocou o canal de resposta da conversa (ou
   * voltou para o Automático). Opcional para os callers existentes; o
   * seletor só aparece quando a conta tem 2+ canais.
   */
  onChannelChange?: (
    conversationId: string,
    patch: { channel_id?: string; channel_pinned: boolean },
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Abre a ficha do contato/grupo — chamado ao tocar no nome/avatar do
   * cabeçalho. No celular a página abre o overlay do painel (única
   * superfície da ficha abaixo de lg); no desktop reabre a coluna se o
   * operador a tiver fechado.
   */
  /** `aba` opcional: o cartão de falha pede 'automacoes' (985). */
  onOpenContactPanel?: (aba?: string) => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * O termo da busca do inbox, já assentado (ver `termoAplicado` em
   * `useBuscaEmMensagens`). Vazio quando não há busca.
   *
   * Com ele o fio abre PARADO na mensagem que casou, em vez de abrir no fim e
   * deixar o operador rolando atrás do trecho que a lista acabou de mostrar.
   * Opcional para os callers existentes.
   */
  termoDaBusca?: string;
  /**
   * Pedido de salto vindo de FORA do fio — o "Ver na conversa" das abas
   * Notas e Arquivos do painel (09/09/2026). O fio centraliza a mensagem (ou
   * a anotação) e a destaca por alguns segundos. Ver `salto-no-fio.ts` para
   * a forma: carimbado com a conversa e com um contador, para o mesmo alvo
   * clicado duas vezes rolar duas vezes.
   */
  saltoPedido?: PedidoDeSalto | null;
  /**
   * Quem está INADIMPLENTE no Asaas (Fase 1b) — a resposta em lote da
   * página, a MESMA que acende o ícone da lista. `null` = ainda não sei:
   * a faixa cala, sem afirmar "em dia".
   */
  inadimplencia?: RespostaDoResumo | null;
}

/**
 * Âncora do salto da busca, e o destaque do achado em que o operador está.
 *
 * ⚠️ Envolve a bolha em vez de marcá-la por dentro porque o fio tem DOIS
 * caminhos de mensagem — a bolha comum (dentro do `MessageActions`) e o aviso
 * de sistema do grupo (bolha crua). Marcando por dentro, a segunda ficaria sem
 * âncora e o ↑/↓ pularia por cima dela sem rolar a tela.
 *
 * ⚠️ `data-message-id` é `messages.id`, NUNCA `message_id` — este é o wamid do
 * WhatsApp, existe na mesma tabela e um salto atrás dele não acharia nada.
 *
 * O destaque fica de pé enquanto aquele for o achado corrente (some quando a
 * busca é apagada), e não por alguns segundos: com ↑/↓ é ele que responde "em
 * qual dos cinco eu estou" a cada passo.
 *
 * Desde 09/09/2026 embrulha também a ANOTAÇÃO intercalada (`tipo="nota"`,
 * âncora `data-nota-id`): é o que o "Ver na conversa" da aba Notas procura.
 * Os dois nomes de atributo são cobrados por `salto-no-fio.test.ts`.
 */
/**
 * "Daqui para baixo a conversa passou a correr por este número."
 *
 * Mesmo papel do separador de DATA logo acima na tela, e de propósito: o
 * operador já lê aquela linha como "mudou de contexto". O rótulo embaixo
 * de cada bolha continua (com a bolinha da cor) e responde "e esta aqui?" a
 * qualquer altura do fio; o separador é o que anuncia a TROCA, uma vez, com
 * o nome inteiro em destaque.
 *
 * Só aparece em conversa que MISTURA conexões (ver `aberturasDeCanal`), que
 * são 4 das 228 em produção. É o orçamento visual que sobra por não gastá-lo
 * nas outras 224.
 */
function SeparadorDeCanal({
  nome,
  cor,
  rotulo,
}: {
  nome: string;
  cor: CorDeCanal;
  rotulo: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label={rotulo}>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium",
          cor.texto,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cor.ponto)}
        />
        <span className="truncate">{nome}</span>
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

function LinhaDoFio({
  tipo = "mensagem",
  id,
  destacada,
  children,
}: {
  /** A anotação intercalada usa a MESMA moldura, com âncora própria. */
  tipo?: "mensagem" | "nota";
  id: string;
  destacada: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-message-id={tipo === "mensagem" ? id : undefined}
      data-nota-id={tipo === "nota" ? id : undefined}
      className={cn(
        "rounded-lg transition-colors",
        destacada && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Rola `cont` até `el` ficar no meio da tela.
 *
 * Mede pela diferença entre os retângulos em vez de usar `offsetTop`: o
 * contêiner de rolagem não é `relative`, então `offsetTop` seria contado a
 * partir de um ancestral qualquer e o salto pararia no lugar errado. Serve
 * ao salto da busca e ao salto pedido pelo painel — a mesma conta nos dois.
 */
function centralizarNoFio(cont: HTMLElement, el: HTMLElement) {
  const rCont = cont.getBoundingClientRect();
  const rAlvo = el.getBoundingClientRect();
  cont.scrollTop +=
    rAlvo.top - rCont.top - (cont.clientHeight - rAlvo.height) / 2;
}

/** Um pedido de salto pontual: o alvo e um contador que o torna novo. */
type SaltoPontual = AlvoDoSalto & { n: number };

/**
 * O salto PONTUAL: rola até o alvo, centraliza e o destaca por
 * `DESTAQUE_DO_SALTO_MS`. Serve ao clique na citação E ao "Ver na conversa"
 * do painel — cada origem instancia o hook com o SEU pedido, e a mecânica
 * é uma só. Devolve o que está destacado agora, ou `null`.
 *
 * ⚠️ Quatro cercas, cada uma com motivo: (1) atende UMA vez por `n`
 * (`atendidoRef`) — o efeito depende de `mensagens`/`notas` para atender o
 * pedido feito durante uma carga (alvo ainda fora do DOM), e sem a memória
 * toda mensagem nova re-centralizaria o alvo velho, arrastando o operador de
 * volta; (2) chama `liberarSalto()` antes de rolar — o operador agiu, e o
 * efeito que centraliza o achado da BUSCA disputaria a tela; (3) o timer do
 * destaque vive num REF, fora da limpeza do efeito — a limpeza roda a cada
 * mensagem nova e, cancelando o timer, deixaria o destaque aceso para sempre
 * quando algo chegasse nos 2,5 s; (4) o destaque é DERIVADO
 * (`pedido.n !== apagado`) e o único `setState` é o do timer — o React
 * Compiler recusa `setState` síncrono em efeito.
 */
function useSaltoPontual(
  pedido: SaltoPontual | null,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  liberarSalto: () => void,
  mensagens: readonly unknown[],
  notas: readonly unknown[],
): AlvoDoSalto | null {
  const atendidoRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** O `n` do pedido cujo destaque já apagou. */
  const [apagado, setApagado] = useState(0);

  useEffect(() => {
    if (!pedido || pedido.n === atendidoRef.current) return;
    const cont = scrollRef.current;
    if (!cont) return;
    const el = cont.querySelector<HTMLElement>(seletorDoAlvo(pedido));
    // Ainda não está no DOM (carga em curso): o efeito volta com `mensagens`.
    if (!el) return;

    atendidoRef.current = pedido.n;
    liberarSalto();
    centralizarNoFio(cont, el);
    const quadro = requestAnimationFrame(() => centralizarNoFio(cont, el));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => setApagado(pedido.n),
      DESTAQUE_DO_SALTO_MS,
    );
    return () => cancelAnimationFrame(quadro);
  }, [pedido, scrollRef, liberarSalto, mensagens, notas]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return pedido && pedido.n !== apagado
    ? { tipo: pedido.tipo, id: pedido.id }
    : null;
}

function formatDateSeparator(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const date = new Date(dateStr);
  if (isToday(date)) return t("today");
  if (isYesterday(date)) return t("yesterday");
  // "PPP" é a data por extenso DO locale ("8 de setembro de 2026" em pt-BR).
  // O padrão fixo "MMMM d, yyyy" saía em inglês ("September 8, 2026") entre o
  // "Hoje" e o "Ontem" já traduzidos — e só pôr o locale nele daria
  // "setembro 8, 2026", na ordem do inglês.
  return format(date, "PPP", { locale: LOCALE_DAS_DATAS });
}

/**
 * Agrupa por dia a linha do tempo já intercalada (mensagens + eventos do
 * lead). Substituiu o `groupMessagesByDate` do upstream, que só conhecia
 * mensagem: os separadores de data precisam contar os eventos também, senão um
 * dia em que só houve mudança de funil apareceria sem cabeçalho — ou pior,
 * dentro do cabeçalho do dia anterior.
 */
function groupTimelineByDate(itens: ItemDaLinhaDoTempo<Message>[]) {
  const groups: { date: string; itens: ItemDaLinhaDoTempo<Message>[] }[] = [];
  let currentDate = "";

  for (const item of itens) {
    const day = format(new Date(item.quando), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: item.quando, itens: [item] });
    } else {
      groups[groups.length - 1].itens.push(item);
    }
  }

  return groups;
}

// `color` pinta o item do menu; `pill`/`dot` pintam o gatilho — a mesma
// paleta da lista (`STATUS_COLORS` em conversation-list): violeta = aberta,
// âmbar = pendente, cinza = encerrada.
const STATUS_OPTIONS: {
  label: string;
  value: ConversationStatus;
  color: string;
  pill: string;
  dot: string;
}[] = [
  {
    label: "Open",
    value: "open",
    color: "text-primary",
    pill: "bg-primary/10 text-primary hover:bg-primary/15",
    dot: "bg-primary",
  },
  {
    label: "Pending",
    value: "pending",
    color: "text-amber-400",
    pill: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  {
    label: "Closed",
    value: "closed",
    color: "text-muted-foreground",
    pill: "bg-muted text-muted-foreground hover:bg-muted/80",
    dot: "bg-muted-foreground",
  },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onChannelChange,
  onBack,
  onOpenContactPanel,
  resyncToken = 0,
  onRefresh,
  termoDaBusca = "",
  saltoPedido = null,
  inadimplencia = null,
}: MessageThreadProps) {
  const t = useTranslations("Inbox.messageThread");
  const tTimer = useTranslations("Inbox.sessionTimer");
  const tQuote = useTranslations("Inbox.replyQuote");
  const tActions = useTranslations("Inbox.actions");

  const { user, profile, assinaturaAtiva } = useAuth();

  /**
   * O nome com que ESTA pessoa assina, ou null. Só para desenhar a bolha
   * otimista já assinada — quem assina de verdade é o servidor.
   *
   * ⚠️ Usa as MESMAS funções puras do envio (`nomeDePessoa`,
   * `aplicarAssinatura`). Reimplementar a regra aqui faria a bolha e a
   * mensagem real divergirem no dia em que a regra mudasse, que é o pior
   * jeito possível de errar isto: o operador veria uma coisa e o cliente
   * receberia outra.
   */
  const nomeQueAssina = assinaturaAtiva
    ? nomeDePessoa(profile?.full_name, profile?.email)
    : null;
  /** Quem MAIS está com esta conversa aberta (963) — avatares do cabeçalho. */
  const vendoAgora = useQuemVeAConversa(conversation?.id ?? null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Qual conversa já foi carregada com sucesso. Serve só para o spinner saber
   * distinguir "trocou de conversa" de "resync da mesma conversa" — ver o
   * efeito de carga.
   */
  const conversaCarregadaRef = useRef<string | null>(null);

  /**
   * O operador estava colado no fim do fio?
   *
   * ⚠️ É a guarda que faltava no auto-scroll, e o `saltoAtivoRef` NÃO a
   * substitui: aquele é armado só pelo salto da busca e, pior, `liberarSalto`
   * está pendurado no `onWheel` — rolar à mão DESLIGA o `saltoAtivoRef`. Sem
   * esta, qualquer troca de identidade de `messages`, `leadEvents` ou `notas`
   * puxava para o fim quem estava lendo o histórico. Abrir um anexo em nova
   * aba fazia isso TRÊS vezes por retorno (os três chegam em buscas próprias),
   * porque o `visibilitychange` incrementa o `resyncToken`.
   *
   * Nasce `true`: conversa recém-aberta abre no fim, como sempre.
   */
  const coladoNoFimRef = useRef(true);

  /**
   * O ESPELHO em estado do `coladoNoFimRef`, mais a âncora do "N mensagens
   * não lidas": o id da última mensagem que estava na tela da última vez em
   * que o operador esteve colado no fim. O ref decide o auto-scroll (não pode
   * re-renderizar a cada evento de rolagem); o estado é o que faz o botão
   * aparecer e sumir. Os dois são escritos no MESMO lugar (`anotarPosicao`),
   * num manipulador de evento — nunca num efeito (regra do React Compiler).
   * A âncora carrega a CONVERSA de que é: trocar de conversa a invalida
   * sozinha, sem efeito de limpeza.
   */
  const [noFim, setNoFim] = useState(true);
  const [ultimaVista, setUltimaVista] = useState<{
    conversa: string | null;
    id: string | null;
    createdAt: string | null;
  }>({ conversa: null, id: null, createdAt: null });
  // Id E `created_at` da última mensagem: a âncora precisa dos dois, porque o
  // id da bolha otimista morre quando o realtime a troca pela linha gravada
  // (ver `contarNovasDoCliente`).
  const ultimaMensagemRef = useRef<{ id: string; createdAt: string | null } | null>(null);
  useEffect(() => {
    const ultima = messages.length ? messages[messages.length - 1] : null;
    ultimaMensagemRef.current = ultima
      ? { id: ultima.id, createdAt: ultima.created_at ?? null }
      : null;
  }, [messages]);

  const anotarPosicao = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // ⚠️ Conteúdo que não chega a encher o contêiner NÃO responde a pergunta.
    // É o estado do spinner (~100px numa caixa de centenas): o `scrollHeight`
    // desaba, o navegador grampeia o `scrollTop` em zero e dispara um evento
    // de rolagem cuja conta dá "colado no fim" — religando justamente a guarda
    // que se quer manter desligada. Medir a GEOMETRIA, e não o `loading`, é o
    // que dispensa espelhar estado num ref durante o render (que o React
    // Compiler reprova) e ainda cobre qualquer outro caminho que encolha o fio.
    if (el.scrollHeight <= el.clientHeight) return;
    // A folga não é zero: `scrollTop` é fracionário em tela HiDPI, e exigir o
    // fim exato faria a conversa parar de acompanhar mensagem nova por causa
    // de meio pixel.
    const colado = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    coladoNoFimRef.current = colado;
    setNoFim(colado);
    if (colado) {
      const ultima = ultimaMensagemRef.current;
      const id = ultima?.id ?? null;
      const createdAt = ultima?.createdAt ?? null;
      // `conversation?.id`, e não o `conversationId` derivado mais abaixo:
      // este callback é declarado antes daquela linha, e a lista de
      // dependências é avaliada no render (TDZ).
      const conversa = conversation?.id ?? null;
      setUltimaVista((v) =>
        v.conversa === conversa && v.id === id && v.createdAt === createdAt
          ? v
          : { conversa, id, createdAt },
      );
    }
  }, [conversation?.id]);

  /**
   * O salto da busca está mandando na rolagem agora?
   *
   * Vale de quando há alvo ATÉ O OPERADOR AGIR. Enquanto vale, o auto-scroll
   * fica calado e o efeito que centraliza o alvo tem a palavra final — os dois
   * ficam mais abaixo, junto com o resto do salto.
   *
   * ⚠️ AS DUAS METADES DESTA REGRA SÃO LOAD-BEARING, e cada uma conserta um
   * defeito diferente:
   *
   * 1. **Enquanto vale**, as anotações e os eventos do lead — que chegam em
   *    buscas PRÓPRIAS, depois das mensagens — não desfazem o salto. Sem isto o
   *    salto era desmanchado alguns milissegundos depois, e o sintoma seria
   *    "às vezes funciona".
   * 2. **Deixa de valer quando o operador age.** Suprimir para sempre foi o
   *    primeiro desenho, e quebrava algo pior do que consertava: com a busca
   *    ainda na caixa — ela é da LISTA, do outro lado da tela, não há por que
   *    apagá-la para responder —, a mensagem recém-enviada e a anotação
   *    recém-escrita nasciam abaixo da dobra e NADA rolava até elas. O autor
   *    mandava e não via.
   *
   * Mora aqui em cima, longe do resto do salto, por uma razão chata e real: o
   * `liberarSalto` é dependência de um `useCallback` declarado poucas linhas
   * abaixo, e uma `const` referenciada numa lista de dependências antes de ser
   * inicializada estoura em tempo de render.
   */
  const saltoAtivoRef = useRef(false);

  /** O alvo de agora, legível de dentro de um `useCallback` sem dependências. */
  const alvoAtualRef = useRef<string | null>(null);
  /**
   * O alvo sobre o qual o operador JÁ tomou a rolagem para si.
   *
   * ⚠️ Sem esta memória, "liberar" durava até o próximo resync. Voltar para a
   * aba, apertar o atualizar ou o realtime reconectar ESVAZIA `messages`: o
   * alvo vira `null` e volta a ser o MESMO id, e o efeito que re-arma o salto
   * não tinha como saber que aquilo não era um passo de seta — re-armava, e
   * quem tinha subido para ler o contexto era arrastado de volta.
   */
  const alvoLiberadoRef = useRef<string | null>(null);

  /**
   * O operador agiu — o salto solta a rolagem.
   *
   * ⚠️ Tem de ser chamado ANTES de a bolha otimista (ou a anotação) entrar na
   * lista: quem lê o sinalizador é o efeito que roda DEPOIS do commit, então
   * liberar tarde deixaria justamente o primeiro render — o que contém a coisa
   * nova — ainda sob a supressão.
   */
  const liberarSalto = useCallback(() => {
    saltoAtivoRef.current = false;
    alvoLiberadoRef.current = alvoAtualRef.current;
  }, []);

  /**
   * Toda bolha que NASCE de um envio daqui passa por aqui.
   *
   * São quatro caminhos de envio (texto, mídia, template, interativa) e o único
   * ponto em comum é a bolha otimista. Chamar `liberarSalto` nos quatro à mão
   * daria certo hoje e envelheceria mal: um quinto caminho nasceria sem a
   * liberação, e o defeito — "mandei e não vi" — só aparece com busca ativa,
   * que é justamente quando ninguém testa.
   */
  const publicarMensagemOtimista = useCallback(
    (msg: Message) => {
      liberarSalto();
      // ⚠️ Escrever é pedir para ver o que se escreveu. Sem isto, quem estava
      // lendo o histórico mandaria a mensagem e ela nasceria abaixo da dobra,
      // com o auto-scroll calado pela guarda do `coladoNoFimRef` — o mesmo
      // "mandei e não vi" que o comentário acima descreve para o salto.
      // Vale para os quatro caminhos de envio, pelo mesmo motivo de o funil
      // existir.
      coladoNoFimRef.current = true;
      onNewMessage(msg);
    },
    [liberarSalto, onNewMessage],
  );

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  /** Popup "Executar automação" (955), aberto pelo menu + do compositor. */
  const [executarAberto, setExecutarAberto] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  /** Id da mensagem cujo anexo de grupo está sendo buscado agora. */
  const [anexoEmCurso, setAnexoEmCurso] = useState<string | null>(null);
  /**
   * Anexo aberto na galeria do fio (`messages.id`), ou null. A galeria em
   * si mora em media-gallery.tsx; aqui fica só o estado, porque é o fio
   * quem tem a lista completa de mensagens que a navegação percorre.
   */
  const [galeriaAbertaEm, setGaleriaAbertaEm] = useState<string | null>(null);

  // Trocar de conversa fecha a galeria: o id aberto é de OUTRO fio, e a
  // galeria nova não o encontraria — sumiria sozinha, mas depois de piscar.
  useEffect(() => {
    setGaleriaAbertaEm(null);
  }, [conversation?.id]);

  /**
   * Busca sob demanda o anexo de uma mensagem de grupo.
   *
   * ⚠️ O erro é mostrado como veio da rota, e não trocado por um "tente mais
   * tarde" genérico: mídia antiga EXPIRA no servidor do WhatsApp, e nesse caso
   * nenhuma tentativa futura vai funcionar. Dizer "tente depois" faria o
   * operador insistir por dias num arquivo que não existe mais.
   */
  const baixarAnexoDoGrupo = useCallback(
    async (messageId: string) => {
      setAnexoEmCurso(messageId);
      try {
        const res = await fetch(`/api/cb/groups/media/${messageId}`, {
          method: "POST",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error ?? t("groupMediaFailed"));
          return;
        }
        if (payload.media_url) {
          onUpdateMessage(messageId, {
            media_url: payload.media_url,
            media_state: null,
          });
        }
      } catch {
        toast.error(t("groupMediaFailed"));
      } finally {
        setAnexoEmCurso(null);
      }
    },
    [onUpdateMessage, t],
  );

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Canais de WhatsApp da conta (multi-canal). Uma busca por montagem —
  // a lista muda raramente (Settings → Conexões). Falha ou pré-migration
  // → lista vazia → seletor oculto e comportamento antigo preservado.
  // `falhou` alimenta só o que AFIRMA a partir da lista (janela de 24h).
  const {
    channels,
    loading: canaisCarregando,
    falhou: canaisFalharam,
  } = useChannels();

  const channelsById = useMemo(() => {
    const map = new Map<string, CbChannel>();
    for (const c of channels) map.set(c.id, c);
    return map;
  }, [channels]);

  // Canal ativo da conversa: o fixado/seguido, senão o padrão da conta.
  //
  // Este valor também é o `expected_channel_id` do envio, então ele TEM de
  // espelhar o que o servidor resolve (`resolveChannelForConversation`).
  // Inferir o canal por outra via aqui — pela última mensagem carimbada,
  // por exemplo — faria a asserção discordar do servidor e devolver 409
  // `channel_changed` em loop, sem envio nenhum passar.
  const activeChannel = useMemo(() => {
    if (!channels.length) return null;
    return (
      channelsById.get(conversation?.channel_id ?? "") ??
      channels.find((c) => c.is_default) ??
      null
    );
  }, [channels, channelsById, conversation?.channel_id]);

  // Só a API oficial da Meta tem janela de 24h, e ela só REABRE por template.
  // No canal Evolution o atendente escolhe o número e conversa normalmente:
  // o cronômetro some, o aviso de "janela expirada" não aparece e o
  // compositor nunca trava (ver as props do MessageComposer).
  const evolutionActive = ehEvolution(activeChannel);

  // Grupo só existe na Evolution (a Cloud API da Meta não entrega grupo) e
  // não tem janela de 24h. E o `activeChannel` de um grupo cai no canal
  // PADRÃO da conta (a conversa de grupo tem `channel_id` nulo): com o padrão
  // no número oficial, sem esta guarda a regra aplicava a janela da Meta ao
  // grupo — e, contada por número, trancava o compositor de todo grupo.
  const ehGrupo = !!conversation?.group_id;

  /**
   * ⚠️ Enquanto os canais não chegam, o transporte é DESCONHECIDO — e
   * `evolutionActive` responde `false`, que aqui significaria "é Meta, a
   * janela vale". Afirmar isso sobre dado que ainda não temos custava, numa
   * conta 100% Evolution: a badge vermelha "Expirada" piscando no cabeçalho
   * por alguns segundos ao abrir cada conversa E — o dano de verdade — o
   * compositor DESABILITADO com "Sessão expirada, use um modelo" no exato
   * instante em que o operador abre a conversa para responder. As primeiras
   * teclas iam para o vazio. (Medido em produção: conversa com `channel_id`
   * nulo, que cai no canal padrão da conta, justamente o Evolution.)
   *
   * Mesma família do "efeito passivo mostra o estado velho" do CLAUDE.md: a
   * cura é esperar o dado, não adivinhá-lo. Conta SEM canal nenhum continua
   * na regra da Meta — ali a lista resolveu vazia, e vazio-com-resposta é
   * conhecimento, não lacuna.
   *
   * ⚠️ E `falhou` conta como "não sei" (#06): o hook devolvia
   * `{channels: [], loading: false}` byte por byte igual para "conta sem
   * canal" e "não consegui perguntar" — um 5xx transitório travava o
   * compositor da conta Evolution até o operador recarregar a página.
   * Falha abre o compositor (o lado em que a Evolution está); o portão do
   * disparo abaixo continua recusando envio Meta fora da janela.
   */
  const janelaDe24h = !canaisCarregando && !canaisFalharam && !evolutionActive && !ehGrupo;

  /**
   * POR QUAL NÚMERO a janela é contada: o canal de SAÍDA — o mesmo que vai no
   * `expected_channel_id` do envio. A janela da Meta é por número (ver o
   * cabeçalho de `janela-24h.ts`): numa conversa mista, a mensagem que o
   * cliente mandou pela outra conexão não abre a janela deste. Vai o canal
   * inteiro (id + transporte): o transporte decide o que fazer com a mensagem
   * sem carimbo. Nulo quando não há canal resolvido — na prática, a conta sem
   * conexão nenhuma (enquanto os canais carregam ou falham, `janelaDe24h` já
   * é falso) —, e aí a regra conta o fio inteiro, como antes do multi-canal.
   */
  const canalDaJanela: CanalDeSaida | null = activeChannel;

  // O relógio da badge (M11): `sessionInfo` lê a hora, e hora PASSA — sem um
  // tique, o memo congelava em "1h restantes" num fio parado e a janela
  // fechava com o compositor liberado (o portão do disparo segurava o envio,
  // mas a tela mentia até chegar mensagem nova). Um tique por minuto basta:
  // a badge fala em horas/minutos inteiros.
  //
  // ⚠️ O tique NÃO é condicionado a `janelaDe24h`. O fio fica montado ao
  // trocar de conversa, e numa conta com os DOIS transportes o relógio
  // parado numa conversa Evolution chegava VELHO à conversa Meta seguinte —
  // horas velho, se a pessoa passou a tarde na Evolution. O memo abaixo
  // recomputava com as `messages` novas e o instante antigo: a badge dizia
  // "2h restantes" e o compositor abria sobre janela já fechada, até o tique
  // seguinte (o portão do disparo segurava o envio, mas a tela mentia por
  // até um minuto). Um setState por minuto num fio parado é barato; o
  // relógio errado não é. (Achado do Codex no PR #96.)
  const [agoraDaBadge, setAgoraDaBadge] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgoraDaBadge(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // 24-hour session timer. A REGRA mora em `lib/inbox/janela-24h`, porque o
  // portão do disparo (abaixo) tem de ler exatamente a mesma coisa com outro
  // relógio.
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };
    // UM instante para as duas leituras: entre dois relógios cabe uma virada
    // de hora, e aí a janela sairia "aberta" com "0h restantes". O instante
    // vem do estado (não de `new Date()` aqui) para o memo envelhecer.
    const agora = agoraDaBadge;
    if (janelaFechada(messages, agora, canalDaJanela)) {
      // "Expirada" só quando o cliente JÁ escreveu por este número. Sem
      // mensagem dele aqui a frase é outra: numa conversa mista ele pode ter
      // escrito só pela outra conexão, e "Expirada" afirmaria uma janela que
      // nunca abriu neste número.
      const temCliente =
        ultimaDoClienteNoCanal(messages, canalDaJanela) !== undefined;
      return {
        expired: true,
        remaining: temCliente ? tTimer("expired") : tTimer("noCustomerMessages"),
      };
    }

    // Horas inteiras enquanto sobra ao menos uma; minutos na última hora.
    const restante = restanteParaExibir(
      minutosRestantes(messages, agora, canalDaJanela),
    );
    const remaining =
      restante.unidade === "h"
        ? tTimer("xhRemaining", { hours: restante.valor })
        : tTimer("xmRemaining", { minutes: restante.valor });

    return { expired: false, remaining };
  }, [messages, tTimer, agoraDaBadge, canalDaJanela]);

  /**
   * O ÚLTIMO PORTÃO ANTES DA REDE: a janela está fechada NESTE instante?
   *
   * ⚠️ Não é redundante com a prop `sessionExpired` do compositor. Aquela é
   * lida quando o operador aperta Enter; esta, quando a mensagem realmente
   * sai — e entre as duas cabem os 5s da janela de desfazer, o tempo de
   * `/api/cb/channels` responder e os minutos que um rascunho de mídia fica
   * aberto enquanto se escreve a legenda. Durante a carga dos canais o
   * transporte é desconhecido e o compositor fica LIBERADO de propósito
   * (senão as primeiras teclas se perdem — é a correção do PR #81); sem este
   * portão, o que foi digitado nesse vão era despachado para a Meta fora da
   * janela, que só o servidor dela recusaria.
   *
   * ⚠️ RECALCULA A REGRA, nunca lê `sessionInfo.expired`. Aquele `useMemo`
   * depende de `[messages, tTimer]`, então o simples PASSAR DAS HORAS não o
   * recomputa: um valor cacheado aqui responderia "aberta" para sempre num
   * fio parado, que é justamente o fio prestes a expirar. O relógio é lido no
   * disparo. (Achados do Codex nas revisões dos PRs #81 e #84.)
   *
   * ⚠️ E ele NÃO engole a mensagem: publica a bolha e a marca `failed`, o
   * mesmo caminho da recusa da Meta. Abortar antes de publicar apagaria o
   * texto — o compositor já limpou o campo no Enter —, e o operador perderia
   * o que escreveu sem nada na tela para copiar de volta. Aqui ele vê a bolha
   * com o texto dele e o motivo em português, sem custar uma chamada à Meta.
   *
   * Os refs são escritos em efeito (não no render) pela regra de refs do
   * React 19, como o `onMessagesLoadedRef` abaixo. O consumidor lê no
   * disparo, muito depois.
   */
  const janelaDe24hRef = useRef(false);
  const mensagensRef = useRef<Message[]>(messages);
  const canalDaJanelaRef = useRef<CanalDeSaida | null>(canalDaJanela);
  useEffect(() => {
    janelaDe24hRef.current = janelaDe24h;
    mensagensRef.current = messages;
    canalDaJanelaRef.current = canalDaJanela;
  });
  const janelaFechadaAgora = useCallback(
    () =>
      janelaDe24hRef.current &&
      janelaFechada(mensagensRef.current, new Date(), canalDaJanelaRef.current),
    [],
  );

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) {
      // Voltar (celular) zera `messages` no pai e deixa o fio montado SEM
      // conversa. Sem zerar a marca aqui, REABRIR a mesma conversa era lido
      // como resync — sem spinner — e a tela afirmava "Nenhuma mensagem
      // ainda" sobre um fio de 150 linhas até a busca voltar (achado do
      // Codex no PR #101).
      conversaCarregadaRef.current = null;
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // ⚠️ O spinner só entra quando a CONVERSA muda — nunca num resync.
      //
      // Trocar o fio por um spinner de ~100px DENTRO do contêiner de rolagem
      // faz o `scrollHeight` desabar abaixo do `clientHeight`, e o navegador
      // GRAMPEIA o `scrollTop` em zero. Como o resync dispara a cada
      // `visibilitychange`, abrir um anexo em nova aba e voltar destruía a
      // posição de quem estava lendo o histórico: o operador voltava para o
      // começo da conversa, e o auto-scroll logo abaixo o empurrava para o
      // fim. Aqui o conteúdo antigo continua válido — ele é substituído
      // quando o novo chega, sem passar pelo vazio.
      const trocouDeConversa = conversaCarregadaRef.current !== conversationId;
      if (trocouDeConversa) {
        setLoading(true);
        // Conversa nova abre no fim — e a âncora do fio anterior não vale mais.
        coladoNoFimRef.current = true;
      }

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
        // Só marca depois de uma carga BOA: se a primeira falhou, a tela está
        // vazia e o próximo resync tem de mostrar o spinner de novo.
        conversaCarregadaRef.current = conversationId;
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Trilha de atividade do lead (migration 912) — mudança de funil, etapa,
  // status e tags aparecem intercaladas na conversa. `resyncToken` entra como
  // gatilho para o botão de atualizar da thread arrastar a trilha junto.
  const { eventos: leadEvents } = useLeadEvents(contact?.id, resyncToken);
  // As execuções de automação que TERMINARAM para este cliente (985).
  //
  // ⚠️ Grupo fica de fora de graça, sem precisar do `ehGrupo` (que só é
  // declarado mais abaixo): conversa de grupo tem `contact_id` NULO — é o
  // CHECK XOR da 906 —, então não há contato por quem perguntar. E automação
  // não roda em grupo, por garantia estrutural.
  const { itens: execucoesDoFio } = useExecucoesDoFio(contact?.id, resyncToken);
  // A dívida DESTE contato no Asaas (Fase 1b), para a faixa acima do
  // compositor. `agoraDaBadge` é o relógio de um minuto do cabeçalho — os
  // dias de atraso viram à meia-noite sem recarregar. Grupo não tem contato.
  const dividaDoAsaas = useMemo(
    () => dividaDoContato(inadimplencia, contact?.id, agoraDaBadge),
    [inadimplencia, contact?.id, agoraDaBadge],
  );

  // Anotações internas (migration 918). Chaveadas pela CONVERSA, não pelo
  // contato como a trilha acima — é a única chave que existe em grupo.
  //
  // ⚠️ Chamado aqui em cima, junto dos outros hooks, e não perto de
  // `messageGroups`: aquele trecho vem DEPOIS do early return da conversa
  // inexistente, e um hook ali violaria a regra dos hooks.
  const {
    notas,
    remover: removerNotaLocal,
    acrescentar: acrescentarNota,
    recarregar: recarregarNotas,
    aplicarFixacao,
  } = useConversationNotes(conversationId, resyncToken);
  const { fixarNota, fixando } = useFixarNota(aplicarFixacao);
  /**
   * A anotação fixada da conversa (951), que vira a faixa do topo.
   *
   * ⚠️ Derivada das notas que o fio JÁ carregou — nenhuma consulta nova. O
   * preço é o teto da janela do hook: fixada mais velha que as 200 notas
   * mais recentes não entra e a faixa some em silêncio (o mesmo teto que a
   * aba Notas do painel tem, e a mesma família de teto-que-chega-por-
   * crescimento de 924/929). Hoje o máximo real é 2 notas por conversa.
   *
   * Em conversa de GRUPO isto é sempre nulo: nota de grupo não tem contato
   * e a rota recusa fixá-la.
   *
   * ⚠️ A faixa fica FORA do `loading` que esconde o fio, então ela é a
   * primeira a expor nota do cliente anterior no render da troca (achado do
   * Codex no PR #64). A guarda contra isso mora no `useConversationNotes`,
   * que só devolve nota da conversa do render atual — foi movida para lá
   * porque a segunda cópia, a do painel da conversa, era a que faltava.
   */
  const notaFixada = useMemo(
    () => notas.find((n) => n.fixada_em) ?? null,
    [notas],
  );
  const podeAdministrar = useCan("manage-members");
  // Agendadas (925): a faixa acima do compositor e o compositor são
  // irmãos aqui, então o contador que os liga mora nesta tela mesmo.
  const podeEnviar = useCan("send-messages");
  const [agendadasResync, setAgendadasResync] = useState(0);

  /**
   * ⚠️ Confere a conversa antes de pôr a anotação no fio.
   *
   * A anotação é GRAVADA no lugar certo — a caixa manda o `conversationId`
   * que ela capturou. Mas esta thread não remonta ao trocar de conversa, e
   * quem responde ao POST é o render atual: trocar de cliente enquanto o
   * salvamento está no ar faria a anotação de um aparecer na tela do outro.
   * Some ao recarregar, mas até lá o operador lê a anotação de um cliente
   * dentro da conversa de outro — que é a coisa que esta feature inteira não
   * pode fazer.
   */
  const acrescentarNotaDaConversa = useCallback(
    (nota: ConversationNote) => {
      if (nota.conversation_id !== conversationId) return;
      // Escrever anotação é agir: solta a rolagem do salto da busca, senão o
      // autor salva e não vê o que acabou de escrever.
      liberarSalto();
      // E, pelo mesmo motivo, volta a acompanhar o fim — a anotação nasce lá
      // embaixo, e a guarda do `coladoNoFimRef` calaria o auto-scroll para
      // quem estava lendo o histórico enquanto escrevia.
      coladoNoFimRef.current = true;
      acrescentarNota(nota);
    },
    [acrescentarNota, conversationId, liberarSalto],
  );

  /**
   * Apagar anotação. ⚠️ A ação mora no hook (como `useFixarNota`) porque a
   * ABA Notas do painel e a do grupo fazem a MESMA coisa desde 2026-09-02, e
   * o que as três precisam ter igual é a guarda do `count`: RLS que barra
   * DELETE devolve 0 linhas SEM erro, e a cópia que a esquecesse faria a
   * anotação sumir da tela, ficar no banco e voltar na próxima abertura.
   */
  const { apagarNota: handleApagarNota } = useApagarNota(
    removerNotaLocal,
    recarregarNotas,
  );

  // ============================================================
  // Salto da busca — a conversa abre parada na mensagem que casou
  // ============================================================

  /**
   * A busca DENTRO da conversa aberta (09/09/2026): a lupa do cabeçalho abre
   * uma barra com campo próprio, e o termo digitado ali passa a mandar no
   * salto — no lugar do termo da lista. Reusa TUDO do salto (achados, alvo,
   * setas, destaque); só a origem do termo muda.
   *
   * ⚠️ Carimbada com a conversa em vez de zerada num efeito ao trocar: é a
   * mesma assinatura da `escolhaNaBusca` — uma conversa diferente
   * simplesmente não reconhece a barra aberta, sem o quadro em que o efeito
   * ainda não rodou.
   */
  const [buscaLocal, setBuscaLocal] = useState<{
    conversationId: string;
    termo: string;
  } | null>(null);
  const buscaLocalAberta =
    buscaLocal !== null && buscaLocal.conversationId === conversationId;
  const termoEfetivo = buscaLocalAberta ? buscaLocal.termo : termoDaBusca;
  // O piso é o de `acharNoFio` (3 caracteres, medidos no termo normalizado —
  // a mesma régua do banco); abaixo dele a barra diz o que falta em vez de
  // afirmar "nada encontrado".
  const termoLocalCurto =
    buscaLocalAberta &&
    semAcento(buscaLocal.termo.trim()).length < TERMO_MINIMO;

  const alternarBuscaLocal = useCallback(() => {
    if (!conversationId) return;
    setBuscaLocal((atual) =>
      atual && atual.conversationId === conversationId
        ? null
        : { conversationId, termo: "" },
    );
  }, [conversationId]);

  /**
   * As mensagens desta conversa que casam com o termo, em ordem cronológica.
   *
   * Roda em JS porque o fio já carregou a conversa inteira; o porquê disso não
   * ser "meio a meio" com o banco está em `achados-no-fio.ts`.
   */
  const achadosNoFio = useMemo(
    () => acharNoFio(messages, termoEfetivo),
    [messages, termoEfetivo],
  );

  /**
   * O achado escolhido com as setas, CARIMBADO com a busca que o produziu.
   *
   * ⚠️ A assinatura (conversa + termo) faz parte do estado de propósito. Sem
   * ela seria preciso zerar a escolha num efeito ao trocar de conversa ou de
   * termo — e por um quadro o fio saltaria para o alvo velho antes de corrigir,
   * com o destaque piscando de uma bolha para outra. Guardando junto, uma busca
   * diferente simplesmente não reconhece a escolha antiga.
   */
  const [escolhaNaBusca, setEscolhaNaBusca] = useState<{
    assinatura: string;
    id: string;
  } | null>(null);

  // `|` separa porque `conversationId` é um UUID e nunca o contém — então não
  // há termo capaz de forjar a assinatura de outra conversa. (Aqui já morou um
  // U+0000 CRU, que deixava este arquivo BINÁRIO para o `grep` e o `file`: as
  // buscas passavam a devolver zero linhas em silêncio.)
  const assinaturaDaBusca = `${conversationId ?? ""}|${termoEfetivo}`;
  const escolhido =
    escolhaNaBusca?.assinatura === assinaturaDaBusca ? escolhaNaBusca.id : null;

  // Sem escolha (ou com escolha que não casa mais — a mensagem pode ter sido
  // apagada), o alvo é o achado MAIS RECENTE. É o mesmo que a linha da lista
  // mostrou no trecho: a RPC 929 recorta o `DISTINCT ON ... ORDER BY
  // created_at DESC`, ou seja, também o último. Abrir noutro lugar mostraria
  // um trecho na lista e destacaria outro no fio.
  const posicaoEscolhida = escolhido ? achadosNoFio.indexOf(escolhido) : -1;
  const posicaoDoAlvo =
    posicaoEscolhida >= 0 ? posicaoEscolhida : achadosNoFio.length - 1;
  const alvoId = posicaoDoAlvo >= 0 ? achadosNoFio[posicaoDoAlvo] : null;

  const irParaAchado = useCallback(
    (passo: 1 | -1) => {
      const proxima = posicaoDoAlvo + passo;
      // ⚠️ Para nas pontas, não dá a volta. Os botões já ficam desabilitados
      // ali; esta guarda é a que garante o índice válido mesmo que a lista
      // encolha entre o render e o clique (mensagem apagada por outra pessoa).
      if (proxima < 0 || proxima >= achadosNoFio.length) return;
      setEscolhaNaBusca({
        assinatura: assinaturaDaBusca,
        id: achadosNoFio[proxima],
      });
    },
    [posicaoDoAlvo, achadosNoFio, assinaturaDaBusca],
  );

  // O espelho de `alvoId` no sinalizador. Declarado AQUI, e não junto do
  // `saltoAtivoRef` lá em cima, por causa da ordem: os efeitos disparam na
  // ordem em que foram declarados, e este precisa ter atualizado o sinalizador
  // antes de o auto-scroll logo abaixo decidir se rola.
  useEffect(() => {
    alvoAtualRef.current = alvoId;
    // Trocar de alvo (as setas) RE-ARMA o salto — mas só quando o alvo é
    // OUTRO. Voltar ao mesmo id depois de um resync não é um passo de seta, e
    // re-armar ali desfaria a decisão de quem já tinha tomado a rolagem.
    if (alvoId !== null && alvoId !== alvoLiberadoRef.current) {
      // Zerado ao armar: senão, sair do achado 5 e voltar a ele com as setas
      // ficaria sem salto para sempre.
      alvoLiberadoRef.current = null;
      saltoAtivoRef.current = true;
    } else if (alvoId === null) {
      saltoAtivoRef.current = false;
    }
  }, [alvoId]);

  // Auto-scroll to bottom on new messages.
  // `leadEvents` e `notas` entram na lista de dependências porque chegam em
  // buscas próprias, depois das mensagens: sem isso o conteúdo cresce embaixo
  // do usuário e a conversa deixa de abrir no fim. Vale também para a
  // anotação recém-escrita, que sem isto nasceria abaixo da dobra — o autor
  // salvaria e não veria o que acabou de escrever.
  useEffect(() => {
    if (saltoAtivoRef.current) return;
    // ⚠️ Quem estava lendo o histórico fica onde está. Ver `coladoNoFimRef`.
    if (!coladoNoFimRef.current) return;
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, leadEvents, notas, execucoesDoFio]);

  /**
   * Rola até o alvo e o deixa no meio da tela.
   *
   * Mede pela diferença entre os retângulos em vez de usar `offsetTop`: o
   * contêiner de rolagem não é `relative`, então `offsetTop` seria contado a
   * partir de um ancestral qualquer e o salto pararia no lugar errado.
   *
   * O segundo passo, no quadro seguinte, corrige o que assentou depois da
   * primeira medida (fonte, bolha de mídia que só então ganhou altura).
   * ⚠️ Não cobre imagem que demora a carregar — nesse caso o alvo pode ficar
   * alguns pixels fora do centro. Continua destacado, então dá para achar.
   *
   * ⚠️ `messages` PRECISA estar nas dependências, e não é enfeite. Voltar para
   * a aba do navegador, apertar o atualizar do cabeçalho ou o realtime
   * reconectar incrementam o `resyncToken`: o fio troca todo o conteúdo por um
   * spinner de ~100 px, o `scrollHeight` desaba abaixo do `clientHeight` e o
   * navegador GRAMPEIA o `scrollTop` em zero. Quando as mensagens voltam, o
   * `alvoId` é a MESMA string (os ids não mudaram), então sem `messages` aqui
   * nada re-centraliza — e o operador cai no começo da conversa, com a faixa
   * acima ainda dizendo "11 de 11" sobre uma bolha a meses de rolagem.
   *
   * A guarda do `saltoAtivoRef` é o que impede este efeito de puxar o operador
   * de volta ao alvo depois de ele ter mandado uma mensagem.
   */
  useEffect(() => {
    if (!alvoId || !saltoAtivoRef.current) return;

    const centralizar = () => {
      const cont = scrollRef.current;
      if (!cont) return;
      const el = cont.querySelector<HTMLElement>(
        `[data-message-id="${alvoId}"]`,
      );
      if (!el) return;
      centralizarNoFio(cont, el);
    };

    centralizar();
    const quadro = requestAnimationFrame(centralizar);
    return () => cancelAnimationFrame(quadro);
  }, [alvoId, messages, execucoesDoFio]);

  // ============================================================
  // Salto PONTUAL — rola até um item e o destaca por 2,5 s (09/09/2026)
  // ============================================================
  //
  // Duas origens, UMA mecânica (`useSaltoPontual`, no fim do arquivo): o
  // clique na citação (estado daqui, `irParaCitada`, PR #179) e o "Ver na
  // conversa" das abas do painel (prop `saltoPedido`, carimbada pela
  // página). O salto da BUSCA é outra coisa — derivado de um termo, fica de
  // pé enquanto a busca existir — e mora logo acima.

  /**
   * Clique na citação: rola até a mensagem citada e a destaca, como no
   * WhatsApp. O `n` faz clicar DUAS vezes na mesma citação saltar de novo (o
   * objeto muda, o efeito roda). Ao rolar para cima o `onScroll` anota que o
   * operador saiu do fim, então mensagem nova não o puxa de volta — e o
   * botão de "não lidas" passa a contar.
   */
  const [saltoDaCitacao, setSaltoDaCitacao] = useState<SaltoPontual | null>(null);
  const irParaCitada = useCallback((id: string) => {
    setSaltoDaCitacao((s) => ({ tipo: "mensagem", id, n: (s?.n ?? 0) + 1 }));
  }, []);
  const destaqueDaCitacao = useSaltoPontual(
    saltoDaCitacao,
    scrollRef,
    liberarSalto,
    messages,
    notas,
  );

  // ⚠️ Só pedido DESTA conversa: sem o carimbo, trocar de conversa antes de
  // o fio carregar deixava um pedido pendente que disparava ao voltar.
  const pedidoDoPainel =
    saltoPedido && saltoPedido.conversationId === conversationId
      ? saltoPedido
      : null;
  const destaqueDoPainel = useSaltoPontual(
    pedidoDoPainel,
    scrollRef,
    liberarSalto,
    messages,
    notas,
  );

  /** Quantas mensagens do cliente chegaram enquanto o operador lia lá em cima. */
  const naoLidasAbaixo =
    noFim || ultimaVista.conversa !== conversationId
      ? 0
      : contarNovasDoCliente(messages, ultimaVista);
  const irParaOFim = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    coladoNoFimRef.current = true;
    el.scrollTop = el.scrollHeight; // dispara o onScroll, que anota o fim e a âncora
  }, []);


  /**
   * Fecha a bolha otimista com o que o SERVIDOR gravou.
   *
   * ⚠️ Existe para os quatro caminhos de envio usarem a mesma regra. O de
   * texto já corrigia o texto; mídia, template e interativa só marcavam
   * "enviada" e deixavam o texto otimista de pé até o realtime chegar —
   * então uma legenda assinada aparecia sem o nome por segundos. A rota
   * devolve `content_text` para todos eles desde a 923.
   */
  const marcarEnviada = useCallback(
    (tempId: string, payload: { content_text?: unknown; channel_id?: unknown }) => {
      onUpdateMessage(tempId, {
        status: "sent",
        ...(typeof payload?.content_text === "string"
          ? { content_text: payload.content_text }
          : {}),
        // O canal que o servidor DE FATO usou. A otimista já nasce com o da
        // tela; isto cobre o envio feito antes de `useChannels` responder.
        ...(typeof payload?.channel_id === "string"
          ? { channel_id: payload.channel_id }
          : {}),
      });
    },
    [onUpdateMessage],
  );

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        // ⚠️ Já nasce ASSINADA. Sem isto a mensagem aparece sem o nome e
        // muda sozinha um instante depois, quando a resposta do servidor
        // chega — parecendo que o sistema reescreveu o que foi digitado.
        content_text: aplicarAssinatura(text, nomeQueAssina) ?? text,
        // Nasce CARIMBADA com o número da tela, como já nasce assinada. Em
        // conversa que mistura números, a resposta sem carimbo ficava
        // desenhada no trecho do número ANTERIOR até o realtime trocar a
        // bolha — e realtime atrasado a deixava lá (Codex, PR #105). O
        // servidor confirma o canal que usou de fato em `marcarEnviada`.
        // Os outros três caminhos de envio repetem o carimbo.
        channel_id: activeChannel?.id ?? null,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      publicarMensagemOtimista(optimisticMsg);
      setReplyTo(null);

      // Ver `janelaFechadaAgora`: a janela pode ter fechado — ou só ter
      // ficado CONHECIDA — entre o Enter e este instante.
      if (janelaFechadaAgora()) {
        onUpdateMessage(tempId, { status: "failed" });
        toast.error(t("sessionExpiredBlocked"));
        return;
      }

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
            // Assert de canal: manda o número que ESTÁ NA TELA. Se o cliente
            // escreveu por outro número nesse meio-tempo, a conversa "segue"
            // e o envio sairia por ele — sem o atendente perceber, porque a
            // bolha aparece normal e o rótulo "via <canal>" é discreto. O
            // servidor devolve 409 e a gente pergunta em vez de mandar.
            expected_channel_id: activeChannel?.id ?? undefined,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (res.status === 409 && payload?.code === "channel_changed") {
          // NÃO é erro: é uma pergunta. O cliente escreveu por outro número
          // enquanto o atendente digitava.
          const novo = channels.find((c) => c.id === payload.current_channel_id);
          onNewMessage({ ...optimisticMsg, status: "failed" });
          toast.warning(
            t("channelChangedWhileTyping", {
              channel: novo?.label ?? t("channelChangedUnknown"),
            }),
            { duration: 12_000 },
          );
          return;
        }

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        //
        // ⚠️ E corrige o TEXTO junto. A bolha foi desenhada com o que o
        // atendente digitou; com a assinatura ligada (923) o servidor
        // prefixa, e sem isto a mensagem mudaria sozinha na tela quando o
        // realtime chegasse — parecendo que o sistema reescreveu o que ele
        // escreveu. Trocar aqui, na mesma resposta, faz a assinatura
        // aparecer de uma vez.
        marcarEnviada(tempId, payload);
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    // `activeChannel` e `channels` são load-bearing aqui: um closure obsoleto
    // mandaria o assert com o canal ERRADO, que é justamente o bug que ele
    // existe para impedir.
    // `nomeQueAssina` nas deps: sem ele a bolha otimista continuaria assinando
    // com o nome de antes depois de o interruptor mudar ou a sessão trocar.
    [
      conversation,
      publicarMensagemOtimista,
      // `onNewMessage` continua aqui porque o caminho do 409 acima reescreve a
      // bolha já publicada — ali não há salto para liberar, a mensagem não é
      // nova.
      onNewMessage,
      onUpdateMessage,
      activeChannel?.id,
      channels,
      t,
      marcarEnviada,
      nomeQueAssina,
      janelaFechadaAgora,
    ]
  );

  /**
   * ⚠️ Devolve `false` quando NÃO entregou — e nesse caso NÃO apaga o objeto
   * do bucket. O compositor mantém o anexo na fila e continua dono dele (a
   * limpeza de desmonte e o descarte recolhem). Sem esse par, o anexo de uma
   * fila de cinco sumia no erro do terceiro e o operador reanexava tudo
   * (achado do Codex no PR #144).
   */
  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload): Promise<boolean> => {
      if (!conversation) return false;

      // A legenda, e só ela. O nome do arquivo saiu daqui: ele agora viaja em
      // `media_filename` (969), que é o que a bolha lê.
      // ⚠️ O `"Document"` que ficava neste fallback era string CRUA em inglês
      // — o único texto do fio fora do dicionário. Some junto: sem nome, a
      // bolha resolve o rótulo com `t()`.
      const contentText = payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        // Para a bolha otimista mostrar o nome certo já no primeiro quadro —
        // o servidor grava a mesma coisa quando a mensagem assenta.
        media_filename: payload.filename ?? null,
        // Carimbo de canal — ver o comentário em `handleSend`.
        channel_id: activeChannel?.id ?? null,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      publicarMensagemOtimista(optimisticMsg);
      // ⚠️ A CITAÇÃO NÃO É LIMPA AQUI. Quem limpa é o compositor, pelo
      // `onClearReply`, e só depois de a fila INTEIRA ter saído. Os três
      // retornos `false` abaixo mantêm o anexo na fila para o operador
      // tentar de novo (PR #146), e `MediaDraft` não guarda o id da
      // citada — ela é lida de `replyTo` a cada envio. Limpando aqui, a
      // segunda tentativa saía SEM a citação, enquanto a bolha falhada no
      // fio continuava mostrando a resposta que o retry não carrega: o
      // anexo trocava de contexto em silêncio (achado do Codex no PR #146).

      // Mesmo portão do texto (ver `janelaFechadaAgora`), e aqui o vão é
      // maior:
      // o anexo passa pelo MediaDraftPreview, que SUBSTITUI o compositor e
      // vive enquanto o operador escreve a legenda.
      if (janelaFechadaAgora()) {
        onUpdateMessage(tempId, { status: "failed" });
        toast.error(t("sessionExpiredBlocked"));
        // ⚠️ O objeto FICA: com o retorno `false` o compositor mantém o anexo
        // na fila e volta a ser dono dele. Apagar aqui deixaria o rascunho
        // apontando para um arquivo que não existe mais.
        return false;
      }

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // ⚠️ O objeto FICA — ver o cabeçalho: o compositor volta a ser dono.
          return false;
        }

        // `data` e a resposta; `payload` aqui e o CORPO da requisicao.
        marcarEnviada(tempId, data);
        return true;
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        return false;
      }
    },
    [
      conversation,
      publicarMensagemOtimista,
      onUpdateMessage,
      marcarEnviada,
      janelaFechadaAgora,
      t,
      activeChannel?.id,
    ],
  );

  const handleSendInteractive = useCallback(
    async (payload: InteractiveMessagePayload, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      // Optimistic bubble — renders the buttons/list immediately via the
      // interactive_payload, same as the persisted row will.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "interactive",
        content_text: payload.body,
        interactive_payload: payload,
        // Carimbo de canal — ver o comentário em `handleSend`.
        channel_id: activeChannel?.id ?? null,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      publicarMensagemOtimista(optimisticMsg);

      // Mesmo portão dos outros dois (ver `janelaFechadaAgora`). O diálogo da
      // interativa é montado no compositor e o botão Enviar DELE não olha
      // `sessionExpired`: aberto durante a carga dos canais, ele continua
      // clicável depois de a carga resolver para uma sessão Meta expirada.
      // (Achado do Codex na revisão do PR #84.)
      if (janelaFechadaAgora()) {
        onUpdateMessage(tempId, { status: "failed" });
        toast.error(t("sessionExpiredBlocked"));
        return;
      }

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "interactive",
            interactive_payload: payload,
            reply_to_message_id: replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send interactive message:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // `data` e a resposta; `payload` aqui e o payload interativo.
        marcarEnviada(tempId, data);
      } catch (err) {
        console.error("Failed to send interactive message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [
      conversation,
      publicarMensagemOtimista,
      onUpdateMessage,
      marcarEnviada,
      janelaFechadaAgora,
      t,
      activeChannel?.id,
    ],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      // Reabrir atribui a quem reabriu; encerrar solta o responsável — ver
      // `patchDeSituacao`. Sem sessão não há quem nomear, e a troca fica só
      // na situação (o mesmo que acontecia antes da regra).
      const patch = user
        ? patchDeSituacao(conversation.status, status, user.id)
        : { status };

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update status:", error);
        toast.error(t("statusUpdateFailed"));
        return;
      }

      onStatusChange(conversation.id, status);
      // A atribuição mudou junto: espelha no estado da página, senão o
      // cabeçalho mostra o responsável velho até o realtime chegar.
      if ("assigned_agent_id" in patch) {
        onAssignChange(conversation.id, patch.assigned_agent_id ?? null);
      }
    },
    [conversation, onStatusChange, onAssignChange, user, t]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        // Carimbo de canal — ver o comentário em `handleSend`.
        channel_id: activeChannel?.id ?? null,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      publicarMensagemOtimista(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        marcarEnviada(tempId, payload);
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [
      conversation,
      publicarMensagemOtimista,
      onUpdateMessage,
      marcarEnviada,
      activeChannel?.id,
    ],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = nomeDoContato(contact, "Customer");

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  //
  // ⚠️ Em GRUPO o autor é o participante, não "o contato" — que nem existe.
  // Sem este ramo, citar a mensagem de qualquer participante mostrava o
  // literal "Customer" (texto fixo em inglês) para todo mundo.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      if (isAgentMsg) return "You";
      return m.group_sender_name || contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  // ---- Apagar / editar ------------------------------------------------
  //
  // Só chegam aqui em canal Evolution e dentro do prazo do WhatsApp — o
  // MessageActions esconde os botões fora disso. A rota revalida mesmo
  // assim: o prazo pode estourar entre o render e o clique.

  /** Mensagem em edição, ou null. */
  const [editando, setEditando] = useState<Message | null>(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // ⚠️ O campo de edição recebe o corpo SEM a assinatura (923).
  //
  // Ele era pré-preenchido com o `content_text` inteiro, e com a assinatura
  // gravada ali o operador veria `*Leonardo Cabral Baptista:*` cru dentro do
  // campo — podendo apagar sem querer, ou "corrigir" o nome. O servidor
  // recoloca a assinatura ORIGINAL ao salvar, então o que se edita aqui é só
  // o que se quis dizer.
  useEffect(() => {
    setTextoEdicao(removerAssinatura(editando?.content_text) ?? "");
  }, [editando]);

  const apagarMensagem = useCallback(
    async (msg: Message) => {
      if (!window.confirm(tActions("deleteConfirm"))) return;
      // Otimista: a bolha risca na hora como "exclusão solicitada" — que é
      // o que de fato acontece. `deleted_at` (= "Apagada") só é escrito pelo
      // webhook do WhatsApp confirmando a revogação; se marcássemos aqui, a
      // tela afirmaria uma remoção que ninguém verificou.
      onUpdateMessage(msg.id, {
        delete_requested_at: new Date().toISOString(),
        deleted_by: "agent",
      });
      try {
        const res = await fetch("/api/whatsapp/message", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: msg.id }),
        });
        if (!res.ok) {
          const { error, code } = await res.json().catch(() => ({ error: "", code: "" }));
          // `talvez_enviado`: a revogação pode ter saído — o servidor
          // deliberadamente MANTEVE o pedido registrado. Desfazer a marca
          // aqui faria a tela contradizer o banco e afirmar que nada foi
          // pedido, quando talvez tenha sido.
          if (code === "talvez_enviado") {
            toast.warning(error);
            return;
          }
          throw new Error(error || String(res.status));
        }
        // "Solicitada", não "apagada": o WhatsApp não confirma revogação na
        // resposta, e a confirmação — quando vem — chega pelo webhook.
        toast.success(tActions("deleteRequested"));
      } catch (err) {
        // Falhou ANTES de o pedido sair: nada foi pedido, a bolha volta ao
        // normal.
        onUpdateMessage(msg.id, { delete_requested_at: null, deleted_by: null });
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [onUpdateMessage, tActions],
  );

  const salvarEdicao = useCallback(async () => {
    const alvo = editando;
    const texto = textoEdicao.trim();
    if (!alvo || !texto || salvandoEdicao) return;
    setSalvandoEdicao(true);
    try {
      const res = await fetch("/api/whatsapp/message", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: alvo.id, text: texto }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || String(res.status));
      }
      onUpdateMessage(alvo.id, {
        // ⚠️ Recompõe com a assinatura ORIGINAL, igual ao servidor faz. Sem
        // isto a bolha ficava sem o nome logo depois de editar — batendo nem
        // com o banco nem com a tela do cliente — e só se corrigia quando o
        // realtime chegasse, que este código trata como perdível.
        content_text: assinaturaExistente(alvo.content_text) + texto,
        text_before_edit: alvo.content_text,
        edited_at: new Date().toISOString(),
      });
      toast.success(tActions("edited"));
      setEditando(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvandoEdicao(false);
    }
  }, [editando, textoEdicao, salvandoEdicao, onUpdateMessage, tActions]);

  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleChannelChange = useCallback(
    async (channelId: string | null) => {
      if (!conversation) return;

      // Escolher um canal FIXA a conversa nele; "Automático" solta o pino
      // (o channel_id fica — o próximo inbound o move, ver
      // followConversationChannel em src/lib/cb-channels/stamp.ts).
      const patch =
        channelId === null
          ? { channel_pinned: false }
          : { channel_id: channelId, channel_pinned: true };

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update channel:", error);
        toast.error(t("channelUpdateFailed"));
        return;
      }

      onChannelChange?.(conversation.id, patch);
    },
    [conversation, onChannelChange, t],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  // ⚠️ A condição era `!conversation || !contact`, e era ELA que impedia
  // qualquer conversa de grupo de abrir: grupo não tem contato (o CHECK
  // `cb_conv_contato_xor_grupo` garante um ou outro), então toda conversa de
  // grupo caía no estado vazio, como se nada estivesse selecionado. (O
  // `ehGrupo` é declarado lá em cima, junto da janela de 24h.)
  if (!conversation || (!contact && !ehGrupo)) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          {t("selectConversation")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("selectConversationHint")}
        </p>
      </div>
    );
  }

  const grupo = conversation.group ?? null;

  // ---- Por qual NÚMERO esta conversa está correndo ---------------------
  // O critério é a CONVERSA, não a conta — ver `src/lib/inbox/canais-do-fio.ts`.
  // Consts simples, não memos: são hooks proibidos daqui para baixo (o
  // `return` cedo do estado vazio já passou), e o custo é uma varredura de
  // ~200 mensagens, ao lado do `groupTimelineByDate` que já roda inline.
  const fioMisturaCanais = fioMulticanal(messages, ehGrupo);
  const coresDosCanais = coresPorCanal(channels);
  const aberturasDeTrecho = aberturasDeCanal(messages, ehGrupo);
  // A última do cliente chegou por um número e a resposta sai por outro —
  // só com a conversa FIXADA: solta, ela segue o cliente sozinha e a
  // divergência é trânsito de realtime (ver `canalDivergente`).
  // `activeChannel` nulo (canais ainda carregando) cala o aviso lá dentro.
  const corDoCanalAtivo = corDoCanal(coresDosCanais, activeChannel?.id);
  const canalDoClienteDivergente = channelsById.get(
    canalDivergente({
      messages,
      canalDeSaida: activeChannel?.id ?? null,
      ehGrupo,
      fixado: Boolean(conversation.channel_pinned),
    }) ?? "",
  );

  const displayName = ehGrupo
    ? nomeDoGrupo(grupo, t("groupNoName"))
    : nomeDoContato(contact, "");
  // Linha de baixo do cabeçalho: no 1:1 é o telefone; num grupo, quantas
  // pessoas estão nele — que é a informação equivalente ("com quem eu estou
  // falando"). Fica vazia enquanto a sincronização não trouxe o número.
  const subtituloDoCabecalho = ehGrupo
    ? grupo?.participant_count
      ? t("groupParticipants", { count: grupo.participant_count })
      : ""
    : (identidadeDoContato(contact ?? {}) ?? "");
  const messageGroups = groupTimelineByDate(
    intercalar(messages, leadEvents, notas, execucoesDoFio)
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("backToConversations")}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {/* Nome/avatar são um BOTÃO: tocar abre a ficha — no celular é a
              única porta para o painel (overlay), no desktop reabre a coluna
              fechada. O h2 ENVOLVE o botão (button é phrasing content, pode
              viver dentro de heading) — o fio mantém seu heading no outline.
              E sem `aria-label`: ele APAGAVA o nome do contato do nome
              acessível ("Exibir painel, botão" — leitor de tela sem saber com
              quem é a conversa); o conteúdo é o nome, o `title` diz a ação.
              Sem `flex-1` no h2: ele assume o papel de item de flex que o
              botão tinha (largura pelo conteúdo, encolhe via min-w-0) —
              crescer mexeria na régua do justify-between do cabeçalho. */}
          <h2 className="flex min-w-0">
          <button
            type="button"
            // ⚠️ Envolvido: passar a referência direta entregaria o EVENTO de
            // clique como se fosse o nome da aba.
            onClick={() => onOpenContactPanel?.()}
            title={t("showContact")}
            className="-m-1 flex min-w-0 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-muted/60 sm:gap-3"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <span className="block min-w-0">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                {ehGrupo && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{displayName}</span>
              </span>
              {subtituloDoCabecalho && (
                <span className="block truncate text-xs text-muted-foreground">
                  {subtituloDoCabecalho}
                </span>
              )}
            </span>
          </button>
          </h2>
          {/* Copiar o link da conversa — IRMÃO do botão do nome (button
              dentro de button é HTML inválido). O círculo maior fica no
              painel; este é o atalho para quando o painel está fechado. */}
          {conversation && (
            <CopiarLinkDaConversa
              conversationId={conversation.id}
              className="ml-0.5 hidden sm:inline-flex"
            />
          )}
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. Canal Evolution não
              tem janela de 24h, então o cronômetro some. */}
          {janelaDe24h && (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",
                sessionInfo.expired ? "text-red-400" : "text-primary"
              )}
            >
              <Clock className="h-3 w-3" />
              {sessionInfo.remaining}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* O toggle do painel de contato MORAVA aqui (#258) e saiu de
              propósito: ficava do outro lado de quatro controles, longe do
              painel que controla. Hoje fechar mora no cabeçalho do próprio
              painel e reabrir na tira fina da borda direita (inbox/page). */}

          {/* Quem MAIS está com esta conversa aberta (963) — some quando
              ninguém, que é o dia inteiro numa conta de um membro só. */}
          <AvataresNaConversa userIds={vendoAgora} profiles={profiles} />

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {/* A lupa: busca DENTRO desta conversa (09/09/2026). Fica acesa
              enquanto a barra está aberta; clicar de novo fecha. */}
          {conversation && (
            <button
              type="button"
              onClick={alternarBuscaLocal}
              aria-label={t("searchOpen")}
              aria-pressed={buscaLocalAberta}
              title={t("searchOpen")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
                buscaLocalAberta
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t("refreshConversation")}
              title={t("refresh")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Seletor de canal — só quando a conta tem 2+ números. Escolher
              fixa a conversa no canal; "Automático" volta a seguir o número
              que o cliente usou por último. */}
          {channels.length >= 2 && activeChannel && (
            <DropdownMenu>
              <DropdownMenuTrigger
                title={t("channelTitle")}
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  conversation.channel_pinned
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                {/* A bolinha da COR do canal ocupa o lugar que era do ícone
                    de transporte. O transporte segue no menu, onde há espaço:
                    numa conta 100% Evolution aquele ícone é o mesmo em todas
                    as linhas e não informa nada, enquanto a cor é o que amarra
                    este gatilho aos rótulos das bolhas logo abaixo. Sempre
                    resolve: `activeChannel` é um elemento de `channels`, e
                    `coresPorCanal` dá cor a todos eles. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    corDoCanalAtivo?.ponto,
                  )}
                />
                <span className="hidden max-w-[8rem] truncate sm:inline">
                  {activeChannel.label}
                </span>
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-popover">
                {channels.map((c) => {
                  const isSelected =
                    Boolean(conversation.channel_pinned) &&
                    c.id === activeChannel.id;
                  return (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => handleChannelChange(c.id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mr-2 h-2 w-2 shrink-0 rounded-full",
                          corDoCanal(coresDosCanais, c.id)?.ponto,
                        )}
                      />
                      <IconeDoTransporte kind={c.kind} className="mr-2 h-3.5 w-3.5" />
                      <span className="flex-1">{c.label}</span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={() => handleChannelChange(null)}
                  className={cn(
                    "text-sm",
                    conversation.channel_pinned
                      ? "text-muted-foreground"
                      : "text-primary",
                  )}
                >
                  <span className="flex-1">{t("channelAuto")}</span>
                  {!conversation.channel_pinned && (
                    <Check className="ml-2 h-3 w-3" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Status dropdown — escondido em grupo. Aberta/pendente/encerrada
              descreve um ATENDIMENTO, que começa e termina; um grupo não
              fecha. A conversa continua com `status='open'` no banco (a
              coluna é NOT NULL), só não se oferece o controle. */}
          {!ehGrupo && (
          <DropdownMenu>
            {/* Pastilha PREENCHIDA, não texto colorido (pedido do operador,
                2026-09-03): a situação é o que mais muda de conversa para
                conversa, e um texto de 12px em cor só não se destacava dos
                outros controles da linha. A cor sai de `STATUS_OPTIONS`. */}
            <DropdownMenuTrigger className={cn(
                  "inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
                  currentStatus?.pill ?? "bg-muted text-muted-foreground"
                )}>
                <span className={cn("h-2 w-2 rounded-full", currentStatus?.dot ?? "bg-muted-foreground")} />
                {currentStatus ? t(`status${currentStatus.label}`) : t("status")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {t(`status${opt.label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          )}

          {/* O menu de ATRIBUIÇÃO morou aqui até 2026-09-03 e foi para o
              cabeçalho do painel lateral (`painel/responsavel-menu.tsx`), a
              pedido do operador: esta linha fica com a conexão e a situação.
              `onAssignChange` continua sendo chamado daqui pelo caminho de
              SITUAÇÃO (encerrar solta o responsável — `patchDeSituacao`). */}
        </div>
      </div>

      {/* Anotação fixada (951) — presa logo abaixo do cabeçalho, ACIMA da
          faixa da busca: esta é permanente e a da busca é passageira, então
          é esta que tem de ficar sempre no mesmo lugar. */}
      {notaFixada && (
        <NotaFixadaBar
          key={notaFixada.id}
          nota={notaFixada}
          onDesafixar={() => void fixarNota(notaFixada, false)}
          desafixando={fixando === notaFixada.id}
        />
      )}

      {/* Faixa do salto da busca.
          ⚠️ Só aparece com achado NESTE fio. Uma conversa pode ter entrado no
          resultado pelo nome do contato, sem nenhuma mensagem casando — e uma
          faixa dizendo "0 de 0" ali seria pior que faixa nenhuma. É também
          onde a divergência improvável entre o banco e o JS (caractere exótico
          que o `unaccent` do Postgres trate diferente) falha para o lado
          silencioso, em vez de mostrar um contador zerado. */}
      {/* A busca DENTRO desta conversa — a barra que a lupa do cabeçalho
          abre. SUBSTITUI a faixa da busca da lista enquanto estiver aberta:
          as duas contam achados do MESMO fio, e duas contagens lado a lado
          diriam coisas diferentes sobre a mesma tela. Enter anda para o
          achado mais ANTIGO (o fio abre no mais recente, então "próximo" é
          para cima), Shift+Enter volta, Esc fecha. */}
      {buscaLocalAberta && buscaLocal && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={buscaLocal.termo}
            onChange={(e) =>
              setBuscaLocal({
                conversationId: buscaLocal.conversationId,
                termo: e.target.value,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setBuscaLocal(null);
              } else if (e.key === "Enter") {
                e.preventDefault();
                irParaAchado(e.shiftKey ? 1 : -1);
              }
            }}
            placeholder={t("searchLocalPlaceholder")}
            aria-label={t("searchOpen")}
            autoFocus
            className="h-7 flex-1 bg-background md:text-xs"
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {termoLocalCurto
              ? t("searchLocalMinChars", { n: TERMO_MINIMO })
              : achadosNoFio.length === 0
                ? t("searchLocalNone")
                : t("searchLocalCount", {
                    atual: posicaoDoAlvo + 1,
                    total: achadosNoFio.length,
                  })}
          </span>
          <button
            type="button"
            onClick={() => irParaAchado(-1)}
            disabled={posicaoDoAlvo <= 0}
            aria-label={t("searchPrevHit")}
            title={t("searchPrevHit")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => irParaAchado(1)}
            disabled={posicaoDoAlvo >= achadosNoFio.length - 1}
            aria-label={t("searchNextHit")}
            title={t("searchNextHit")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setBuscaLocal(null)}
            aria-label={t("searchClose")}
            title={t("searchClose")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!buscaLocalAberta && achadosNoFio.length > 0 && alvoId && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("searchInThread", {
              termo: termoEfetivo,
              atual: posicaoDoAlvo + 1,
              total: achadosNoFio.length,
            })}
          </p>
          {/* ⚠️ Desabilitados nas pontas, e é assim que "não dá a volta" fica
              garantido na tela: um botão que sempre responde faria o operador
              acreditar que ainda há achados adiante. */}
          <button
            type="button"
            onClick={() => irParaAchado(-1)}
            disabled={posicaoDoAlvo <= 0}
            aria-label={t("searchPrevHit")}
            title={t("searchPrevHit")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => irParaAchado(1)}
            disabled={posicaoDoAlvo >= achadosNoFio.length - 1}
            aria-label={t("searchNextHit")}
            title={t("searchNextHit")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Messages Area */}
      {/* ⚠️ Rolar à mão TAMBÉM é agir, e sem isto o salto da busca vira uma
          coleira: medido, o operador saltava para o achado, subia para ler o
          contexto em volta, e a chegada de mensagem nova (que troca
          `messages`) o arrastava de volta ao achado. "Enviar" e "anotar" já
          soltavam a rolagem; ler não soltava.

          ⚠️ `onWheel`/`onTouchMove`, NUNCA `onScroll`: o `scroll` não
          distingue quem rolou — o próprio efeito que centraliza escreve
          `scrollTop` e dispara um, então a coleira se soltaria sozinha no
          primeiro salto. Estes dois só existem quando há roda ou dedo.

          ⚠️ E aqui na JSX, não num `addEventListener` dentro de efeito. Este
          contêiner só existe DEPOIS de haver conversa aberta; um efeito com
          dependência estável roda uma vez, com `scrollRef.current` ainda nulo,
          e não volta mais — o ouvinte nunca chegava a ser pendurado. Foi assim
          que a primeira versão desta correção passou em revisão e falhou na
          medição.

          As setas continuam mandando: elas trocam o `alvoId`, e o efeito que
          re-arma o salto dispara com isso. */}
      {/* ⚠️ `onScroll` acompanha o `onWheel`/`onTouchMove` acima, mas responde
          outra pergunta. Aqueles captam INTENÇÃO do operador (soltam o salto da
          busca) e por isso ignoram rolagem programática. Este só ANOTA onde a
          rolagem parou, venha de onde vier — teclado, barra, inércia do
          trackpad —, porque é o que diz ao auto-scroll se ele pode agir. */}
      <div
        ref={scrollRef}
        onWheel={liberarSalto}
        onTouchMove={liberarSalto}
        onScroll={anotarPosicao}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : /* `messageGroups`, não `messages`: uma conversa sem mensagem mas
              com evento de funil registrado mostraria "nenhuma mensagem" e
              engoliria o evento. */
        messageGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">{t("noMessagesYet")}</p>
            <p className="text-xs text-muted-foreground">
              {t("sendTemplateHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date, t)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.itens.map((item) => {
                    // Evento da trilha do lead — aviso de sistema, não
                    // mensagem: sem bolha, sem ações, sem reação.
                    if (item.evento) {
                      return <LeadEventLine key={item.chave} evento={item.evento} />;
                    }
                    // Execução de automação encerrada (985) — como o evento do
                    // lead, é aviso de sistema: sem bolha, sem ações, sem
                    // reação. Precisa vir ANTES do `item.mensagem!` lá embaixo,
                    // pelo mesmo motivo que a nota: aquele `!` desliga a
                    // checagem e um item de execução derrubaria o fio.
                    if (item.execucao) {
                      return (
                        <AvisoDeExecucao
                          key={item.chave}
                          item={item.execucao}
                          aoAbrirDetalhes={
                            onOpenContactPanel
                              ? () => onOpenContactPanel('automacoes')
                              : undefined
                          }
                        />
                      );
                    }
                    // ⚠️ A anotação interna tem de ser tratada AQUI, antes do
                    // `item.mensagem!` logo abaixo. Aquele `!` desliga a
                    // checagem do TypeScript, então um item de nota cairia no
                    // ramo de mensagem e derrubaria o fio inteiro em runtime.
                    if (item.nota) {
                      return (
                        <LinhaDoFio
                          key={item.chave}
                          tipo="nota"
                          id={item.nota.id}
                          destacada={
                            destaqueDoPainel?.tipo === "nota" &&
                            destaqueDoPainel.id === item.nota.id
                          }
                        >
                        <NoteLine
                          nota={item.nota}
                          podeApagar={
                            item.nota.author_user_id === user?.id || podeAdministrar
                          }
                          onApagar={handleApagarNota}
                          fixada={Boolean(item.nota.fixada_em)}
                          fixando={fixando === item.nota.id}
                          // Nota de grupo não fixa (sem contato, fora do
                          // índice da 951): sem `onFixar`, o alfinete nem
                          // aparece. Fixar é de quem anota — viewer incluso,
                          // como no painel: a rota é quem decide.
                          onFixar={
                            item.nota.contact_id
                              ? (fixar) => void fixarNota(item.nota!, fixar)
                              : undefined
                          }
                        />
                        </LinhaDoFio>
                      );
                    }
                    const msg = item.mensagem!;
                    // Aviso do WhatsApp dentro do grupo ("Fulano entrou").
                    // Mesmo tratamento do evento de lead logo acima: a bolha
                    // se desenha sozinha como faixa, e NÃO passa pelo
                    // MessageActions — responder, reagir ou apagar um aviso
                    // do sistema não quer dizer nada.
                    const destacada =
                      msg.id === alvoId ||
                      destaqueDaCitacao?.id === msg.id ||
                      (destaqueDoPainel?.tipo === "mensagem" &&
                        destaqueDoPainel.id === msg.id);
                    if (msg.content_type === "system") {
                      return (
                        <LinhaDoFio
                          key={msg.id}
                          id={msg.id}
                          destacada={destacada}
                        >
                          <MessageBubble message={msg} emGrupo />
                        </LinhaDoFio>
                      );
                    }
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel:
                            parent.sender_type === "agent" || parent.sender_type === "bot"
                              ? t("me")
                              // Em grupo o autor citado é o participante.
                              // Sem isto, citar qualquer um mostrava o
                              // literal "Unknown" — texto fixo em inglês.
                              : parent.group_sender_name ||
                                nomeDoContato(contact, t("unknownAuthor")),
                          preview: buildReplyPreview(parent, tQuote),
                          id: parent.id,
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Canal desta mensagem — só quando a CONVERSA mistura
                    // conexões. Canal que não resolve (apagado, ou lista
                    // ainda carregando) não vira rótulo: uma cor de queda
                    // afirmaria um número que ninguém sabe qual é.
                    const canalDaMsg = fioMisturaCanais
                      ? (channelsById.get(msg.channel_id ?? "") ?? null)
                      : null;
                    const corDaMsg = corDoCanal(coresDosCanais, canalDaMsg?.id);
                    // Esta mensagem ABRE um trecho de outro número?
                    const canalQueAbre =
                      channelsById.get(aberturasDeTrecho.get(msg.id) ?? "") ?? null;
                    const corQueAbre = corDoCanal(coresDosCanais, canalQueAbre?.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <Fragment key={msg.id}>
                      {canalQueAbre && corQueAbre && (
                        <SeparadorDeCanal
                          nome={canalQueAbre.label}
                          cor={corQueAbre}
                          rotulo={t("channelSectionLabel", {
                            channel: canalQueAbre.label,
                          })}
                        />
                      )}
                      <LinhaDoFio
                        id={msg.id}
                        destacada={destacada}
                      >
                      <MessageActions
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                        channelKind={activeChannel?.kind ?? null}
                        onDelete={() => void apagarMensagem(msg)}
                        onEdit={() => setEditando(msg)}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                          canal={
                            canalDaMsg && corDaMsg
                              ? { label: canalDaMsg.label, cor: corDaMsg }
                              : null
                          }
                          emGrupo={ehGrupo}
                          baixandoAnexo={anexoEmCurso === msg.id}
                          onBaixarAnexo={() => baixarAnexoDoGrupo(msg.id)}
                          onAbrirGaleria={setGaleriaAbertaEm}
                          onIrParaCitada={irParaCitada}
                        />
                      </MessageActions>
                      </LinhaDoFio>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* "N mensagens não lidas" — só existe quando o operador rolou para
            cima e o cliente escreveu enquanto isso (`naoLidasAbaixo`). É o
            ÚLTIMO filho do contêiner de rolagem e `sticky bottom`: gruda no
            rodapé da área visível enquanto há o que ler embaixo e, no fim,
            deixa de existir — sem embrulhar o contêiner em mais um `relative`
            (o fio é uma coluna flex com `min-h-0`, e cada invólucro novo ali
            já custou barra de rolagem escondida — ver CLAUDE.md). */}
        {naoLidasAbaixo > 0 && (
          <div className="pointer-events-none sticky bottom-2 z-10 flex justify-center">
            <button
              type="button"
              onClick={irParaOFim}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md hover:bg-primary/90"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {t("naoLidasAbaixo", { count: naoLidasAbaixo })}
            </button>
          </div>
        )}
      </div>

      {/* AI auto-reply banner — take over an active bot, or resume it
          after a handoff. Renders nothing unless the account has
          auto-reply configured. */}
      {/* IA não atua em grupo (906). O `/api/ai/autoreply` recusa com 400;
          esconder a faixa evita oferecer um controle que só daria erro. */}
      {!ehGrupo && (
      <AiThreadBanner
        conversationId={conversation.id}
        disabled={conversation.ai_autoreply_disabled ?? false}
        handoffSummary={conversation.ai_handoff_summary}
        assignedAgentId={assignedAgentId}
        currentUserId={user?.id}
        onChange={(patch) => {
          if ("assigned_agent_id" in patch) {
            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);
          }
        }}
      />
      )}

      {/* Overlay de tela cheia — só monta com um anexo aberto. */}
      <GaleriaDoFio
        messages={messages}
        abertaEm={galeriaAbertaEm}
        onIrPara={setGaleriaAbertaEm}
        onFechar={() => setGaleriaAbertaEm(null)}
      />

      {/* Faixa INADIMPLENTE (Asaas, Fase 1b), acima da de agendadas e pelo
          mesmo motivo de morar no fio: quem vai escrever precisa esbarrar
          nela antes. Cala com `null` — nunca afirma "em dia". */}
      <FaixaDeInadimplencia
        divida={dividaDoAsaas}
        atualizadoEm={inadimplencia?.atualizadoEm ?? null}
        leituraFresca={inadimplencia?.leituraFresca === true}
        aoVerCobrancas={onOpenContactPanel ? () => onOpenContactPanel("cobrancas") : undefined}
      />

      {/* Faixa AGENDADAS (925), colada no compositor e dentro do fio.
          ⚠️ Fica AQUI, e não na ficha lateral: quem abre a conversa precisa
          esbarrar no que já está marcado ANTES de escrever, senão escreve
          por cima e o cliente recebe duas. Some sozinha quando não há fila. */}
      <ScheduledBar
        conversationId={conversation.id}
        podeAgir={podeEnviar}
        resyncToken={agendadasResync}
      />

      {/* ⚠️ A última mensagem do cliente chegou por um NÚMERO e a resposta
          vai sair por OUTRO — o que, no celular dele, quer dizer que a
          resposta cai numa conversa diferente daquela em que ele perguntou.
          Não há nada na tela que denuncie isso hoje: o seletor do cabeçalho
          mostra o canal de SAÍDA e fica no canto oposto ao da caixa de
          texto.

          Fica colado no compositor de propósito — é o último lugar por onde
          o olho passa antes de digitar. Informativo, não bloqueante: com 2
          casos em 90 conversas, confirmar a cada envio custaria um clique
          em toda conversa mista para prevenir um erro que a faixa já torna
          visível.

          Só aparece com a conversa FIXADA no seletor. Solta, ela segue o
          cliente sozinha, e o aviso piscaria a cada troca legítima (a
          mensagem chega por realtime ANTES do UPDATE da conversa) — pior,
          o botão clicado nesse instante fixaria o número e desligaria o
          seguimento em silêncio (Codex, PR #105).

          O botão re-FIXA a conversa no número do cliente (o mesmo que
          escolher no seletor). "Automático" segue no menu para soltar. */}
      {canalDoClienteDivergente && (
        <div className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <CornerUpLeft
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <span className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
            {t("channelMismatch", { channel: canalDoClienteDivergente.label })}
          </span>
          <button
            type="button"
            onClick={() =>
              void handleChannelChange(canalDoClienteDivergente.id)
            }
            className="shrink-0 rounded-md border border-amber-600/40 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            {t("channelMismatchAction")}
          </button>
        </div>
      )}

      {/* Composer — canal Evolution não tem janela de 24h (sessionExpired
          neutralizado) nem templates/interativas (channelKind esconde). */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={janelaDe24h ? sessionInfo.expired : false}
        channelKind={activeChannel?.kind ?? null}
        transporteConhecido={!canaisCarregando && !canaisFalharam}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        // ⚠️ O `idQueSaiu` chega do envio da fila de anexos, que termina
        // segundos depois do clique: comparar DENTRO do updater usa o estado
        // mais fresco e não deixa janela para apagar a citação que o operador
        // escolheu enquanto os anexos subiam (Codex, PR #149).
        onClearReply={(idQueSaiu) =>
          setReplyTo((atual) =>
            // `typeof` e não `!== undefined`: quem passar esta função direto
            // para um `onClick` mandaria o MouseEvent aqui, e a comparação
            // silenciosa deixaria o botão de fechar a citação sem efeito.
            typeof idQueSaiu !== "string" || atual?.id === idQueSaiu ? null : atual,
          )
        }
        onNoteCreated={acrescentarNotaDaConversa}
        onScheduled={() => setAgendadasResync((n) => n + 1)}
        onExecutarAutomacao={
          !ehGrupo && contact ? () => setExecutarAberto(true) : undefined
        }
      />

      {/* Popup de executar automação/robô (955) — mora AQUI, e não no
          compositor, porque é o fio que tem contato e canal resolvido.
          Grupo fica de fora: automação não roda em grupo (906). */}
      {!ehGrupo && contact && (
        <ExecutarAutomacaoDialog
          open={executarAberto}
          onOpenChange={setExecutarAberto}
          conversationId={conversation.id}
          contactName={nomeDoContato(contact, "")}
          // ⚠️ O canal CRU da conversa, não o `activeChannel` (que cai no
          // padrão da conta): a rota decide pelo cru com falha ABERTA —
          // conversa sem canal deixa passar. Com o padrão aqui, uma
          // automação restrita ao número B aparecia desabilitada numa
          // conversa sem canal cujo padrão é A, enquanto o servidor a
          // aceitaria (ledger 48h). O dialog não desabilita nada quando o
          // canal é nulo — o mesmo fail-open, nas duas camadas.
          channelId={conversation.channel_id ?? null}
        />
      )}

      {/* Diálogo de edição. O WhatsApp só permite editar por ~15 minutos;
          passado isso o botão nem aparece, e a rota recusa mesmo assim. */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tActions("editTitle")}</DialogTitle>
          </DialogHeader>
          <textarea
            value={textoEdicao}
            onChange={(e) => setTextoEdicao(e.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              {tActions("cancel")}
            </Button>
            <Button
              onClick={() => void salvarEdicao()}
              disabled={!textoEdicao.trim() || salvandoEdicao}
            >
              {tActions("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        channelId={activeChannel?.id ?? null}
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
