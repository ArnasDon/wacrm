"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  KeyboardEvent,
} from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Library,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Zap,
  StickyNote,
  Clock,
  CalendarClock,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { useMediaQuery } from "@/hooks/use-media-query";
import { enterEnvia, MIDIA_DE_TOQUE } from "@/lib/celular/teclado";
import { custoDaAssinatura, nomeDePessoa } from "@/lib/assinatura/assinatura";
import type { ConversationNote, MediaLibraryItem } from "@/types";
import { InternalNoteBox } from "./internal-note-box";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { ReplyQuote } from "./reply-quote";
import {
  alternarMarcador,
  type EstiloFormatacao,
} from "@/lib/inbox/whatsapp-format";
import {
  ACEITE_DO_SELETOR,
  arquivoParaEnviar,
  colagemEhAnexo,
  escolherArquivos,
  MAX_ANEXOS,
  tipoDoArquivo,
} from "@/lib/inbox/arquivo-solto";
import { useTranslations } from "next-intl";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import { validateInteractivePayload } from "@/lib/whatsapp/interactive";
import type { InteractiveMessagePayload, QuickReply } from "@/types";
import { QuickReplyPicker } from "./quick-reply-picker";
import { AcervoPicker } from "./acervo-picker";
import {
  arredondarParaGrade,
  ATALHOS_DE_PRAZO,
  CICLO_MINUTOS,
  comporHorario,
  daquiAHoras,
  hojeParaInput,
  horaParaInput,
  type ChaveDeAtalho,
} from "@/lib/scheduled/display";
import {
  podeTerLegenda,
  tetoDaLegenda,
  TETO_DA_LEGENDA_META,
} from "@/lib/scheduled/midia";
import { CHAT_MEDIA_BUCKET } from "@/lib/storage/buckets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ehEvolution, ehInstagram } from "@/lib/cb-channels/transporte";
import type { CbChannelKind } from "@/lib/cb-channels/repo";

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/**
 * Supabase Storage bucket holding agent-sent chat attachments (migration 023).
 *
 * ⚠️ O valor mora em `lib/storage/buckets.ts` desde a 932: o disparador das
 * agendadas roda no servidor e precisa do mesmo nome para conferir se o
 * arquivo ainda existe. Re-exportado aqui só para os call sites existentes
 * continuarem funcionando.
 */
export { CHAT_MEDIA_BUCKET };

/**
 * Meta caps media captions at 1024 chars. Enforced here and in the send route.
 *
 * ⚠️ O número mora em `lib/scheduled/midia.ts` desde a 932: agendar mídia
 * precisa da mesma regra no servidor, e um `1024` escrito de novo aqui viraria
 * a segunda cópia a envelhecer sozinha.
 */
export const MEDIA_CAPTION_MAX = TETO_DA_LEGENDA_META;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

/**
 * Janela para desfazer um envio. Mensagem errada no WhatsApp não tem volta:
 * só resta apagar, e o cliente vê que algo foi apagado.
 *
 * Três segundos por escolha do operador: a janela ATRASA a chegada no celular
 * do cliente, então cada segundo aqui é um segundo de silêncio no atendimento.
 * Pega o arrependimento imediato — que é a maioria — sem fazer o cliente
 * achar que o atendente sumiu.
 */
const SEGUNDOS_DESFAZER = 3;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
/**
 * ⚠️ Vem de `arquivo-solto.ts`, que é a MESMA lista usada por quem arrasta
 * ou cola arquivo. Duas listas divergiriam, e o sintoma seria um arquivo
 * aceito por uma porta e recusado pela outra.
 */
const PICKER_ACCEPT = ACEITE_DO_SELETOR;

interface MediaDraft {
  /**
   * Identidade do item na fila — `path` serviria, mas ele é dado do Storage
   * e a fila precisa de chave estável para o React e para a seleção.
   */
  id: string;
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

/** Um item da fila, pronto para virar mensagem. */
function novoDraft(d: Omit<MediaDraft, "id">): MediaDraft {
  return { ...d, id: `${d.path}#${Math.random().toString(36).slice(2, 8)}` };
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  /**
   * Tipo do canal ativo da conversa (multi-canal). Canal 'evolution' (não
   * oficial, Baileys) não tem templates nem mensagens interativas — os dois
   * atalhos somem. A janela de 24h também não existe lá, mas isso o pai já
   * neutraliza passando sessionExpired=false. Null = conta sem canais
   * (pré-migration) → comportamento de sempre. Instagram também não tem
   * modelo nem interativa — por isso os dois atalhos exigem "não é Evolution
   * E não é Instagram", e não "é Meta": o null legado continua entrando.
   */
  channelKind?: CbChannelKind | null;
  /**
   * `false` enquanto a lista de canais ainda não chegou (ou a busca falhou):
   * o transporte é DESCONHECIDO, que não é o mesmo que `channelKind: null`
   * ("a conta não tem canais", regra Meta). Nesse vão os atalhos de
   * template/interativa ficam ocultos (M12): oferecê-los abria o
   * TemplatePicker com channelId nulo — catálogo sem o recorte por WABA,
   * que o CLAUDE.md marca como load-bearing.
   */
  transporteConhecido?: boolean;
  onSend: (text: string, replyToId?: string) => void;
  /**
   * ⚠️ Devolve se ENTREGOU. Com vários anexos o compositor envia um por vez,
   * com `await` (senão chegam fora de ordem no celular do cliente), e só
   * tira da fila o que foi confirmado — o que falhou fica na tela, com o
   * arquivo ainda no bucket, para a pessoa tentar de novo sem reanexar.
   */
  onSendMedia: (payload: SendMediaPayload) => boolean | Promise<boolean>;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  /**
   * Limpa a citação. Com `idQueSaiu`, o dono do estado só limpa se a citação
   * vigente ainda for aquela — ver o envio da fila de anexos, que leva
   * segundos e pode terminar depois de o operador escolher outra.
   */
  onClearReply?: (idQueSaiu?: string) => void;
  /**
   * Anotação interna recém-criada (migration 918). O compositor chama a rota
   * e devolve a linha pronta para o pai pôr no fio sem esperar o realtime —
   * quem escreve precisa ver o que escreveu na hora.
   */
  onNoteCreated?: (nota: ConversationNote) => void;
  /**
   * Agendou uma mensagem (migration 925). O pai usa para mandar a faixa
   * AGENDADAS, logo acima, recarregar a lista.
   */
  onScheduled?: () => void;
  /**
   * Abre o popup "Executar automação" (955). O DIALOG mora no fio — é ele
   * quem tem conversa/contato/canal —, o compositor só oferece o item no
   * menu +. Ausente = item some (conversa de GRUPO: automação não roda em
   * grupo por decisão estrutural, cb-groups/persist.ts).
   */
  onExecutarAutomacao?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

export function MessageComposer({
  conversationId,
  sessionExpired,
  channelKind = null,
  transporteConhecido = true,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
  onNoteCreated,
  onScheduled,
  onExecutarAutomacao,
}: MessageComposerProps) {
  const t = useTranslations("Inbox.composer");
  // Namespace próprio: os textos de agendar são compartilhados com a
  // faixa AGENDADAS, que é outro componente.
  const tAgendadas = useTranslations("Inbox.scheduled");

  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Aparelho de toque: a dica da caixa não fala de Shift+Enter, que o teclado
  // do celular não tem (e lá o retorno pula linha — ver `enterEnvia`).
  const toque = useMediaQuery(MIDIA_DE_TOQUE);
  /**
   * Mensagem escrita, ainda segurável. `null` = nada esperando.
   *
   * `enviar` é o despachante da conversa de ORIGEM, capturado no instante em
   * que a mensagem foi retida — ver a nota extensa em `handleSend`.
   */
  const [pendente, setPendente] = useState<{
    texto: string;
    replyToId?: string;
    expiraEm: number;
    enviar: (texto: string, replyToId?: string) => void;
  } | null>(null);
  const timerDesfazerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [acervoOpen, setAcervoOpen] = useState(false);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  // ⚠️ FILA, não um só (08/09/2026, pedido do operador). Cada item vira UMA
  // mensagem no WhatsApp — não existe "mensagem com 3 anexos" no protocolo.
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  // Qual item está com a prévia grande e o campo de legenda aberto.
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // Trinco do envio da fila. O ref é o que serializa (síncrono); o estado só
  // existe para desabilitar o botão e o Enter.
  //
  // ⚠️ O ref guarda a POSSE (um número por envio), não um booleano, porque o
  // trinco tem DOIS pontos de queda: o `finally` de `sendDraft` e o efeito de
  // troca de conversa. Com booleano, o `finally` do envio de A — que só roda
  // quando a requisição em voo assenta, e o `fetch` não tem prazo — derrubava
  // o trinco de um envio JÁ EM CURSO em B, e o clique seguinte reenviava os
  // anexos de B ao cliente: exatamente o que o trinco existe para impedir.
  // É a mesma cerca de posse do worker do Radar (`running_desde`) e do claim
  // do Calendly (`processando_desde`): quem foi solto não escreve por cima de
  // quem assumiu. 0 = ninguém enviando.
  const enviandoFilaRef = useRef(0);
  const proximaPosseRef = useRef(0);
  const [enviandoFila, setEnviandoFila] = useState(false);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftsRef = useRef<MediaDraft[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  /**
   * Caminhos que JÁ pertencem a outra coisa e não podem mais ser recolhidos.
   *
   * ⚠️ Existe por causa do agendamento (932). A limpeza de desmonte acima
   * apaga o objeto do rascunho — certo para um anexo que ficou na tela e nunca
   * foi mandado. Mas agendar cria a linha no servidor e o arquivo passa a ser
   * DELA: se o operador trocar de tela enquanto o POST está no ar (ou no
   * quadro seguinte ao sucesso, antes de o rascunho sumir), a limpeza apagaria
   * o arquivo de uma agendada recém-criada — e o defeito só apareceria horas
   * depois, na hora do envio.
   *
   * Marcado ANTES do POST, de propósito: a janela perigosa é justamente a
   * espera. Se o agendamento falhar, o caminho sai daqui e volta a ser
   * recolhível.
   */
  const entreguesRef = useRef<Set<string>>(new Set());

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    if (entreguesRef.current.has(path)) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  // ⚠️ Permissão PRÓPRIA, e de propósito mais frouxa que `canSend`: anotação
  // interna não sai para o cliente, então `viewer` também anota.
  const podeAnotar = useCan("write-notes");
  // Só o "está aberta ou não" mora aqui. Texto, menção e teclado vivem dentro
  // do `InternalNoteBox` — este arquivo é do upstream, e cada linha nossa a
  // mais é superfície de conflito no merge.
  const [anotando, setAnotando] = useState(false);
  const fecharNota = useCallback(() => setAnotando(false), []);
  // Agendar (925). Data e hora em campos separados, como no seletor que o
  // operador desenhou — e é a dupla que `comporHorario` (testada) recebe.
  const [dataAg, setDataAg] = useState("");
  const [horaAg, setHoraAg] = useState("");
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [agendando, setAgendando] = useState(false);
  /**
   * ⚠️ Ref, não estado: dois Enter no mesmo tique leem `agendando === false`
   * nos dois, e o `setText("")` só acontece depois do `await`. Sem esta
   * trava, segurar Enter grava DUAS agendadas do mesmo texto e o cliente
   * recebe a mesma mensagem duas vezes no minuto marcado. O `disabled` do
   * botão protege só o clique.
   */
  const agendandoRef = useRef(false);

  /**
   * A hora escolhida, ou `null` enquanto falta metade.
   *
   * ⚠️ É esta variável que DESVIA o envio: com ela preenchida, o botão de
   * enviar agenda em vez de mandar agora. Por isso limpar os dois campos é a
   * única forma de voltar ao envio imediato — e por isso a etiqueta ao lado
   * do botão existe: hora escolhida tem de estar VISÍVEL, senão o atendente
   * digita uma resposta urgente, aperta enviar e ela sai amanhã.
   */
  const quandoAg = dataAg && horaAg ? comporHorario(dataAg, horaAg) : null;
  /** Qual atalho pintou os campos — só para destacar o botão. */
  const [atalhoAtivo, setAtalhoAtivo] = useState<ChaveDeAtalho | null>(null);

  const limparAgendamento = useCallback(() => {
    setDataAg("");
    setHoraAg("");
    setAtalhoAtivo(null);
  }, []);

  const aplicarAtalho = useCallback((chave: ChaveDeAtalho, horas: number) => {
    const { data, hora } = daquiAHoras(horas);
    setDataAg(data);
    setHoraAg(hora);
    setAtalhoAtivo(chave);
  }, []);

  /**
   * Abrir o seletor já deixa "24 horas" escolhido: amanhã, na hora de agora.
   *
   * ⚠️ Não é só conveniência — é o que faz o estado inicial ser VÁLIDO.
   * Abrindo em "hoje, agora", a hora já nasce no passado (por milissegundos),
   * e o botão de enviar apareceria armado para recusar. Um dia à frente é
   * também o piso real de uso: agendar é para depois, não para daqui a pouco.
   */
  const abrirSeletor = useCallback(
    (aberto: boolean) => {
      setSeletorAberto(aberto);
      if (aberto && !dataAg && !horaAg) {
        aplicarAtalho(ATALHOS_DE_PRAZO[0].chave, ATALHOS_DE_PRAZO[0].horas);
      }
    },
    [dataAg, horaAg, aplicarAtalho],
  );

  /**
   * O estado do agendamento, empacotado para o `<SeletorDeHorario>`.
   *
   * ⚠️ Objeto cru, sem `useMemo`: `quandoAg` é uma `Date` NOVA a cada render
   * (nasce de `comporHorario`), então memoizar não evitaria identidade nova —
   * só somaria uma lista de dependências para envelhecer errado. O consumidor
   * não é memoizado.
   */
  const ag: Agendamento = {
    quandoAg,
    dataAg,
    horaAg,
    setDataAg,
    setHoraAg,
    atalhoAtivo,
    setAtalhoAtivo,
    aplicarAtalho,
    limparAgendamento,
    seletorAberto,
    setSeletorAberto,
    abrirSeletor,
  };

  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      for (const d of draftsRef.current) removeStaged(d.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // ⚠️ A BORDA TEM DE VOLTAR À CONTA. `scrollHeight` é a caixa de PADDING
    // (conteúdo + padding, sem borda), mas o preflight do Tailwind põe
    // `box-sizing: border-box` em tudo — então o `height` que atribuímos aqui
    // INCLUI a borda. Devolver o `scrollHeight` cru rouba 2px do texto e o
    // navegador acende a barra de rolagem com UMA linha digitada (medido no
    // app: `height: 40px` deixava 38px de conteúdo para uma linha de 20px).
    const borda = el.offsetHeight - el.clientHeight;
    // Max 4 lines (~96px), medidos na caixa de padding como o `scrollHeight`.
    el.style.height = `${Math.min(el.scrollHeight, 96) + borda}px`;
  }, []);

  // ---- Envio com janela de arrependimento ----------------------------
  //
  // Enter enviava na hora, e mensagem errada no WhatsApp não tem volta: só
  // resta apagar, o que o cliente vê. A mensagem fica retida por
  // SEGUNDOS_DESFAZER e um "Desfazer" a traz de volta ao campo.
  //
  // Duas regras, e as duas já foram violadas por engano antes:
  //
  // 1. NUNCA perder a mensagem em silêncio. Trocar de conversa, desmontar o
  //    componente ou mandar outra ENVIAM a pendente em vez de descartá-la —
  //    o operador apertou Enter, a intenção dele foi enviar.
  // 2. NUNCA entregar a quem não era o destinatário. O despachante é preso
  //    quando a mensagem é retida, não quando ela sai.

  // `onSend` por REF, não por dependência.
  //
  // O pai o memoiza com `conversation` na lista de dependências, e esse
  // objeto ganha identidade nova a cada atualização em tempo real. Se o
  // efeito de desmontagem dependesse de `onSend`, uma mensagem do cliente
  // chegando durante a janela re-registraria o efeito, o cleanup rodaria e a
  // pendente sairia antes da hora — o "Desfazer" só funcionaria em conversa
  // parada, que é justamente quando ninguém precisa dele.
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  // Mesmo motivo do `onSendRef`: usado dentro de callbacks que não podem
  // trocar de identidade a cada render do pai.
  const onClearReplyRef = useRef(onClearReply);
  useEffect(() => {
    onClearReplyRef.current = onClearReply;
  }, [onClearReply]);

  // Ref espelhando a pendente: o cleanup do efeito de desmontagem precisa do
  // valor mais recente sem re-registrar o efeito a cada tecla.
  const pendenteRef = useRef<{
    texto: string;
    replyToId?: string;
    enviar: (texto: string, replyToId?: string) => void;
  } | null>(null);
  useEffect(() => {
    pendenteRef.current = pendente
      ? { texto: pendente.texto, replyToId: pendente.replyToId, enviar: pendente.enviar }
      : null;
  }, [pendente]);

  const descartarTimer = useCallback(() => {
    if (timerDesfazerRef.current) {
      clearTimeout(timerDesfazerRef.current);
      timerDesfazerRef.current = null;
    }
  }, []);

  /** Manda a pendente na hora (sem esperar o relógio) e limpa o estado. */
  const liberarPendente = useCallback(() => {
    descartarTimer();
    const p = pendenteRef.current;
    pendenteRef.current = null;
    setPendente(null);
    if (p) {
      // `p.enviar`, NUNCA `onSendRef.current`: o segundo já aponta para a
      // conversa que está na tela AGORA, que pode não ser a de origem.
      p.enviar(p.texto, p.replyToId);
      // A citação some só quando a mensagem SAI. Limpando no Enter, desfazer
      // devolvia o texto mas perdia a resposta citada — e o operador teria de
      // procurar de novo a mensagem que estava respondendo.
      onClearReplyRef.current?.();
    }
  }, [descartarTimer]);

  const desfazerEnvio = useCallback(() => {
    descartarTimer();
    const p = pendenteRef.current;
    pendenteRef.current = null;
    setPendente(null);
    if (!p) return;
    // Devolve o texto ao campo para o operador corrigir em vez de redigitar.
    setText(p.texto);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(p.texto.length, p.texto.length);
      adjustHeight();
    });
  }, [descartarTimer, adjustHeight]);

  /**
   * Agenda o texto para a hora do campo (925).
   *
   * ⚠️ Não encosta em `setPendente`, e isso é a regra inteira. A janela de
   * desfazer tem TRÊS saídas que disparam na hora — trocar de conversa,
   * desmontar o componente e apertar Enter de novo. Um "modo agendar" que
   * passasse por ela mandaria em três segundos a mensagem marcada para
   * amanhã, e o operador só descobriria pela resposta do cliente.
   */
  const agendar = useCallback(
    async (
      texto: string,
      // 932: o anexo já subiu para o bucket quando foi ANEXADO — aqui só se
      // guarda o endereço dele. `replyToId` é a citação, que a 925 não
      // levava.
      extra?: { anexo?: MediaDraft | null; replyToId?: string },
    ): Promise<boolean> => {
      const data = quandoAg;
      if (!data) {
        toast.error(tAgendadas("scheduleInvalid"));
        return false;
      }
      if (data.getTime() <= Date.now()) {
        toast.error(tAgendadas("scheduleInThePast"));
        return false;
      }
      if (agendandoRef.current) return false;
      agendandoRef.current = true;
      setAgendando(true);
      const anexo = extra?.anexo ?? null;
      // O arquivo passa a ser da agendada a partir daqui — ver `entreguesRef`.
      if (anexo) entreguesRef.current.add(anexo.path);
      try {
        const res = await fetch("/api/cb/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            body: texto,
            scheduled_for: data.toISOString(),
            // ⚠️ A URL NÃO vai — o servidor a deriva do caminho conferido.
            // Mandá-la daqui seria oferecer um campo que ele ignora, e a
            // próxima pessoa a ler isto acharia que ela importa.
            media_path: anexo?.path,
            media_kind: anexo?.kind,
            // Só o documento mostra o nome ao destinatário; mandar sempre
            // encheria a coluna com `voice-172….ogg`.
            media_filename: anexo?.kind === "document" ? anexo.filename : undefined,
            reply_to_message_id: extra?.replyToId,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          // Falhou: o arquivo volta a ser do rascunho, e volta a poder ser
          // recolhido se o operador sair da tela sem tentar de novo.
          if (anexo) entreguesRef.current.delete(anexo.path);
          toast.error(json.error ?? tAgendadas("scheduleFailed"));
          return false;
        }
        toast.success(tAgendadas("scheduled"));
        // ⚠️ O campo de texto só é limpo quando ELE é o que foi agendado.
        // Agendando um ANEXO, a legenda vem do rascunho e a caixa de mensagem
        // pode ter outra coisa sendo escrita — apagá-la seria destruir, em
        // silêncio, texto que ninguém mandou apagar.
        //
        // Quando é o texto mesmo, limpar é obrigatório: senão o operador manda
        // a mesma coisa agora e de novo na hora marcada.
        if (!anexo) setText("");
        // A hora sempre sai: o próximo envio tem de ser imediato por padrão —
        // hora esquecida no campo transformaria uma resposta urgente em algo
        // que sai amanhã.
        limparAgendamento();
        // ⚠️ A citação sai da tela porque já está GUARDADA na agendada (932):
        // deixá-la ali diria que a próxima coisa digitada também responde
        // àquela bolha.
        onClearReply?.();
        // A altura só volta ao normal quando o campo foi esvaziado.
        if (!anexo && textareaRef.current) textareaRef.current.style.height = "auto";
        onScheduled?.();
        return true;
      } catch {
        if (anexo) entreguesRef.current.delete(anexo.path);
        toast.error(tAgendadas("scheduleFailed"));
        return false;
      } finally {
        agendandoRef.current = false;
        setAgendando(false);
      }
    },
    [quandoAg, conversationId, onScheduled, onClearReply, tAgendadas, limparAgendamento],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sessionExpired) return;

    // ⚠️ DESVIO ANTES DE QUALQUER COISA. Com hora no campo, esta mensagem
    // não passa pela janela de desfazer nem pelo despachante — vai para a
    // fila e pronto. Ver a nota em `agendar`.
    if (quandoAg) {
      // 932: a citação vai junto. Antes ela era descartada, e a agendada
      // chegava ao cliente como uma frase solta.
      await agendar(trimmed, { replyToId: replyTo?.id });
      return;
    }

    // Já havia uma esperando: ela vai AGORA, para a ordem das mensagens na
    // conversa do cliente ser a mesma em que foram escritas.
    liberarPendente();

    // O DESPACHANTE É CAPTURADO AQUI, e isto é a correção inteira.
    //
    // O pai reconstrói `onSend` amarrado à conversa aberta. Resolvendo o
    // despachante só na hora de disparar, uma mensagem escrita para o
    // cliente A e retida por 5s era entregue ao cliente B se o operador
    // clicasse em outra conversa nesse intervalo — o compositor NÃO
    // remonta na troca, então nada interrompia a espera. Num escritório de
    // advocacia isso é quebra de sigilo, e silenciosa: some do histórico de
    // A e aparece no de B.
    const despachante = onSendRef.current;
    setPendente({
      texto: trimmed,
      replyToId: replyTo?.id,
      expiraEm: Date.now() + SEGUNDOS_DESFAZER * 1000,
      enviar: despachante,
    });
    pendenteRef.current = { texto: trimmed, replyToId: replyTo?.id, enviar: despachante };
    timerDesfazerRef.current = setTimeout(liberarPendente, SEGUNDOS_DESFAZER * 1000);

    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, sessionExpired, replyTo?.id, liberarPendente, quandoAg, agendar]);

  // Trocar de conversa solta a pendente na hora.
  //
  // O compositor NÃO remonta nessa troca (o pai só troca o objeto da
  // conversa, sem `key`), então sem isto a barra de "enviando" ficaria
  // pendurada na thread do cliente errado, e o "Desfazer" dali jogaria o
  // texto de um cliente no campo de outro. A mensagem em si já vai para o
  // lugar certo — `enviar` está preso à origem.
  //
  // ⚠️ E fecha a caixa de anotação junto, pelo MESMO motivo. Como o
  // compositor não remonta, a caixa aberta com texto dentro sobrevivia à
  // troca — e ela salva contra o `conversationId` do render atual, então
  // clicar em Salvar depois de trocar gravaria a anotação de um cliente na
  // conversa de outro. Numa anotação interna de escritório de advocacia isso
  // é vazamento de informação entre casos, não só um erro de UI. Fechar
  // desmonta o `InternalNoteBox`, e o texto que estava dentro vai junto.
  const conversaAnteriorRef = useRef(conversationId);
  useEffect(() => {
    if (conversaAnteriorRef.current === conversationId) return;
    conversaAnteriorRef.current = conversationId;
    liberarPendente();
    // ⚠️ E a hora escolhida vai junto. O compositor não remonta na troca, e
    // uma hora esquecida transforma a próxima mensagem — que pode ser "estou
    // ligando agora" para OUTRO cliente — em algo que sai amanhã. A etiqueta
    // âmbar avisa, mas avisar não é impedir.
    limparAgendamento();
    setSeletorAberto(false);
    setAnotando(false);
    // ⚠️ O anexo JÁ POUSADO segue o destino da anotação: o rascunho do
    // cliente A não pode continuar montado no compositor de B — um clique em
    // Enviar mandaria o documento de um caso para o outro. Mesma receita da
    // limpeza de desmonte lá em cima: recolhe o objeto (o `entreguesRef`
    // protege arquivo que já é de uma agendada) e limpa o estado.
    for (const d of draftsRef.current) removeStaged(d.path);
    setDrafts([]);
    setSelecionado(null);
    // ⚠️ E O TRINCO DA FILA SOLTA AQUI. Ele é liberado pelo `finally` de
    // `sendDraft`, que só roda quando o envio em voo assenta — e o `fetch`
    // de `/api/whatsapp/send` não tem prazo. Sem esta linha, sair de uma
    // conversa com a fila correndo levava o trinco junto: no cliente
    // seguinte o botão Enviar do anexo nascia desabilitado
    // (`busy={busy || enviandoFila}`) e um `sendDraft` novo era recusado
    // logo na entrada, sem toast e sem nada a clicar — até a requisição
    // velha voltar, ou para sempre se ela travasse. O laço de A não passa a
    // escrever na tela de B por causa da guarda de origem que ele carrega
    // (achado do Codex no PR #146).
    enviandoFilaRef.current = 0;
    setEnviandoFila(false);
    // ⚠️ E uma gravação EM CURSO morre aqui, descartada. Não é por a guarda
    // de origem falhar: o `ondataavailable` do gravador segura o
    // `finalizeRecording` do render em que a gravação COMEÇOU, cujo `origem`
    // é o cliente anterior — a guarda pegaria, e o áudio seria apagado no
    // fim do upload (o Codex corrigiu a versão anterior desta nota, que
    // dizia o contrário). Cancela-se aqui por dois motivos que sobram:
    // ninguém deve seguir gravando dentro do compositor de B uma fala que
    // já está condenada, e sem o cancelamento o upload dela ainda seria
    // pago para ser jogado fora. O `cancelledRef` faz o `ondataavailable`
    // ignorar os bytes que o encoder ainda devolver.
    clearTimer();
    cancelledRef.current = true;
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [conversationId, liberarPendente, limparAgendamento, removeStaged, clearTimer]);

  // Contagem regressiva da barra. Sem isto o rótulo repetiria o valor cheio
  // o tempo todo, inclusive no último instante antes de a mensagem sair.
  const [restam, setRestam] = useState(SEGUNDOS_DESFAZER);
  useEffect(() => {
    if (!pendente) return;
    const tick = () =>
      setRestam(Math.max(0, Math.ceil((pendente.expiraEm - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [pendente]);

  // Desmontagem (trocou de conversa, saiu da rota): envia em vez de perder.
  // Lista de dependências VAZIA de propósito — ver a nota em `onSendRef`.
  useEffect(() => {
    return () => {
      const p = pendenteRef.current;
      if (p) {
        pendenteRef.current = null;
        p.enviar(p.texto, p.replyToId);
      }
      if (timerDesfazerRef.current) clearTimeout(timerDesfazerRef.current);
    };
  }, []);

  // Fechar a aba é o único caso que não dá para salvar: a requisição não
  // sobrevive. Avisar é o melhor disponível.
  useEffect(() => {
    if (!pendente) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [pendente]);

  /**
   * Aplica um estilo à seleção do campo. Mexe no valor e RESTAURA a seleção:
   * sem isso o cursor pula para o fim a cada clique e formatar duas palavras
   * seguidas vira um exercício de paciência.
   */
  const formatar = useCallback(
    (estilo: EstiloFormatacao) => {
      const el = textareaRef.current;
      if (!el) return;
      const r = alternarMarcador(text, el.selectionStart, el.selectionEnd, estilo);
      setText(r.texto);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(r.inicio, r.fim);
        adjustHeight();
      });
    },
    [text, adjustHeight],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Atalhos iguais aos do WhatsApp Web, para não haver o que reaprender.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "b") {
          e.preventDefault();
          formatar("negrito");
          return;
        }
        if (k === "i") {
          e.preventDefault();
          formatar("italico");
          return;
        }
        if (e.shiftKey && k === "x") {
          e.preventDefault();
          formatar("riscado");
          return;
        }
      }
      // ⚠️ No aparelho de toque o retorno pula linha e só o botão envia —
      // o teclado do celular não tem Shift+Enter (ver `enterEnvia`). Lido
      // no momento da tecla, não no render: é a tecla que decide.
      if (enterEnvia(e, window.matchMedia(MIDIA_DE_TOQUE).matches)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, formatar]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "ai_not_configured") {
          toast.error("AI isn't set up yet — enable it in Settings → AI Assistant.");
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === "string" ? data.draft.trim() : "";
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    [],
  );

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window
      .prompt(t("quickReplyNamePrompt"))
      ?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: "interactive",
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("quickReplySaveError"));
        return;
      }
      toast.success(t("quickReplySaved"));
    } catch {
      toast.error(t("quickReplySaveError"));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === "interactive" && qr.interactive_payload) {
        // Botões/listas não entregam via Baileys — este atalho por resposta
        // rápida também precisa da barreira (o item direto já está oculto;
        // sem isto o envio morreria num 400 do servidor).
        if (ehEvolution(channelKind) || ehInstagram(channelKind)) {
          toast.error(t("interactiveNotOnChannel"));
          return;
        }
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      const body = qr.content_text ?? "";
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`,
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight, channelKind, t],
  );

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024,
          )} MB.`,
        );
        return;
      }
      const origem = conversationId;
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // ⚠️ Subir um arquivo leva segundos e o compositor NÃO remonta na
        // troca de conversa: sem esta conferência o anexo aterrissa no
        // rascunho do cliente que estiver aberto quando o upload termina.
        // O objeto recém-subido não serve a ninguém — apaga junto.
        if (conversaAnteriorRef.current !== origem) {
          removeStaged(path);
          return;
        }
        // ⚠️ ACRESCENTA à fila (não substitui): o compositor passou a levar
        // vários anexos, e cada um vira uma mensagem.
        const item = novoDraft({ kind, mediaUrl: publicUrl, path, filename: file.name, caption: "" });
        setDrafts((atual) => [...atual, item]);
        setSelecionado((atual) => atual ?? item.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, conversationId],
  );

  /**
   * Sobe vários, em sequência. ⚠️ O tipo de cada um é resolvido pelo MIME —
   * o seletor de "imagem" pode receber um PDF arrastado para o mesmo campo,
   * e o `kind` errado manda o arquivo pelo endpoint errado do WhatsApp.
   */
  const stageUploads = useCallback(
    async (arquivos: readonly File[]) => {
      for (const bruto of arquivos) {
        // ⚠️ Ajusta NOME e MIME antes de subir. O print colado costuma vir sem
        // nome útil (ou como "image.png" em toda colagem), e o MIME pode vir
        // com parâmetro (`image/png; charset=binary`) — que o bucket, de lista
        // exata, recusa. Ver `arquivoParaEnviar`.
        const arquivo = arquivoParaEnviar(bruto);
        const tipo = tipoDoArquivo(arquivo.type);
        if (!tipo) continue;
        await stageUpload(tipo, arquivo);
      }
    },
    [stageUpload],
  );

  /**
   * Arquivo que chegou sem passar pelo seletor: arrastado para a conversa ou
   * colado com Ctrl+V. Um anexo por vez — o compositor carrega um só —, e o
   * que o seletor recusaria é recusado aqui também, com aviso.
   */
  const receberArquivos = useCallback(
    (arquivos: readonly File[]) => {
      if (readOnly || sessionExpired || busy) return;
      const r = escolherArquivos(arquivos, draftsRef.current.length);
      // Cada descarte tem seu aviso: o operador precisa saber o que NÃO foi.
      if (r.recusados > 0) toast.error(t("arquivoNaoSuportado", { n: r.recusados }));
      if (r.excedentes > 0) toast.error(t("tetoDeAnexos", { max: MAX_ANEXOS, n: r.excedentes }));
      if (r.aceitos.length === 0) return;
      // ⚠️ Um de cada vez, com `await` dentro de `stageUploads`: dez uploads
      // simultâneos disputam a banda e a ordem da fila viraria a ordem de
      // conclusão, não a que a pessoa soltou.
      void stageUploads(r.aceitos);
    },
    [readOnly, sessionExpired, busy, stageUploads, t],
  );

  /**
   * ⚠️ O seletor passa pelo MESMO funil do arrastar (`receberArquivos`): ele
   * é quem aplica o teto e avisa o que ficou de fora. Chamar `stageUploads`
   * direto daqui ignorava `MAX_ANEXOS` — escolher uma pasta inteira subia e
   * mandava tudo, apesar do limite anunciado (achado do Codex no PR #144).
   */
  const handlePicked = useCallback(
    (_kind: "image" | "video" | "document", files: FileList | null) => {
      if (files && files.length > 0) receberArquivos(Array.from(files));
    },
    [receberArquivos],
  );

  const [arrastando, setArrastando] = useState(false);
  // Contador, não booleano: `dragleave` dispara ao passar de um filho para
  // outro dentro da mesma zona, e um booleano faria o destaque piscar.
  const profundidadeDoArrasto = useRef(0);

  const aoArrastarEntrando = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    profundidadeDoArrasto.current += 1;
    setArrastando(true);
  }, []);

  const aoArrastarSaindo = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    profundidadeDoArrasto.current = Math.max(0, profundidadeDoArrasto.current - 1);
    if (profundidadeDoArrasto.current === 0) setArrastando(false);
  }, []);

  const aoArrastarSobre = useCallback((e: React.DragEvent) => {
    // ⚠️ Só intercepta ARQUIVO. Texto arrastado (selecionar e puxar) tem de
    // continuar caindo na caixa como texto, que é o padrão do navegador.
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const aoSoltar = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      profundidadeDoArrasto.current = 0;
      setArrastando(false);
      receberArquivos(Array.from(e.dataTransfer.files));
    },
    [receberArquivos],
  );

  const aoColar = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const arquivos = Array.from(e.clipboardData.files);
      // ⚠️ Colagem com texto junto NÃO vira upload — ver `colagemEhAnexo`.
      if (!colagemEhAnexo({ temArquivo: arquivos.length > 0, texto: e.clipboardData.getData("text/plain") })) {
        return;
      }
      e.preventDefault();
      receberArquivos(arquivos);
    },
    [receberArquivos],
  );

  /**
   * Item do acervo (953) escolhido: vira o MESMO rascunho de um arquivo
   * recém-subido — com legenda, prévia, envio agora ou agendamento.
   *
   * ⚠️ A rota COPIA o objeto e devolve o caminho da cópia. É por isso que o
   * `removeStaged` daqui embaixo é seguro: o que ele pode vir a apagar é a
   * cópia, nunca o arquivo do acervo. Enviar por referência faria um envio
   * falho apagar o contrato-padrão do escritório inteiro — ver o cabeçalho de
   * `api/cb/acervo/[id]/copiar`.
   *
   * ⚠️ E confere a conversa ao voltar, como o `stageUpload`: o compositor não
   * remonta na troca, então a cópia em voo aterrissaria no rascunho de quem
   * estivesse aberto — o documento do cliente A pronto para enviar ao B.
   */
  const escolherDoAcervo = useCallback(
    async (item: MediaLibraryItem) => {
      setAcervoOpen(false);
      const origem = conversationId;
      setBusy(true);
      try {
        const res = await fetch(`/api/cb/acervo/${item.id}/copiar`, {
          method: "POST",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.path) {
          toast.error(t("acervoError"));
          return;
        }
        if (conversaAnteriorRef.current !== origem) {
          // A cópia é do acervo, mas é CÓPIA: apagá-la não toca o original.
          removeStaged(json.path as string);
          return;
        }
        const novo = novoDraft({
          kind: json.kind as ComposerMediaKind,
          mediaUrl: json.mediaUrl as string,
          path: json.path as string,
          filename: (json.filename as string) ?? item.filename,
          caption: "",
        });
        setDrafts((atual) => [...atual, novo]);
        setSelecionado((atual) => atual ?? novo.id);
      } catch {
        toast.error(t("acervoError"));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t, conversationId],
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error("Recording is too long (over 16 MB).");
        return;
      }
      const origem = conversationId;
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // ⚠️ Subir um arquivo leva segundos e o compositor NÃO remonta na
        // troca de conversa: sem esta conferência a nota de voz sobre o caso
        // de A aterrissa no rascunho do cliente que estiver aberto quando o
        // upload termina — e um Enviar entrega áudio sigiloso de um cliente a
        // outro. É a MESMA guarda de `stageUpload` e `escolherDoAcervo`; são
        // TRÊS cópias de propósito (três linhas parecidas > abstração
        // prematura), e um caminho de upload novo entra nela também.
        // A troca DURANTE a gravação não chega aqui: o efeito de troca
        // cancela o gravador antes (ver `conversaAnteriorRef`).
        if (conversaAnteriorRef.current !== origem) {
          removeStaged(path);
          return;
        }
        const nota = novoDraft({ kind: "audio", mediaUrl: publicUrl, path, filename: file.name, caption: "" });
        setDrafts((atual) => [...atual, nota]);
        setSelecionado((atual) => atual ?? nota.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, conversationId],
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error("Microphone access denied or unavailable.");
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  /**
   * Envia (ou agenda) a fila inteira, UM item por vez.
   *
   * ⚠️ SEQUENCIAL, com `await`: não existe "mensagem com 3 anexos" no
   * WhatsApp — cada item é uma mensagem —, e disparar as três de uma vez as
   * entregaria fora de ordem no celular do cliente. A prop `onSendMedia`
   * aceita promessa justamente para isto.
   *
   * ⚠️ O que JÁ SAIU sai da fila, mesmo se o próximo falhar: reenviar do
   * começo mandaria o primeiro anexo duas vezes ao cliente.
   */
  const sendDraft = useCallback(async () => {
    // ⚠️ TRINCO SÍNCRONO, e por isso um ref: `busy` é estado, e entre o
    // clique e o próximo render cabe um segundo clique (ou um segundo Enter)
    // — que iteraria sobre a MESMA fila capturada e mandaria todos os anexos
    // de novo ao cliente (achado do Codex no PR #144).
    if (drafts.length === 0 || busy || enviandoFilaRef.current !== 0) return;
    // ⚠️ A POSSE é também a GERAÇÃO que cancela este laço. O compositor NÃO
    // remonta na troca de conversa e cada item da fila é um `await`: sem
    // cancelar, trocar de cliente no meio de uma fila de cinco deixava o laço
    // seguir escrevendo no compositor do cliente NOVO — o `setDrafts(...)` do
    // ramo agendado devolvia à tela dele os anexos que sobraram do anterior, e
    // o `onClearReply()` do fim apagava a citação que ele acabou de escolher.
    //
    // ⚠️⚠️ Comparar o `conversationId` NÃO basta, e essa foi a primeira versão
    // (achado do Codex no PR #148): em A → B → A a conversa volta a ser a
    // mesma, o laço abandonado de A volta a casar e retoma como se nada
    // tivesse acontecido — mandando anexos cujos objetos o efeito de troca já
    // apagou do bucket e limpando a citação da sessão NOVA de A. A posse é
    // única por invocação e o efeito de troca a zera, então toda navegação
    // invalida o laço velho PARA SEMPRE, qualquer que seja o caminho.
    const posse = ++proximaPosseRef.current;
    enviandoFilaRef.current = posse;
    setEnviandoFila(true);
    // A citação que ESTA fila leva. Guardada porque o operador pode escolher
    // outra enquanto os anexos saem, e o fim do laço não pode apagar a nova.
    const citada = replyTo?.id;
    try {

    // ⚠️ DESVIO ANTES DE QUALQUER COISA, igual ao do texto (925). Com hora
    // escolhida, os anexos vão para a fila de agendadas em vez de sair agora
    // — uma linha por anexo, que é como a tabela guarda (932).
      if (quandoAg) {
        const restantes: MediaDraft[] = [];
        for (const item of drafts) {
          const legenda = podeTerLegenda(item.kind) ? item.caption.trim() : "";
          const ok = await agendar(legenda, { anexo: item, replyToId: citada });
          // ⚠️ Só sai da fila quando DEU CERTO, e sem apagar o objeto do
          // bucket: ele passou a pertencer à agendada, e o disparador vai
          // buscá-lo lá daqui a horas. Falhou? O item fica na tela, com o
          // arquivo já subido, e a pessoa tenta de novo sem reanexar.
          if (!ok) restantes.push(item);
          if (enviandoFilaRef.current !== posse) return;
        }
        setDrafts(restantes);
        setSelecionado(restantes[0]?.id ?? null);
        return;
      }

      for (const item of drafts) {
        const entregou = await onSendMedia({
          kind: item.kind,
          mediaUrl: item.mediaUrl,
          path: item.path,
          // Audio takes no caption (Meta rejects it). Everything else: the
          // trimmed caption, or undefined when blank.
          caption: podeTerLegenda(item.kind) ? item.caption.trim() || undefined : undefined,
          filename: item.kind === "document" ? item.filename : undefined,
          replyToId: citada,
        });
        // ⚠️ PARA no primeiro que não entregou, e o item FICA na fila com o
        // arquivo ainda no bucket. Seguir daria um toast de erro por anexo
        // quando a causa é a mesma para todos (janela de 24h fechada, rede
        // fora) — e o operador perderia as legendas já escritas.
        if (!entregou) return;
        if (enviandoFilaRef.current !== posse) return;
        // O objeto passou a ser da mensagem enviada — sai da fila sem recolher.
        setDrafts((atual) => atual.filter((d) => d.id !== item.id));
      }
      setSelecionado(null);
      // ⚠️⚠️ Limpa SÓ a citação que saiu, e quem compara é o DONO do estado.
      //
      // O operador pode clicar Responder noutra mensagem enquanto os anexos
      // sobem, e limpar cegamente apagaria a escolha que ele acabou de fazer
      // (Codex, PR #148). A primeira versão comparava contra um ref alimentado
      // por `useEffect` — e aí a corrida volta pela porta dos fundos: efeito é
      // PASSIVO, então a promessa do upload pode assentar depois de o React
      // comprometer o `replyTo` novo e ANTES de o efeito atualizar o ref. Na
      // janela, o ref ainda tem o id velho, a comparação passa, e apaga-se
      // justamente a citação nova — o defeito que esta guarda existe para
      // impedir (Codex, PR #149). É a armadilha de efeito passivo que o
      // CLAUDE.md já registra quatro vezes.
      //
      // Passando o id, `setReplyTo` decide com o estado MAIS FRESCO, dentro do
      // próprio updater. Não há janela: não há cópia a envelhecer.
      onClearReply?.(citada);
    } finally {
      // ⚠️ CERCA DE POSSE: só solta quem ainda é o dono. Solto pelo efeito de
      // troca e com outro envio já em curso na conversa nova, limpar aqui
      // abriria o trinco DELE — e o próximo clique mandaria os anexos de novo.
      if (enviandoFilaRef.current === posse) {
        enviandoFilaRef.current = 0;
        setEnviandoFila(false);
      }
    }
  }, [drafts, busy, onSendMedia, replyTo?.id, onClearReply, quandoAg, agendar]);

  /** Descarta UM item — recolhe o objeto, que subiu e não foi enviado. */
  const discardDraft = useCallback(
    (id: string) => {
      const alvo = draftsRef.current.find((d) => d.id === id);
      removeStaged(alvo?.path);
      setDrafts((atual) => {
        const resto = atual.filter((d) => d.id !== id);
        setSelecionado((sel) => (sel === id ? (resto[0]?.id ?? null) : sel));
        return resto;
      });
    },
    [removeStaged],
  );

  /** Descarta a fila inteira. */
  const discardAll = useCallback(() => {
    for (const d of draftsRef.current) removeStaged(d.path);
    setDrafts([]);
    setSelecionado(null);
  }, [removeStaged]);

  const setCaption = useCallback((id: string, caption: string) => {
    setDrafts((atual) => atual.map((d) => (d.id === id ? { ...d, caption } : d)));
  }, []);

  // ---- Render --------------------------------------------------------

  // Templates são um conceito da API oficial — o botão some no canal
  // Evolution e enquanto o transporte é desconhecido (M12). A MESMA régua
  // decide se a formatação cabe na linha dos botões (abaixo).
  const mostraModelos =
    transporteConhecido && !ehEvolution(channelKind) && !ehInstagram(channelKind);
  // Os marcadores do WhatsApp (negrito, itálico, riscado, monoespaçado).
  // ⚠️ No CELULAR eles sobem para a linha dos botões quando CABEM (pedido do
  // operador, 15/09/2026: a linha própria era espaço perdido embaixo). Pelas
  // classes, a 390 px sobram 366 px, e clipe, +, ✨, anotação, os quatro
  // marcadores, microfone, relógio e enviar ocupam 358. Os dois casos que
  // tomam aquele espaço — a etiqueta da hora agendada e o botão de modelos do
  // número oficial — e as telas abaixo de 390 px mantêm a linha própria de
  // sempre. No computador nada muda.
  const formatacaoNaLinha = !quandoAg && !mostraModelos;
  const botoesDeFormato = (
    <>
      <BotaoFormato onClick={() => formatar("negrito")} title={t("bold")}>
        <span className="font-bold">N</span>
      </BotaoFormato>
      <BotaoFormato onClick={() => formatar("italico")} title={t("italic")}>
        <span className="italic">I</span>
      </BotaoFormato>
      <BotaoFormato onClick={() => formatar("riscado")} title={t("strike")}>
        <span className="line-through">S</span>
      </BotaoFormato>
      <BotaoFormato onClick={() => formatar("mono")} title={t("mono")}>
        <span className="font-mono text-[10px]">{"</>"}</span>
      </BotaoFormato>
    </>
  );

  return (
    <div
      className="relative border-t border-border bg-card p-3"
      onDragEnter={aoArrastarEntrando}
      onDragOver={aoArrastarSobre}
      onDragLeave={aoArrastarSaindo}
      onDrop={aoSoltar}
    >
      {/* Alvo de soltura: só aparece com arquivo sendo arrastado, e é
          `pointer-events-none` para não engolir o `drop` que ele anuncia. */}
      {arrastando && (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10">
          <span className="text-sm font-medium text-primary">{t("solteParaAnexar")}</span>
        </div>
      )}
      {/* Mensagem retida: enquanto esta barra estiver visível, nada saiu. */}
      {pendente && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t("sendingIn", { seconds: restam })} &mdash; {pendente.texto}
          </span>
          <button
            type="button"
            onClick={desfazerEnvio}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            {t("undoSend")}
          </button>
        </div>
      )}
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            // ⚠️ Embrulhado, nunca a referência crua: `onDismiss` vira o
            // `onClick` do X, e o React passaria o MouseEvent como
            // `idQueSaiu` — o dono compararia o id da citação com um evento,
            // não limparia nada, e o botão morreria em silêncio.
            onDismiss={() => onClearReply?.()}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            {t("sessionExpiredHint")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t("templates")}
          </Button>
        </div>
      )}

      {/* Caixa de anotação interna (918/919) — componente próprio.
          ⚠️ Ela tem <textarea> PRÓPRIA, nunca a do compositor: o
          `handleKeyDown` de lá manda Enter para `handleSend`, e a anotação
          sairia como mensagem para o cliente. */}
      {anotando && (
        <InternalNoteBox
          conversationId={conversationId}
          onSaved={onNoteCreated}
          onClose={fecharNota}
        />
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("image", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("video", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked("document", e.target.files);
          e.target.value = "";
        }}
      />

      {drafts.length > 0 ? (
        <MediaDraftPreview
          drafts={drafts}
          selecionadoId={selecionado}
          onSelecionar={setSelecionado}
          busy={busy || enviandoFila}
          readOnly={readOnly}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onDiscardAll={discardAll}
          onSend={() => void sendDraft()}
          // 932: a prévia SUBSTITUI o compositor, então o relógio precisa
          // existir aqui também — senão anexar um arquivo tira a opção de
          // agendar da tela.
          ag={ag}
          agendando={agendando}
          inputsDisabled={inputsDisabled}
          tAgendadas={tAgendadas}
          t={t}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-foreground">
            {t("recording", { current: formatDuration(recordSeconds), max: formatDuration(MAX_RECORDING_SECONDS) })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90"
            title={t("stopAndAttach")}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        // ⚠️ No CELULAR a linha QUEBRA e a caixa de texto fica sozinha na
        // primeira linha (`order-first basis-full`), com os botões embaixo:
        // são sete botões de 36px numa tela de 375px, e a caixa sobrava com
        // 85px — "Digite uma" quebrando no meio (reportado da tela pelo
        // operador, 09/09/2026). A partir de `sm` volta a linha única de
        // sempre; `sm:basis-0` devolve exatamente o `flex-1` da caixa.
        <div className="flex flex-wrap items-end gap-0.5 sm:flex-nowrap">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("attachMedia")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {/* O acervo vem PRIMEIRO: é o caminho curado, o que o escritório
                  quer que a equipe use. Procurar no computador é a exceção. */}
              <DropdownMenuItem onClick={() => setAcervoOpen(true)}>
                <Library className="mr-2 h-4 w-4" />
                {t("fromLibrary")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t("photo")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                {t("video")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                {t("document")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + menu — interactive messages + quick replies. Gated on the
              24h window like free-form text (interactive requires it). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={
                readOnly
                  ? t("readOnlyTitle")
                  : inputsDisabled
                    ? undefined
                    : t("moreActions")
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {/* Botões/listas não entregam via Baileys — o item some no
                  canal Evolution; respostas rápidas de texto continuam.
                  Transporte desconhecido também esconde (M12). */}
              {transporteConhecido && !ehEvolution(channelKind) && !ehInstagram(channelKind) && (
                <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                  <MessageSquareDashed className="mr-2 h-4 w-4" />
                  {t("interactiveMessage")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                {t("quickReplies")}
              </DropdownMenuItem>
              {/* Executar automação/robô para ESTE cliente (955). Só em
                  conversa de contato — em grupo o fio não passa o callback. */}
              {onExecutarAutomacao && (
                <DropdownMenuItem onClick={onExecutarAutomacao}>
                  <Play className="mr-2 h-4 w-4" />
                  {t("runAutomation")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Templates são um conceito da API oficial — o botão some no
              canal Evolution e enquanto o transporte é desconhecido (M12):
              aberto nesse vão, o TemplatePicker nasceria com channelId nulo
              e o catálogo sairia sem o recorte por WABA. */}
          {mostraModelos && (
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              title={readOnly ? undefined : t("sendTemplate")}
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4" />
            </GatedButton>
          )}

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting}
            title={readOnly ? undefined : t("draftWithAI")}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-primary"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </GatedButton>

          {/* Anotação interna.
              ⚠️ NÃO usa `inputsDisabled`. Aquele sinalizador carrega o
              `sessionExpired`, que é a janela de 24h da Meta — regra de envio
              ao CLIENTE. Anotação não sai daqui: travá-la quando a janela
              fecha mataria a feature justamente na conversa parada, que é
              onde mais se anota ("liguei, não atendeu"). Só o papel decide, e
              o papel aqui inclui `viewer`. */}
          {podeAnotar && (
            <Button
              variant="ghost"
              size="sm"
              title={t("internalNote")}
              onClick={() => setAnotando((v) => !v)}
              className={cn(
                "h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-amber-600",
                anotando && "text-amber-600",
              )}
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          )}

          {/* Formatação na linha dos botões: só no celular a partir de 390 px,
              e só quando cabe (`formatacaoNaLinha`, com a conta). `h-9` põe os
              marcadores no meio da linha de botões de 36 px, que alinha pela
              base. */}
          {formatacaoNaLinha && drafts.length === 0 && (
            <div className="hidden h-9 shrink-0 items-center gap-1 min-[390px]:max-sm:flex">
              {botoesDeFormato}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={aoColar}
            placeholder={
              readOnly
                ? t("readOnlyPlaceholder")
                : sessionExpired
                  ? t("sessionExpiredPlaceholder")
                  : toque
                    ? t("typeMessagePlaceholderTouch")
                    : t("typeMessagePlaceholder")
            }
            disabled={sessionExpired || readOnly}
            rows={1}
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t("readOnlyTitle") : undefined}
            className={cn(
              "order-first flex-1 basis-full resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 sm:order-none sm:basis-0",
              (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
            )}
          />

          {/* Gravar nota de voz.
              ⚠️ Botão PRÓPRIO, fora do menu do clipe, a pedido do operador:
              gravar voz é das ações mais repetidas do atendimento e estava a
              dois cliques, escondida atrás de um ícone que anuncia "anexar
              arquivo". Fica à direita, junto do relógio e do enviar, que é
              onde a mão já está quando se termina de escrever.
              ⚠️ `inputsDisabled` como o resto do que sai para o cliente: a
              nota de voz é mensagem, e fora da janela de 24h da Meta ela não
              sairia. `busy` porque um upload em curso já ocupa o compositor. */}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={inputsDisabled || busy}
              title={t("voiceNote")}
              onClick={() => void startRecording()}
              // `max-sm:ml-auto`: na segunda linha do celular, gravar,
              // agendar e enviar ficam à direita, como na linha única.
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 max-sm:ml-auto"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}

          {/* Agendar (925) — SELETOR que abre ACIMA do botão, nunca um
              diálogo, e a hora escolhida vira uma etiqueta enxuta aqui do
              lado. O campo cru não cabe nesta linha: medido com a ficha do
              contato aberta, um `datetime-local` de 168px derrubava a caixa
              de mensagem de 312px para 136px — menor que o próprio campo, na
              tela em que se escreve.
              ⚠️ `inputsDisabled` (e não só o papel): agendar É enviar ao
              cliente, com atraso. Fora da janela de 24h da Meta a mensagem
              não sairia de jeito nenhum. */}
          {!readOnly && (
            <SeletorDeHorario ag={ag} disabled={inputsDisabled} t={tAgendadas} />
          )}

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || sessionExpired || agendando}
            onClick={handleSend}
            // O rótulo muda junto com a etiqueta: o mesmo botão faz coisas
            // diferentes, e quem passa o mouse tem de saber qual.
            title={quandoAg ? tAgendadas("scheduleAction") : undefined}
            className={cn(
              // O segundo `max-sm:ml-auto` só age quando o microfone não é
              // renderizado (somente-leitura): com ele, o primeiro já levou
              // o espaço todo e este fica colado ao lado.
              "h-9 w-9 shrink-0 p-0 disabled:opacity-40 max-sm:ml-auto",
              quandoAg
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-primary hover:bg-primary/90",
            )}
          >
            {agendando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : quandoAg ? (
              <CalendarClock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {drafts.length === 0 && !recording && (
        // Sem o recuo no celular: lá a caixa começa na borda esquerda. Com
        // `formatacaoNaLinha`, a partir de 390 px os marcadores estão na linha
        // dos botões, e esta linha some no celular (a dica do ✨ já não
        // aparecia ali).
        <div
          className={cn(
            "mt-1 flex items-center gap-1 sm:pl-[5.5rem]",
            formatacaoNaLinha && "min-[390px]:max-sm:hidden",
          )}
        >
          {/* Inserem os marcadores do WhatsApp na seleção. O texto enviado
              continua sendo `*assim*` — é o próprio WhatsApp que formata do
              outro lado; os botões só poupam decorar a sintaxe. */}
          {botoesDeFormato}
          {/* A dica some no celular: em 375px ela vira três linhas de 10px
              embaixo de um compositor que já ocupa duas — o ✨ continua ali,
              com o `title`. */}
          <p className="ml-1 hidden text-[10px] text-muted-foreground sm:block">{t("draftHint")}</p>
        </div>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("interactiveMessage")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t("saveAsQuickReply")}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />

      <AcervoPicker
        open={acervoOpen}
        onOpenChange={setAcervoOpen}
        onPick={(item) => void escolherDoAcervo(item)}
      />

      {/* Agendar (925). Leva o texto que está no campo; agendar LIMPA o
          campo, do mesmo jeito que enviar — senão o operador manda a mesma
          coisa duas vezes, uma agora e outra na hora marcada. */}
    </div>
  );
}


/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
/**
 * Quanto o operador pode digitar de legenda.
 *
 * ⚠️ A Meta corta em 1024 o texto FINAL, e desde a 923 o servidor prefixa a
 * assinatura antes de mandar. Enquanto o contador daqui dizia 1024 e o
 * servidor exigia 1024 menos o prefixo, dava para escrever uma legenda que o
 * campo aceitava e o envio recusava — depois de o arquivo já ter subido, que
 * é o momento mais caro possível para descobrir: a mídia é descartada do
 * bucket e o operador reanexa e redigita tudo.
 */
function useTetoDaLegenda(): number {
  const { profile, assinaturaAtiva } = useAuth();
  const nome = assinaturaAtiva
    ? nomeDePessoa(profile?.full_name, profile?.email)
    : null;
  return tetoDaLegenda(custoDaAssinatura(nome));
}

function MediaDraftPreview({
  drafts,
  selecionadoId,
  onSelecionar,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onDiscardAll,
  onSend,
  ag,
  agendando,
  inputsDisabled,
  tAgendadas,
  t,
}: {
  /** A fila inteira; cada item vira UMA mensagem. */
  drafts: MediaDraft[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (id: string, caption: string) => void;
  onDiscard: (id: string) => void;
  onDiscardAll: () => void;
  onSend: () => void;
  ag: Agendamento;
  agendando: boolean;
  inputsDisabled: boolean;
  tAgendadas: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}) {
  const tetoDaLegenda = useTetoDaLegenda();
  // ⚠️ Resolvido no RENDER, com queda para o primeiro: descartar o item
  // selecionado deixaria a prévia em branco por um quadro se dependesse de
  // efeito. Mesma armadilha do "efeito passivo" do CLAUDE.md.
  const draft = drafts.find((d) => d.id === selecionadoId) ?? drafts[0]!;
  const varios = drafts.length > 1;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      {/* Tira de miniaturas — só com mais de um. Com um só ela não escolhe
          nada e ocuparia altura à toa. */}
      {varios && (
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
          {drafts.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelecionar(d.id)}
              title={d.filename}
              className={cn(
                "relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background",
                d.id === draft.id ? "border-primary ring-2 ring-primary/30" : "border-border",
              )}
            >
              {d.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.mediaUrl} alt={d.filename} className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-0.5 px-1">
                  {d.kind === "video" ? (
                    <Video className="h-4 w-4 text-muted-foreground" />
                  ) : d.kind === "audio" ? (
                    <Mic className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="w-full truncate text-[9px] text-muted-foreground">{d.filename}</span>
                </span>
              )}
              <span className="absolute left-0 top-0 rounded-br bg-background/85 px-1 text-[9px] font-medium text-muted-foreground">
                {i + 1}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={onDiscardAll}
            className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("removeAllAttachments")}
          </button>
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === "video" && (
            <video src={draft.mediaUrl} controls className="max-h-40 rounded-lg" />
          )}
          {draft.kind === "audio" && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDiscard(draft.id)}
          aria-label={t("removeAttachment")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {podeTerLegenda(draft.kind) && (
          <input
            value={draft.caption}
            maxLength={tetoDaLegenda}
            onChange={(e) => onCaptionChange(draft.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={varios ? t("addCaptionFor", { arquivo: draft.filename }) : t("addCaption")}
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
          />
        )}
        {/* ⚠️ O mesmo seletor da linha normal, não uma cópia: a prévia
            SUBSTITUI o compositor, e sem ele anexar um arquivo tirava a opção
            de agendar da tela. */}
        {!readOnly && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              // Sem legenda (áudio) não há campo empurrando: o bloco vai para
              // a direita sozinho.
              !podeTerLegenda(draft.kind) && "ml-auto",
            )}
          >
            <SeletorDeHorario ag={ag} disabled={inputsDisabled} t={tAgendadas} />
          </div>
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy || agendando}
          onClick={onSend}
          // O mesmo botão faz coisas diferentes conforme a hora esteja
          // escolhida ou não — e quem passa o mouse tem de saber qual.
          title={ag.quandoAg ? tAgendadas("scheduleAction") : undefined}
          className={cn(
            "h-9 w-9 shrink-0 p-0 disabled:opacity-40",
            ag.quandoAg
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-primary hover:bg-primary/90",
          )}
        >
          {agendando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : ag.quandoAg ? (
            <CalendarClock className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </GatedButton>
        {/* Quantas mensagens vão sair — cada anexo é uma. Sem isto, clicar
            em Enviar com a fila cheia surpreende. */}
        {varios && (
          <span className="shrink-0 self-center text-xs text-muted-foreground">
            {t("enviarNAnexos", { n: drafts.length })}
          </span>
        )}
      </div>
    </div>
  );
}

/** Botãozinho da barra de formatação. */
function BotaoFormato({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // `onMouseDown` com preventDefault: sem isso o clique tira o foco do
      // campo e a seleção some ANTES de o handler rodar — o botão formataria
      // um trecho vazio.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * O estado do agendamento, num objeto só.
 *
 * ⚠️ Existe desde a 932 porque o seletor de horário passou a ter DOIS lugares:
 * a linha normal do compositor e a prévia do anexo — que substitui o
 * compositor inteiro quando há arquivo anexado. Sem isto, agendar mídia
 * exigiria uma segunda cópia de ~130 linhas de seletor, e as duas
 * envelheceriam separadas.
 */
interface Agendamento {
  quandoAg: Date | null;
  dataAg: string;
  horaAg: string;
  setDataAg: (v: string) => void;
  setHoraAg: (v: string) => void;
  atalhoAtivo: ChaveDeAtalho | null;
  setAtalhoAtivo: (v: ChaveDeAtalho | null) => void;
  aplicarAtalho: (chave: ChaveDeAtalho, horas: number) => void;
  limparAgendamento: () => void;
  seletorAberto: boolean;
  setSeletorAberto: (v: boolean) => void;
  abrirSeletor: (aberto: boolean) => void;
}

/**
 * Agendar (925) — SELETOR que abre ACIMA do botão, nunca um diálogo, e a hora
 * escolhida vira uma etiqueta enxuta aqui do lado. O campo cru não cabe nesta
 * linha: medido com a ficha do contato aberta, um `datetime-local` de 168px
 * derrubava a caixa de mensagem de 312px para 136px — menor que o próprio
 * campo, na tela em que se escreve.
 *
 * ⚠️ `disabled` recebe `inputsDisabled` (e não só o papel): agendar É enviar
 * ao cliente, com atraso. Fora da janela de 24h da Meta a mensagem não sairia
 * de jeito nenhum.
 *
 * ⚠️ Módulo, não aninhado: aninhado, os campos de data e hora remontariam a
 * cada tecla do compositor e perderiam o foco.
 */
function SeletorDeHorario({
  ag,
  disabled,
  t,
}: {
  ag: Agendamento;
  disabled: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      {/* A etiqueta é a peça de segurança desta tela, não enfeite:
          com hora escolhida o botão ao lado AGENDA em vez de enviar,
          e isso precisa estar visível. Escondido, o atendente
          digitaria uma resposta urgente e ela sairia amanhã. */}
      {ag.quandoAg && (
        <button
          type="button"
          onClick={() => ag.setSeletorAberto(true)}
          title={t("scheduleField", { min: CICLO_MINUTOS })}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-amber-500 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400"
        >
          {ag.quandoAg.toLocaleString(undefined, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("scheduleClear")}
            title={t("scheduleClear")}
            onClick={(e) => {
              e.stopPropagation();
              ag.limparAgendamento();
            }}
            className="rounded p-0.5 hover:bg-amber-500/20"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      )}

      <Popover open={ag.seletorAberto} onOpenChange={ag.abrirSeletor}>
        <PopoverTrigger
          disabled={disabled}
          title={t("scheduleField", { min: CICLO_MINUTOS })}
          aria-label={t("scheduleField", { min: CICLO_MINUTOS })}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            ag.quandoAg && "text-amber-600",
          )}
        >
          <Clock className="h-4 w-4" />
        </PopoverTrigger>
        {/* `side="top"`: o compositor mora no rodapé da tela, e um
            seletor abrindo para baixo nasceria fora da janela. */}
        <PopoverContent side="top" align="end" sideOffset={8} className="w-72">
          <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("scheduleTitle")}
          </p>
          {/* Os cinco prazos que o operador pediu. Pintam os dois
              campos de uma vez; editar qualquer campo na mão apaga o
              destaque, porque aí o valor deixou de ser o do atalho. */}
          <div className="flex flex-nowrap gap-1">
            {ATALHOS_DE_PRAZO.map((a) => (
              <button
                key={a.chave}
                type="button"
                onClick={() => ag.aplicarAtalho(a.chave, a.horas)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                  ag.atalhoAtivo === a.chave
                    ? "border-amber-500 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`preset_${a.chave}`)}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="date"
              value={ag.dataAg}
              min={hojeParaInput()}
              onChange={(e) => {
                ag.setDataAg(e.target.value);
                ag.setAtalhoAtivo(null);
              }}
              aria-label={t("date")}
              className="h-9 flex-1 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
            <input
              type="time"
              value={ag.horaAg}
              // ⚠️ `step` em SEGUNDOS. 900 = 15 min, e é o que faz o
              // seletor nativo oferecer só :00/:15/:30/:45 — a mesma
              // grade do ciclo do agendador.
              step={CICLO_MINUTOS * 60}
              onChange={(e) => {
                // Teclado ignora o `step`: quem digitar 21:37 tem o
                // valor subido para 21:45. Arredondar aqui evita
                // prometer uma precisão que o ciclo não entrega.
                //
                // ⚠️ E a DATA anda junto. Arredondar 23:50 dá 00:00 do
                // dia SEGUINTE; gravando só a hora, o par virava
                // "00:00 de hoje" — ou seja, a escolha da pessoa
                // pulava para o passado e o servidor recusava com
                // "essa hora já passou", sem ela entender por quê.
                const bruto = e.target.value;
                const composto = ag.dataAg && bruto ? comporHorario(ag.dataAg, bruto) : null;
                if (!composto) {
                  ag.setHoraAg(bruto);
                } else {
                  const arredondado = arredondarParaGrade(composto);
                  ag.setHoraAg(horaParaInput(arredondado));
                  ag.setDataAg(hojeParaInput(arredondado));
                }
                ag.setAtalhoAtivo(null);
              }}
              aria-label={t("time")}
              className="h-9 w-[5.5rem] rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>
          {/* A promessa do ciclo (P4.2, hoje 15 min), escrita na tela e presa
              à mesma constante que o agendador usa. */}
          <p className="text-[11px] text-muted-foreground">
            {ag.quandoAg
              ? t("scheduleHint", { min: CICLO_MINUTOS })
              : t("schedulePick")}
          </p>
          {ag.quandoAg && (
            <button
              type="button"
              onClick={ag.limparAgendamento}
              className="self-start text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("scheduleClear")}
            </button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
