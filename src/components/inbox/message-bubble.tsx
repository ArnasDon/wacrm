"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  FileWarning,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Smartphone,
  Bot,
  Trash2,
  Pencil,
  Download,
} from "lucide-react";
import { corDoRemetente, podeBaixarAnexo } from "@/lib/cb-groups/display";
import { mediaFilename, nomeDeclarado } from "@/lib/media/filename";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { FormattedText } from "./formatted-text";
import { MediaViewer } from "./media-viewer";
import { MessageReactions } from "./message-reactions";
import { PlayerDeAudio } from "./player-de-audio";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import type { CorDeCanal } from "@/lib/cb-channels/cores";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { id?: string; authorLabel: string; preview: string } | null;
  /** Clicar na citação rola o fio até a mensagem citada (`messages.id`). */
  onIrParaCitada?: (id: string) => void;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * O canal (cb_channels) por onde a mensagem passou, já resolvido em nome
   * e cor.
   *
   * ⚠️ O fio só preenche isto quando a CONVERSA mistura conexões. O critério
   * era a CONTA (`channels.length >= 2`) e acendia o rótulo em 98% das
   * conversas — 224 das 228 correm por um número só. Presente onde não
   * informa nada, ele virou moldura, e moldura não se lê justamente nos 4
   * casos em que decide para onde a resposta vai. Ver `fioMulticanal`.
   */
  canal?: { label: string; cor: CorDeCanal } | null;
  /**
   * A conversa é de grupo. Muda três coisas: mostra quem falou, destaca
   * menção a nós, e oferece baixar anexo pendente.
   */
  emGrupo?: boolean;
  /** Busca o anexo sob demanda. Só em grupo — ver `podeBaixarAnexo`. */
  onBaixarAnexo?: () => void;
  /** Enquanto a busca do anexo está em andamento. */
  baixandoAnexo?: boolean;
  /**
   * Abre a galeria do fio neste anexo (media-gallery.tsx), com navegação
   * entre todos os anexos da conversa. Sem o callback, a imagem abre o
   * visualizador solo de sempre — call sites fora do fio não mudam.
   */
  onAbrirGaleria?: (messageId: string) => void;
}

/**
 * Cores do nome de quem falou, dentro do grupo. Num grupo de 180 pessoas a
 * cor é o que permite seguir quem disse o quê no paredão de texto — e ela é
 * estável por JID (`corDoRemetente`), não sorteada: o mesmo participante
 * mudando de cor a cada render seria pior que cor nenhuma.
 */
const CORES_DE_REMETENTE = [
  "text-sky-600 dark:text-sky-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-violet-600 dark:text-violet-400",
  "text-amber-600 dark:text-amber-400",
  "text-rose-600 dark:text-rose-400",
  "text-teal-600 dark:text-teal-400",
  "text-indigo-600 dark:text-indigo-400",
  "text-orange-600 dark:text-orange-400",
];

/**
 * O confirmador de entrega, SEMPRE dentro da bolha de saída.
 *
 * ⚠️ As cores são as do fundo PRIMARY, nunca as neutras. `text-muted-foreground`
 * é feito para o fundo da página; sobre o preenchimento violeta da bolha ele
 * some — o operador reportou da tela em 08/09/2026 que o check de "entregue"
 * era ilegível e só o de "lido" (azul) aparecia. É exatamente o cuidado que o
 * comentário do horário, dois elementos ao lado, já descrevia: o ícone tinha
 * ficado de fora.
 *
 * ⚠️ `text-primary-foreground` é DERIVADA do tema, e isso é load-bearing:
 * são quatro temas com `--primary` diferente (violeta, verde, azul, laranja),
 * então qualquer cor fixa acertaria um e erraria os outros. O azul do "lido"
 * é a exceção deliberada — é convenção do WhatsApp e o que distingue lido de
 * entregue —, num tom claro que se sustenta sobre os quatro.
 *
 * Contraste MEDIDO sobre o violeta desta conta (#7834e8): o
 * `text-muted-foreground` de antes dava **1,87**, abaixo de qualquer
 * limiar; hoje o entregue dá **4,26** e o lido, **4,21** — os dois acima do
 * 3,0 que a WCAG pede para elemento gráfico, e distinguidos por MATIZ
 * (branco × ciano), não por luminosidade.
 */
function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-primary-foreground/80" />;
    case "sent":
      return <Check className="h-3 w-3 text-primary-foreground/80" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-primary-foreground/80" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-cyan-300" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-300" />;
    default:
      return null;
  }
}

/**
 * Anexo ainda em trânsito. O webhook grava a MENSAGEM primeiro e busca o
 * arquivo depois (assim uma falha no download não leva a mensagem junto),
 * então existe uma janela de segundos em que a bolha tem tipo de mídia e
 * `media_url` nulo. Sem distinguir, essa janela mostrava "indisponível" —
 * dizendo que o anexo se perdeu quando ele estava a caminho.
 *
 * A janela é decidida pela idade da mensagem porque não há estado no banco
 * para consultar: recém-chegada = baixando; antiga = o download falhou
 * mesmo. O teto é generoso (o download tem 30s de teto, mais a fila).
 */
const JANELA_DOWNLOAD_MS = 2 * 60 * 1000;

function anexoAindaChegando(message: Message): boolean {
  if (message.media_url) return false;
  const idade = Date.now() - new Date(message.created_at).getTime();
  return idade >= 0 && idade < JANELA_DOWNLOAD_MS;
}

function MediaLoading({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
      <span>{t("attachmentLoading")}</span>
    </div>
  );
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

/**
 * Passou do teto do Storage (`media_state = 'too_large'`, gravado pelo
 * webhook desde 2026-09-09).
 *
 * ⚠️ Frase PRÓPRIA, e não o "indisponível" genérico: as duas dizem que o
 * arquivo não está aqui, mas só esta diz POR QUE e onde achá-lo. A queixa que
 * originou isto foi exatamente essa — o operador viu "Documento
 * indisponível" e não tinha como saber se o cliente errou o envio, se o CRM
 * falhou ou se bastava esperar. O `label` traz o NOME do arquivo quando o
 * payload o declarou (969), então a bolha nomeia o que ficou de fora.
 */
function MediaGrandeDemais({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      <FileWarning className="h-4 w-4 shrink-0" />
      <span>{t("tooLarge", { label })}</span>
    </div>
  );
}

/** Falta o anexo: ou está baixando, ou se perdeu. */
function MediaPendente({
  message,
  label,
  t,
}: {
  message: Message;
  label: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [chegando, setChegando] = useState(() => anexoAindaChegando(message));

  // A janela expira sozinha: sem isto a bolha ficaria girando para sempre
  // quando o download realmente falhasse, porque nada a re-renderiza.
  useEffect(() => {
    if (!chegando) return;
    const restante =
      JANELA_DOWNLOAD_MS - (Date.now() - new Date(message.created_at).getTime());
    const timer = setTimeout(() => setChegando(false), Math.max(0, restante));
    return () => clearTimeout(timer);
  }, [chegando, message.created_at]);

  // O teto do Storage é decisão FINAL — não adianta esperar a janela de
  // download nem oferecer nova tentativa.
  if (message.media_state === "too_large") {
    return <MediaGrandeDemais label={label} t={t} />;
  }
  return chegando ? <MediaLoading t={t} /> : <MediaUnavailable label={label} t={t} />;
}

/**
 * Nome sugerido no download.
 *
 * ⚠️ Era uma derivação PRÓPRIA e mais fraca que a de `@/lib/media/filename`:
 * ela devolvia o basename cru do bucket, com o carimbo de tempo colado na
 * frente (`1756…-contrato.pdf`) e sem sanitizar. Agora delega para a cascata
 * boa, que remove o carimbo, prefere o `media_filename` da 969 quando existe e
 * sintetiza um nome quando não há nada.
 */
function nomeDeArquivo(message: Message): string | undefined {
  // Sem objeto no bucket (mídia da Meta que não verificou, anexo de grupo
  // esperando o download sob demanda) NÃO se sintetiza nome — mas o que o
  // remetente CHAMOU o arquivo continua valendo. A versão anterior devolvia
  // `undefined` aqui e a bolha caía no rótulo genérico "Documento" sobre
  // arquivo com nome gravado (achado do Codex no PR #101).
  if (!message.media_url) return nomeDeclarado(message) ?? undefined;
  return mediaFilename(message) || undefined;
}

function MediaImage({
  url,
  alt,
  fileName,
  onAmpliar,
}: {
  url: string;
  alt: string;
  fileName?: string;
  /** Quando presente, o clique abre a galeria do fio, não o viewer solo. */
  onAmpliar?: () => void;
}) {
  const tv = useTranslations("Inbox.mediaViewer");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ampliada, setAmpliada] = useState(false);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (onAmpliar ? onAmpliar() : setAmpliada(true))}
        title={tv("open")}
        aria-label={tv("open")}
        className="block cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
      </button>
      {ampliada && src && (
        <MediaViewer
          src={src}
          alt={alt}
          fileName={fileName}
          onClose={() => setAmpliada(false)}
        />
      )}
    </>
  );
}

/**
 * A transcrição da nota de voz (943): "pronta" aparece para todos num
 * bloco expansível; o BOTÃO só existe na fala do CLIENTE — nosso áudio a
 * equipe já sabe o que diz, e é o do cliente que o Radar analisa. O
 * estado local cobre o retorno imediato do POST; o realtime de
 * `messages` (UPDATE mesclando a linha inteira) cobre os demais viewers.
 */
function TranscricaoDeAudio({
  message,
  t,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
}) {
  const [local, setLocal] = useState<{
    status: string;
    transcricao?: string;
    erro?: string;
  } | null>(null);
  const [pedindo, setPedindo] = useState(false);

  // O banco é sempre a verdade mais NOVA: quando o realtime traz um
  // status diferente, o retrato local do POST solta — sem isto, um
  // "transcrevendo" local (corrida de claim perdida) escondia o `falhou`
  // do dono real para sempre.
  useEffect(() => {
    setLocal(null);
  }, [message.transcricao_status, message.transcricao]);

  const transcricao = local?.transcricao ?? message.transcricao ?? null;
  const status = local?.status ?? message.transcricao_status ?? null;
  const erro = (local?.erro ?? message.transcricao_erro) || null;

  const pedir = useCallback(async () => {
    setPedindo(true);
    try {
      const res = await fetch(`/api/cb/transcricao/${message.id}`, {
        method: "POST",
      });
      const corpo = (await res.json().catch(() => null)) as {
        status?: string;
        transcricao?: string;
        erro?: string;
        error?: string;
      } | null;
      if (res.ok && corpo?.status) {
        setLocal({ status: corpo.status, transcricao: corpo.transcricao, erro: corpo.erro });
      } else {
        setLocal({ status: "falhou", erro: corpo?.error ?? `HTTP ${res.status}` });
      }
    } catch {
      setLocal({ status: "falhou", erro: t("transcricaoRede") });
    } finally {
      setPedindo(false);
    }
  }, [message.id, t]);

  if (transcricao) {
    return (
      <details className="mt-1 max-w-64 rounded-md bg-card px-2 py-1 text-xs ring-1 ring-border">
        <summary className="cursor-pointer select-none text-muted-foreground">
          {t("transcricao")}
        </summary>
        <FormattedText texto={transcricao} className="mt-1" />
      </details>
    );
  }
  if (message.sender_type !== "customer") return null;

  // "Transcrevendo" órfão (processo morto no meio, deploy start-first):
  // depois do prazo do cadeado, a bolha REOFERECE o botão — o resgate da
  // travada mora no WHERE do servidor e precisa de um chamador; sem isto,
  // o estado ficava eterno na tela. 10 min = TRAVADA_MIN de
  // src/lib/transcricao/transcrever.ts (server-only, não importável aqui).
  const desdeMs = message.transcricao_desde
    ? Date.parse(message.transcricao_desde)
    : NaN;
  const claimTravado =
    status === "transcrevendo" &&
    Number.isFinite(desdeMs) &&
    Date.now() - desdeMs > 10 * 60_000;

  if (pedindo || (status === "transcrevendo" && !claimTravado)) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">{t("transcrevendo")}</p>
    );
  }
  if (status === "recusada") {
    // Terminal SEM botão, de propósito — o motivo explica no hover.
    return (
      <p className="mt-1 text-xs text-muted-foreground" title={erro ?? undefined}>
        {t("transcricaoRecusada")}
      </p>
    );
  }
  return (
    <div className="mt-1">
      {status === "falhou" && erro && (
        <p className="text-xs text-destructive">{erro}</p>
      )}
      <button
        type="button"
        onClick={pedir}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {status === "falhou" ? t("transcricaoTentarDeNovo") : t("transcrever")}
      </button>
    </div>
  );
}

function MessageContent({
  message,
  isAgent,
  t,
  onAbrirGaleria,
}: {
  message: Message;
  /** A bolha é da equipe (fundo primary) — o player de áudio lê contra ele. */
  isAgent: boolean;
  t: ReturnType<typeof useTranslations>;
  onAbrirGaleria?: (messageId: string) => void;
}) {
  switch (message.content_type) {
    case "text":
      return (
        <FormattedText texto={message.content_text} />
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage
              url={message.media_url}
              alt={message.content_text || t("photo")}
              fileName={nomeDeArquivo(message)}
              onAmpliar={
                onAbrirGaleria ? () => onAbrirGaleria(message.id) : undefined
              }
            />
          ) : (
            <MediaPendente message={message} label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaPendente message={message} label={t("video")} t={t} />
          )}
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <>
              {/* ⚠️ Não o `<audio controls>` nativo: ele escondia a
                  velocidade no menu de três pontos do navegador. Ver
                  `player-de-audio.tsx`. */}
              <PlayerDeAudio
                src={message.media_url}
                naBolhaDaEquipe={isAgent}
              />
              <TranscricaoDeAudio message={message} t={t} />
            </>
          ) : (
            <MediaPendente message={message} label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document": {
      // O nome de verdade, com a cascata inteira: `media_filename` (969) →
      // `content_text` que pareça nome → basename do bucket sem o carimbo →
      // nome sintetizado. Só cai no rótulo genérico quando nada disso resolve.
      const nome = nomeDeArquivo(message) ?? t("document");
      // A legenda é OUTRA coisa que o cliente escreveu, e nem sempre existe.
      // ⚠️ Suprimida quando é igual ao nome: no caminho da Meta o filename era
      // gravado NO `content_text`, então as linhas antigas mostrariam o mesmo
      // texto duas vezes, uma embaixo da outra.
      const legenda =
        message.content_text && message.content_text !== nome
          ? message.content_text
          : null;

      if (!message.media_url) {
        return <MediaPendente message={message} label={nome} t={t} />;
      }
      return (
        <div>
          <a
            href={message.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
          >
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            {/* `min-w-0` é o que deixa o `truncate` funcionar dentro do flex:
                sem ele o item nasce com `min-width: auto` e o nome longo
                estica a bolha em vez de ser cortado. */}
            <span className="min-w-0 truncate" title={nome}>
              {nome}
            </span>
          </a>
          {legenda && <FormattedText texto={legenda} className="mt-1" />}
        </div>
      );
    }

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <FormattedText texto={message.content_text || t("interactiveReply")} />
          </div>
        );
      }
      return (
        <FormattedText texto={message.content_text || t("interactiveReply")} />
      );
    }

    default:
      return (
        <FormattedText texto={message.content_text || t("unsupported")} />
      );
  }
}

export function MessageBubble({
  message,
  reply,
  onIrParaCitada,
  reactions,
  currentUserId,
  onToggleReaction,
  canal,
  emGrupo = false,
  onBaixarAnexo,
  baixandoAnexo = false,
  onAbrirGaleria,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  // Aviso do próprio WhatsApp ("Fulano entrou"). Não é mensagem de ninguém:
  // sai do fluxo de bolhas e vira faixa centralizada, como no WhatsApp. O
  // `return` cedo é o que dispensa alinhamento, horário, status, reação e o
  // menu de ações — nada disso faz sentido num aviso do sistema.
  if (message.content_type === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[85%] rounded-full bg-muted/70 px-3 py-1 text-center text-[11px] leading-snug text-muted-foreground">
          {message.content_text}
        </span>
      </div>
    );
  }

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  /**
   * A mensagem saiu do CRM e NÃO chegou ao destinatário.
   *
   * ⚠️ Só vale para o que nós mandamos: `status` de mensagem recebida não
   * descreve entrega nenhuma. Sem a guarda de `isAgent`, um valor estranho
   * numa mensagem do cliente pintaria a bolha dele de vermelho.
   */
  const naoEntregue = isAgent && message.status === "failed";
  // Quem falou, só em grupo e só do lado de quem recebeu: numa mensagem
  // nossa o nome seria o do próprio operador, que a bolha já identifica pelo
  // lado em que está.
  const remetente = emGrupo && !isAgent ? message.group_sender_name : null;
  const corDoNome =
    CORES_DE_REMETENTE[
      corDoRemetente(message.group_sender_jid, CORES_DE_REMETENTE.length)
    ];
  const mencionaNos = emGrupo && message.mentions_us === true;
  const anexoPendente = emGrupo && podeBaixarAnexo(message);
  const time = format(new Date(message.created_at), "HH:mm");
  // Confirmada pelo WhatsApp × só pedida por nós. As duas riscam a bolha,
  // mas dizem coisas diferentes — e a diferença importa: um pedido sem
  // confirmação pode significar que a mensagem segue no celular do cliente.
  const confirmada = !!message.deleted_at;
  const soPedida = !confirmada && !!message.delete_requested_at;
  const apagada = confirmada || soPedida;

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          // ⚠️ `max-w-full` é load-bearing, e a falta dele fazia a CONVERSA
          // INTEIRA rolar para o lado.
          //
          // O teto de 75% do `<MessageActions>` funciona — medido: o pai
          // resolve em 355px. Mas esta bolha é filha de um flex
          // `flex-col items-start`, e `align-items: flex-start` dimensiona o
          // filho por `fit-content`, NÃO estica até o pai. `max-width` não se
          // herda, então uma URL sem espaços (`https://pje.tjce.jus.br/…`)
          // media 1040px dentro de um pai de 355px e vazava para fora do fio,
          // acendendo a barra horizontal. Medido: contêiner 505px,
          // `scrollWidth` 1056px.
          //
          // Com o teto, o `break-words` do `<FormattedText>` finalmente tem
          // contra o que quebrar — ele só parte a palavra quando ela NÃO CABE,
          // e até aqui cabia sempre, porque nada limitava a largura.
          "relative max-w-full rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
          // Marcaram o nosso número. Num grupo movimentado é a diferença
          // entre "alguém falou" e "alguém falou COM VOCÊ".
          mencionaNos && "ring-2 ring-primary/60",
          // ⚠️ NÃO CHEGOU AO CLIENTE. O ícone de 12px no rodapé não dava conta
          // disso: numa conversa longa ele passa despercebido, e o operador
          // segue achando que respondeu. A mensagem que falhou tem de ser
          // impossível de confundir com uma que saiu — daí a bolha inteira
          // mudar, e não só o ✓.
          // ⚠️ `[&_*]:!text-foreground` porque os filhos (hora, rótulo de
          // canal, nome do remetente) carregam `text-primary-foreground`
          // condicionado a `isAgent` — que continua verdadeiro aqui. Trocar só
          // o fundo do contêiner deixava texto claro sobre fundo claro, ilegível
          // no tema claro. A exceção é o próprio aviso, que é vermelho.
          naoEntregue &&
            "bg-destructive/10 text-foreground ring-2 ring-destructive/60 [&_*:not(.aviso-falha):not(.aviso-falha_*)]:!text-foreground",
        )}
      >
        {remetente && (
          <span className={cn("mb-0.5 block text-xs font-semibold", corDoNome)}>
            {remetente}
          </span>
        )}
        {anexoPendente && (
          <button
            type="button"
            onClick={onBaixarAnexo}
            disabled={baixandoAnexo}
            className="mb-1 flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1 text-xs text-foreground hover:bg-background disabled:opacity-60"
          >
            <Download className="h-3 w-3" />
            {baixandoAnexo
              ? t("groupMediaDownloading")
              : message.media_state === "failed"
                ? t("groupMediaRetry")
                : t("groupMediaTap")}
          </button>
        )}
        {apagada && (
          <span
            className={cn(
              "mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase leading-none tracking-wide",
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
            title={soPedida ? t("deleteRequestedHint") : undefined}
          >
            <Trash2 className="h-2.5 w-2.5" />
            {soPedida
              ? t("deleteRequested")
              : message.deleted_by === "customer"
                ? t("deletedByCustomer")
                : message.deleted_by === "agent"
                  ? t("deletedByUs")
                  : // Sem autor registrado, não se afirma quem apagou. O
                    // rótulo antigo dizia "Apagada" (= por nós) em qualquer
                    // caso que não fosse o cliente, inclusive neste.
                    t("deletedUnknown")}
          </span>
        )}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
            onJump={
              reply.id && onIrParaCitada
                ? () => onIrParaCitada(reply.id as string)
                : undefined
            }
          />
        )}
        {/* O estilo de apagada fica NESTE invólucro, não no contêiner da
            bolha: o visualizador de mídia em tela cheia é renderizado como
            descendente e herdaria o `opacity-60`, deixando a foto ampliada
            desbotada sem motivo. */}
        <div
          className={cn(
            apagada && "opacity-60 [&_p]:line-through [&_a]:line-through [&_code]:line-through",
          )}
        >
          <MessageContent
            message={message}
            isAgent={isAgent}
            t={t}
            onAbrirGaleria={onAbrirGaleria}
          />
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.edited_at && !apagada && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[9px]",
                isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
              )}
              // O texto anterior só existe aqui: o WhatsApp não guarda
              // histórico de edição.
              title={
                message.text_before_edit
                  ? t("editedWas", { text: message.text_before_edit })
                  : t("edited")
              }
            >
              <Pencil className="h-2.5 w-2.5" />
              {t("edited")}
            </span>
          )}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          {/* Automação ou fluxo — robô que NÃO é a IA.
              ⚠️ Este era o único caminho de saída sem marca nenhuma. Resposta
              de IA já tinha o selo ✨ e o eco do celular tinha o dele, mas
              `sender_type='bot'` com `ai_generated=false` saía visualmente
              IDÊNTICO a uma mensagem escrita por gente — mesmo lado, mesma
              cor, nada. A equipe não tinha como saber que aquilo foi uma
              regra disparando de madrugada, e o cliente respondia achando
              que falou com alguém.
              Sem interruptor, de propósito (P1.5): a identificação interna
              de robô existe mesmo com a assinatura desligada. E é excludente
              com o selo de IA acima — os dois juntos seriam ruído, e
              `ai_generated` é a informação mais específica. */}
          {message.sender_type === "bot" && !message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("botBadgeTitle")}
            >
              <Bot className="h-2.5 w-2.5" />
              {t("botBadge")}
            </span>
          )}
          {/* Enviada pelo celular pareado, não pelo CRM. Num número
              atendido por várias pessoas isso importa: sem a marca, a
              equipe não tem como saber que aquela resposta não passou
              pelo sistema (e portanto não gerou registro, automação nem
              atribuição). */}
          {message.from_device && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("fromDeviceTitle")}
            >
              <Smartphone className="h-2.5 w-2.5" />
              {t("fromDevice")}
            </span>
          )}
          {/* Por qual número esta mensagem passou. Continua embaixo da
              mensagem, ao lado da hora — só que agora aparece SÓ quando a
              conversa mistura conexões, e por isso pôde crescer: 10px em vez
              de 9, e teto de 9rem em vez de 7. Medido em 02/09: os seis nomes
              da conta cabem em 7rem até a 10px (o mais longo, "Trabalhista -
              Comercial", dá 110px) — o 9rem é folga para o próximo nome, não
              conserto de truncagem. O defeito do rótulo antigo era estar em
              TODA conversa, não a largura.

              ⚠️ A cor vive na BOLINHA, não no texto. A bolha da equipe é
              preenchida com `bg-primary` — que nesta conta é violeta —, então
              texto na cor do canal ficaria ilegível justamente no canal
              violeta, e o mesmo rótulo teria contraste diferente conforme o
              lado do fio. A bolinha se sustenta sobre qualquer fundo. É a
              mesma dupla ponto+nome do seletor do cabeçalho e da lista.

              ⚠️ Em PALAVRAS, não só em cor — a mesma regra do aviso de falha
              logo abaixo. Quem não distingue as cores lê o nome. */}
          {canal && (
            <span
              title={t("viaChannel", { label: canal.label })}
              className={cn(
                "inline-flex min-w-0 items-center gap-1 text-[10px]",
                isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  canal.cor.ponto,
                )}
              />
              <span className="max-w-[9rem] truncate">{canal.label}</span>
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>

        {/* ⚠️ Em PALAVRAS, não só em cor. Cor sozinha não diz o que houve, e
            não alcança quem não distingue vermelho. A frase é a única coisa
            que faz o operador entender que precisa mandar de novo. */}
        {naoEntregue && (
          <p className="aviso-falha mt-1 flex items-center gap-1 text-[11px] font-medium !text-destructive">
            <XCircle className="h-3 w-3 shrink-0" />
            {t("naoEntregue")}
          </p>
        )}
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
