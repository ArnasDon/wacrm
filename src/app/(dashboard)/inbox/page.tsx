"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation, Message, Contact, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMarcarConversaAberta } from "@/hooks/use-conversa-aberta";
import { useInadimplencia } from "@/hooks/use-inadimplencia";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ConversaForaDaArea } from "@/components/inbox/conversa-fora-da-area";
import { useAuth } from "@/hooks/use-auth";
import { conversaNoEscopo } from "@/lib/perfis/escopo";
import { MessageThread } from "@/components/inbox/message-thread";
import { VoltarAoFunil } from "@/components/inbox/voltar-ao-funil";
import { urlDoInbox } from "@/lib/inbox/url";
import {
  novoPedidoDeSalto,
  type AlvoDoSalto,
  type PedidoDeSalto,
} from "@/lib/inbox/salto-no-fio";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { GroupSidebar } from "@/components/inbox/group-sidebar";
import { toast } from "sonner";
import { WifiOff, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const t = useTranslations("Inbox.page");
  // Rótulos do abrir/fechar do painel — as chaves moram no namespace do fio
  // porque o botão nasceu lá (issue #258); o botão mudou de casa, as chaves
  // ficaram.
  const tThread = useTranslations("Inbox.messageThread");
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");
  /**
   * `?etapa=<stageId>` — porta de entrada do botão da coluna do funil.
   * Semeia o filtro de etapa da lista UMA vez (no estado inicial dela); NÃO
   * é preservada nos replaces, de propósito: preservar faria o filtro que o
   * operador limpou no painel voltar no reload (ver `urlDoInbox`).
   *
   * `?de=funil` liga a faixa "Voltar ao funil" e ESSE sobrevive aos
   * replaces — relido aqui a cada render e reescrito por `urlDoInbox`.
   */
  const etapaInicial = searchParams.get("etapa");
  // Só o valor com leitor viaja adiante: `urlDoInbox` também recusa outros,
  // mas sanear aqui evita que um `de=` estranho de link colado circule.
  const de = searchParams.get("de") === "funil" ? "funil" : null;
  const veioDoFunil = de === "funil";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Recorte por perfil (Fase 3). A LINHA aparece na lista (a busca acha
  // conversa de outra área); ABRIR é que rende o cartão amigável no lugar do
  // fio. Derivado, nunca estado: a seleção pode chegar por clique, por deep
  // link (?conversation=) ou por URL colada, e todas caem aqui.
  const { acesso } = useAuth();
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  // Presença por conversa (963): marca no banco qual conversa ESTE membro
  // está vendo — a página é a dona da seleção, então o escritor mora aqui.
  useMarcarConversaAberta(activeConversation?.id ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  /**
   * De QUAL conversa é o array `messages` acima. `null` = ainda não chegou.
   *
   * ⚠️ Existe porque `messages` vazio tem DOIS significados — "ainda estou
   * carregando" e "esta conversa não tem nada" — e a aba Arquivos do painel
   * converte o segundo numa AFIRMAÇÃO ("Nenhum arquivo nesta conversa"). Sem
   * esta régua, abrir uma conversa com 93 documentos exibia essa frase por um
   * segundo, que é a mesma família de defeito da badge "Expirada" nascendo de
   * `useChannels` ainda vazio. O fio não sofre disso porque tem `loading`
   * próprio; o painel é irmão dele, não filho, e não enxerga esse estado.
   *
   * ⚠️ Busca que FALHA deixa isto nulo, e a aba fica no spinner. É a escolha
   * deliberada entre as duas respostas erradas possíveis: "espere" não afirma
   * nada, "nenhum arquivo" afirmaria. E se resolve sozinho — o primeiro
   * resync (voltar para a aba, realtime reconectar, o botão atualizar)
   * recarrega e carimba. Não há canal de erro aqui porque o próprio fio não
   * tem: em falha ele também cai no estado vazio.
   */
  const [messagesDaConversa, setMessagesDaConversa] = useState<string | null>(
    null
  );
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);
  /**
   * Quem está INADIMPLENTE no Asaas (Fase 1b): UMA leitura para a lista
   * (ícone e filtro) e para o fio (a faixa), que são irmãos — a página é o
   * único caminho entre eles. `null` = não sei; nada afirma "em dia".
   */
  const { resumo: inadimplencia } = useInadimplencia(resyncToken);

  /**
   * O termo da busca, espelhado da lista para o fio.
   *
   * ⚠️ A caixa de busca é da LISTA e continua sendo; esta página só repassa. O
   * fio precisa do termo para rolar até a mensagem que casou e destacá-la — e
   * lista e fio são irmãos, então a página é o único caminho entre eles. É o
   * termo já assentado (300 ms de espera + piso de 3 letras), não o texto cru
   * da caixa: com o texto cru, esta página re-renderizaria — e o fio junto — a
   * cada tecla digitada.
   */
  const [termoDaBusca, setTermoDaBusca] = useState("");

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  /**
   * Superfície MOBILE do painel (<lg): overlay que desliza da direita,
   * aberto tocando no nome/avatar no cabeçalho do fio — o padrão do
   * WhatsApp. Estado PRÓPRIO, sempre nascendo fechado e sem persistência:
   * o `contactPanelOpen` do desktop persiste aberto por padrão, e no
   * celular isso significaria a ficha cobrindo o fio inteiro a cada
   * conversa aberta.
   *
   * O breakpoint decide qual dos dois estados governa o `inert` e o botão
   * de fechar — e é `64rem`, NÃO `1024px`, de propósito: o `lg:` das
   * classes deste arquivo é o `--breakpoint-lg: 64rem` do Tailwind v4, e
   * `rem` em media query segue o tamanho de fonte PADRÃO do navegador
   * (ajuste de acessibilidade). Com `1024px` aqui, um operador com fonte
   * grande a 1100px de janela ficava com o CSS no modo mobile e o JS no
   * modo desktop: tocar no nome não abria nada e o `inert` liberava Tab
   * para um painel invisível. Em fonte padrão (16px), 64rem = 1024px.
   */
  const ehDesktop = useMediaQuery("(min-width: 64rem)");
  const [painelMobileAberto, setPainelMobileAberto] = useState(false);

  /**
   * O overlay mobile é MODAL, e modal de verdade inclui o teclado: abrir o
   * painel move o foco para dentro dele, e a lista + o fio ficam `inert`
   * enquanto ele cobre a tela — sem isto, Tab passeava pelos controles do
   * inbox escondidos atrás do backdrop antes de alcançar a ficha. Fechar
   * devolve o foco sozinho: o painel vira `inert` e o navegador o solta.
   * (A navegação do layout, fora desta página, fica de fora do cerco.)
   */
  const painelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ehDesktop && painelMobileAberto) painelRef.current?.focus();
  }, [ehDesktop, painelMobileAberto]);
  const fundoInerte = !ehDesktop && painelMobileAberto;

  const handleToggleContactPanel = useCallback(() => {
    if (!ehDesktop) {
      setPainelMobileAberto((prev) => !prev);
      return;
    }
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, [ehDesktop]);

  // Abrir a ficha pelo cabeçalho do fio. No desktop também vale (clicar no
  // nome com o painel já aberto é no-op) — o gesto fica idêntico nas duas
  // superfícies.
  /** Aba que o fio pediu (985) — o cartão de falha leva às execuções. */
  const [abaDoPainel, setAbaDoPainel] = useState<string | null>(null);

  const handleAbrirPainelDoContato = useCallback((aba?: string) => {
    // ⚠️ Setar a aba ANTES de abrir: no desktop o painel já está aberto e o
    // `setContactPanelOpen(true)` é no-op — era por isso que "Ver execuções"
    // não fazia nada no caso mais comum (achado da revisão, 09/09).
    setAbaDoPainel(aba ?? null);
    if (ehDesktop) {
      setContactPanelOpen(true);
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, "true");
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return;
    }
    setPainelMobileAberto(true);
  }, [ehDesktop]);

  /**
   * "Ver na conversa" das abas Notas e Arquivos (09/09/2026). O painel e o
   * fio são irmãos, e a página é o único caminho entre eles — o mesmo
   * motivo do `termoDaBusca`. O pedido vai carimbado com a conversa e um
   * contador (ver `salto-no-fio.ts`): o fio só atende pedido DESTA conversa,
   * e o mesmo anexo clicado duas vezes rola duas vezes.
   */
  const [saltoPedido, setSaltoPedido] = useState<PedidoDeSalto | null>(null);
  const handleIrParaItemDoFio = useCallback(
    (alvo: AlvoDoSalto) => {
      const conversaId = activeConversation?.id;
      if (!conversaId) return;
      setSaltoPedido((prev) => novoPedidoDeSalto(prev, conversaId, alvo));
      // No celular o painel é overlay SOBRE o fio: fechá-lo é o que deixa o
      // salto à vista. No desktop já está fechado, e isto é no-op.
      setPainelMobileAberto(false);
    },
    [activeConversation?.id],
  );

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);
  /**
   * Conversa que o botão "nova conversa" acabou de abrir, esperando a lista
   * chegar com ela dentro.
   *
   * ⚠️ Existe porque depender do `?c=` aqui é uma CORRIDA: o refetch e o
   * `router.replace` saem juntos, e se a consulta voltar antes de a
   * navegação propagar os searchParams, `deepLinkConvId` ainda tem o valor
   * ANTIGO e a conversa nova não é selecionada. Pior, nada se recupera
   * depois — o efeito da lista só reage a `resyncToken`, então a URL fica
   * apontando para a conversa nova com o centro vazio até o próximo resync.
   * A ref não corre contra nada. (Achado do Codex na revisão do PR #79.)
   */
  const conversaRecemAbertaRef = useRef<string | null>(null);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error("Failed to hydrate conversation:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c,
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      // Multi-canal (Fase 5): conectado se QUALQUER canal está conectado.
      // Contas sem canais (pré-migration) caem no whatsapp_config, como antes.
      try {
        const res = await fetch("/api/cb/channels");
        if (res.ok) {
          const payload = await res.json();
          const channels = (payload.channels ?? []) as { status?: string }[];
          if (channels.length > 0) {
            setWhatsappConnected(channels.some((c) => c.status === "connected"));
            return;
          }
        }
      } catch {
        // silencioso — cai no caminho legado abaixo
      }

      const { data } = await supabase
        .from("whatsapp_config")
        .select("status")
        .eq("account_id", accountId)
        .maybeSingle();

      setWhatsappConnected(data?.status === "connected");
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith("temp-")
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c,
            ),
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === "INSERT") {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === "UPDATE") {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  /**
   * O botão "nova conversa" da lista acabou de abrir uma conversa no banco.
   *
   * Duas coisas, e as duas são necessárias: a conversa nasceu DEPOIS da
   * última carga, então não está em `conversations` — o `resyncToken` força
   * a lista a buscar de novo; e o `?c=` é o mesmo deep link que o painel e
   * as notificações usam, que seleciona o fio assim que a lista chega com
   * ele dentro. Só navegar deixaria a URL apontando para uma conversa que a
   * lista não conhece, e o centro ficaria vazio.
   */
  const handleConversaAberta = useCallback(
    (conversationId: string) => {
      conversaRecemAbertaRef.current = conversationId;
      setResyncToken((t) => t + 1);
      router.replace(urlDoInbox({ c: conversationId, de }));
    },
    [router, de],
  );

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);

      // A conversa que acabou de ser aberta pelo botão. Vem antes do deep
      // link e não olha a URL — ver `conversaRecemAbertaRef`. Só limpa a ref
      // quando de fato encontra a linha: se esta carga saiu antes de a
      // conversa existir, a próxima resolve.
      const recemAberta = conversaRecemAbertaRef.current;
      if (recemAberta) {
        const nova = loaded.find((c) => c.id === recemAberta);
        if (nova) {
          conversaRecemAbertaRef.current = null;
          // Marca o deep link como já consumido: a URL aponta para esta
          // mesma conversa, e sem isto o bloco abaixo a reaplicaria,
          // zerando `messages` de um fio que o MessageThread já carregou.
          autoSelectedForDeepLinkRef.current = recemAberta;
          setActiveConversation(nova);
          setActiveContact(nova.contact ?? null);
          setMessages([]);
          setMessagesDaConversa(null);
          return;
        }
      }
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. because the user clicked it in the list and we
        // router.replace()'d the URL, which made the ConversationList
        // refetch and land us back here), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          setMessagesDaConversa(null);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          // ⚠️ MESMA guarda de escopo do clique (Fase 3): deep link de
          // notificação pode apontar conversa de outra área — o fio não
          // monta, o servidor não zera, e zerar só o espelho local mentiria
          // "lida" até o próximo reload. Achado da revisão fria.
          if (conversaNoEscopo(acesso, match) && match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c,
              ),
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id, acesso]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      const bloqueadaAoSelecionar = !conversaNoEscopo(acesso, conv);
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      setMessagesDaConversa(null);
      // Trocar de conversa fecha o overlay mobile — a ficha aberta é da
      // conversa anterior, e no celular ela cobriria o fio novo.
      setPainelMobileAberto(false);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      // ⚠️ Conversa fora do perfil NÃO zera o contador — nem aqui nem no
      // servidor (o reset de verdade mora no MessageThread, que não monta
      // para ela). Zerar só o espelho local mentiria "lida" numa conversa
      // que ninguém leu, até o próximo reload desmentir.
      if (!bloqueadaAoSelecionar) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conv.id && c.unread_count > 0
              ? { ...c, unread_count: 0 }
              : c,
          ),
        );
      }
      // Record the selection on the deep-link ref BEFORE we change the
      // URL. The router.replace below flips `deepLinkConvId`, which can
      // in turn cause ConversationList to refetch and eventually call
      // handleConversationsLoaded again. Without this line, the ref
      // still points at the previous value, the auto-select block
      // sees `ref !== deepLinkConvId`, fires a second time, and
      // clobbers the messages MessageThread just fetched.
      autoSelectedForDeepLinkRef.current = conv.id;
      // ⚠️ E CANCELA a abertura pendente do botão "nova conversa". A ref não
      // olha a URL de propósito (é o que a torna imune à corrida do `?c=`),
      // então ela também não percebe um clique explícito: com o refetch ainda
      // no ar, `handleConversationsLoaded` selecionava a conversa recém-criada
      // por cima da que o operador acabou de escolher — e o `router.replace`
      // deste clique já tinha escrito a OUTRA na URL, deixando fio e endereço
      // discordando (um F5 trocava a conversa de novo). A escolha explícita
      // manda. (Achado do Codex na revisão do PR #80.)
      conversaRecemAbertaRef.current = null;
      // Reflect the selection in the URL so a refresh lands the user
      // back in the same thread, and so copy-paste links work. Use
      // replace() to avoid polluting browser history with every click.
      // `urlDoInbox` reescreve o `de=funil` vigente — sem isso, o primeiro
      // clique numa conversa apagava a faixa "Voltar ao funil".
      router.replace(urlDoInbox({ c: conv.id, de }), { scroll: false });
    },
    [activeConversation?.id, router, de, acesso]
  );

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    setMessagesDaConversa(null);
    setPainelMobileAberto(false);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    // Voltar também cancela a abertura pendente, pelo mesmo motivo do clique
    // explícito: sem isto, o fio que o operador acabou de fechar reabria
    // sozinho quando o refetch chegasse — no celular, por cima da lista.
    conversaRecemAbertaRef.current = null;
    router.replace(urlDoInbox({ de }), { scroll: false });
  }, [router, de]);


  const handleMessagesLoaded = useCallback(
    (loaded: Message[]) => {
      setMessages(loaded);
      // Carimba de quem é o array. O fio só chama isto quando a busca NÃO foi
      // cancelada, ou seja, quando ela ainda é da conversa aberta — por isso
      // dá para ler o id do estado da página em vez de o fio precisar mandá-lo.
      setMessagesDaConversa(activeConversation?.id ?? null);
    },
    [activeConversation?.id]
  );

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // Multi-canal: o thread já gravou {channel_id, channel_pinned} no banco;
  // aqui só espelhamos no estado (mesmo padrão do status/assign).
  const handleChannelChange = useCallback(
    (
      conversationId: string,
      patch: { channel_id?: string; channel_pinned: boolean }
    ) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, ...patch } : prev));
      }
    },
    [activeConversation]
  );

  /**
   * Apelido ou nome do grupo mudou no painel lateral. Espelha nas DUAS
   * cópias — a conversa aberta e a linha da lista — senão o nome muda no
   * painel e a lista continua mostrando o antigo até recarregar.
   */
  const handleGroupUpdated = useCallback(
    (patch: Partial<NonNullable<Conversation["group"]>>) => {
      const convId = activeConversation?.id;
      if (!convId) return;
      const aplicar = (c: Conversation): Conversation =>
        c.group ? { ...c, group: { ...c.group, ...patch } } : c;
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? aplicar(c) : c))
      );
      setActiveConversation((prev) => (prev ? aplicar(prev) : prev));
    },
    [activeConversation?.id]
  );

  /**
   * O painel renomeou o contato (Fase 2). A página é dona do `activeContact`
   * e da lista — espelha o patch nos três lugares (contato ativo, contato
   * embutido em CADA conversa daquele cliente, e o da conversa ativa), senão
   * o nome novo aparece no painel e continua velho no cabeçalho do fio e na
   * lista até o próximo refetch.
   */
  const handleContactUpdated = useCallback((patch: Partial<Contact>) => {
    if (!patch.id) return;
    setActiveContact((prev) =>
      prev && prev.id === patch.id ? { ...prev, ...patch } : prev
    );
    const aplicar = (c: Conversation): Conversation =>
      c.contact && c.contact.id === patch.id
        ? { ...c, contact: { ...c.contact, ...patch } }
        : c;
    setConversations((prev) => prev.map(aplicar));
    setActiveConversation((prev) => (prev ? aplicar(prev) : prev));
  }, []);

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  return (
    // ⚠️ A altura sai de `--altura-visivel` (a área acima do teclado do
    // celular, escrita por `useTelaAcimaDoTeclado`), com queda em `100dvh`.
    // Com `100vh`, o teclado aberto empurrava o cabeçalho da conversa para
    // fora da tela (relato do operador no iPhone, 14/09/2026).
    <div className="-m-4 flex h-[calc(var(--altura-visivel,100dvh)-3.5rem)] flex-col overflow-hidden sm:-m-6">
      {/* Volta da jornada funil → conversa. Irmã da faixa amarela abaixo,
          pela mesma razão: empurra os painéis em vez de sobrepor. `inert`
          junto com a lista e o fio: com o painel mobile aberto (modal de
          verdade), Tab não pode alcançar um link invisível atrás do
          backdrop. */}
      {veioDoFunil && <VoltarAoFunil inert={fundoInerte} />}
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("whatsappNotConnected")}
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        {/* ⚠️ `min-w-0` é load-bearing no CELULAR (09/09/2026): item de flex
            nasce com `min-width: auto`, e a largura mínima desta coluna era o
            texto SEM QUEBRA mais longo lá dentro — a prévia da última mensagem
            é `truncate`, que é `nowrap`. Medido a 375px: a coluna saía com
            3.042px, e a caixa de busca, as abas e a fileira de visões ficavam
            cortadas na borda direita (reportado da tela pelo operador). No
            desktop a lista tem largura fixa (`lg:w-80`) e o defeito não
            aparece. Primo do `min-w-0` do fio logo abaixo (Issue #165). */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
          inert={fundoInerte}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            etapaInicial={etapaInicial}
            jornadaDoFunil={veioDoFunil}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
            onTermoDeBusca={setTermoDaBusca}
            onConversaAberta={handleConversaAberta}
            inadimplencia={inadimplencia}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
          inert={fundoInerte}
        >
          {activeConversation && !conversaNoEscopo(acesso, activeConversation) ? (
            // Fora do perfil: o cartão SUBSTITUI o fio inteiro. Substituir em
            // vez de embrulhar é load-bearing — montar o MessageThread
            // buscaria as mensagens E zeraria as não-lidas no servidor, e a
            // conversa de outra área viraria "lida" por quem nem a pode
            // responder.
            <ConversaForaDaArea onBack={handleCloseConversation} />
          ) : (
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onChannelChange={handleChannelChange}
            onBack={handleCloseConversation}
            onOpenContactPanel={handleAbrirPainelDoContato}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            termoDaBusca={termoDaBusca}
            saltoPedido={saltoPedido}
            inadimplencia={inadimplencia}
          />
          )}
        </div>

        {/* Backdrop do overlay mobile — mesmo padrão do drawer de navegação
            (layout/sidebar.tsx): backdrop z-30, painel z-40. Tocar fora
            fecha, que no celular é a saída mais à mão. */}
        {painelMobileAberto && (
          <button
            type="button"
            onClick={() => setPainelMobileAberto(false)}
            aria-label={tThread("hideContactPanel")}
            className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm lg:hidden"
          />
        )}

        {/* Right panel: ficha do contato/grupo.

            ⚠️ SEMPRE MONTADO. Fechar não desmonta mais: vira `w-0` com
            `overflow-hidden` e transição de largura. Desmontar (o `{open &&}`
            que morava aqui, #258) derrubava a assinatura realtime das notas e
            refazia as buscas de etiquetas/negócios a cada reabertura — e
            tornava a animação impossível. O `w-[360px]` interno é fixo para o
            conteúdo não reflowar durante a animação; `inert` tira o painel
            fechado da ordem de tabulação, senão ele vira armadilha de teclado
            invisível. O botão de fechar mora DENTRO do painel, no cabeçalho.

            Abaixo de lg é a MESMA instância como overlay fixo deslizando da
            direita (estado `painelMobileAberto`) — as duas variantes moram
            nas classes, então o HTML do servidor está certo nos dois mundos
            e trocar de superfície não desmonta nada. As larguras `sm:` e
            `lg:` coexistem de propósito: prefixos diferentes não se
            desempatam no tailwind-merge (armadilha do CLAUDE.md), mas aqui
            o `lg:` vence por ordem de cascata — os dois são gerados e o
            bloco lg vem depois. O `inert` segue o estado da superfície
            ATIVA (`ehDesktop` reconcilia pós-mount; ver use-media-query).

            ⚠️ O translate é confinado a `max-lg:` de propósito. No Tailwind
            v4, `translate-x-*` usa a propriedade CSS `translate`, e QUALQUER
            valor ≠ none cria containing block para descendente `fixed` — um
            `lg:translate-x-0` deixaria isso ligado na coluna desktop, onde
            nunca houve transform, e o primeiro filho `fixed` não-portalado
            do painel nasceria posicionado contra o wrapper em vez do
            viewport, sem erro nenhum. */}
        <div
          className={cn(
            "fixed inset-y-0 right-0 z-40 h-full w-full shrink-0 overflow-hidden transition-transform duration-200 ease-in-out sm:w-[400px]",
            painelMobileAberto ? "max-lg:translate-x-0" : "max-lg:translate-x-full",
            "lg:static lg:z-auto lg:transition-[width]",
            contactPanelOpen ? "lg:w-[360px]" : "lg:w-0",
          )}
          inert={ehDesktop ? !contactPanelOpen : !painelMobileAberto}
          ref={painelRef}
          tabIndex={-1}
        >
          <div className="h-full w-full lg:w-[360px]">
            {activeConversation && !conversaNoEscopo(acesso, activeConversation) ? (
              // Fora do perfil: nada de ficha. A LINHA da lista é pública por
              // decisão do operador; a ficha traz anotações internas,
              // negócios e histórico — conteúdo de outra área.
              null
            ) : activeConversation?.group_id ? (
              // Painel próprio: a ficha de contato é etiquetas, negócios,
              // anotações e histórico do lead — nada disso existe num grupo.
              <GroupSidebar
                grupo={activeConversation.group ?? null}
                conversationId={activeConversation.id}
                // O responsável mora no painel desde 03/09 (era no fio).
                conversation={activeConversation}
                onAssignChange={handleAssignChange}
                onGrupoAtualizado={handleGroupUpdated}
                onClose={handleToggleContactPanel}
                // O mesmo array que alimenta o fio: a aba Arquivos não faz
                // consulta própria. Ver `lib/media/anexos`.
                messages={messages}
                messagesCarregando={
                  messagesDaConversa !== activeConversation.id
                }
                onIrParaItemDoFio={handleIrParaItemDoFio}
              />
            ) : (
              <ContactSidebar
                contact={activeContact}
                abaPedida={abaDoPainel}
                aoConsumirAba={() => setAbaDoPainel(null)}
                conversationId={activeConversation?.id ?? null}
                // O responsável mora no painel desde 03/09 (era no fio).
                conversation={activeConversation}
                onAssignChange={handleAssignChange}
                resyncToken={resyncToken}
                onClose={handleToggleContactPanel}
                onContactUpdated={handleContactUpdated}
                messages={messages}
                // ⚠️ Sem conversa aberta não há carga em curso — `true` aqui
                // deixaria a aba num spinner eterno em vez do estado vazio.
                messagesCarregando={
                  !!activeConversation &&
                  messagesDaConversa !== activeConversation.id
                }
                onIrParaItemDoFio={handleIrParaItemDoFio}
              />
            )}
          </div>
        </div>

        {/* Painel fechado → tira fina de reabertura na borda direita. Sem
            ela, fechar seria sem volta: o botão de reabrir morava no
            cabeçalho do fio e saiu de lá junto com o de fechar. */}
        {!contactPanelOpen && (
          <button
            type="button"
            onClick={handleToggleContactPanel}
            aria-label={tThread("showContactPanel")}
            title={tThread("showContact")}
            className="hidden h-full w-7 shrink-0 flex-col items-center border-l border-border bg-card pt-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
