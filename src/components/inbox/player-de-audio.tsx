"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ExternalLink, Loader2, Pause, Play, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  ALTURA_MINIMA,
  BARRAS_DA_ONDA,
  formatarTempo,
  fracaoNoPonto,
  lerVelocidade,
  picosDaOnda,
  proximaVelocidade,
  type Velocidade,
} from "@/lib/audio/onda";

// ============================================================
// O player das notas de voz do fio, no desenho do WhatsApp: play, a ONDA do
// próprio áudio com a bolinha que se arrasta, o tempo embaixo e o botão de
// velocidade ao lado (1× → 1,5× → 2×).
//
// Substituiu o `<audio controls>` nativo, que escondia a velocidade atrás do
// menu de três pontos do navegador (pedido do operador, 23/09/2026). A regra
// pura — barras, ciclo da velocidade, relógio — mora em `@/lib/audio/onda`.
// ============================================================

// ------------------------------------------------------------
// A velocidade é UMA para todos os áudios, lembrada neste aparelho.
//
// É o que o WhatsApp faz, e é o motivo do pedido: quem ouve a 1,5× ouve
// TODOS a 1,5×. Por player, a pessoa voltaria a clicar em cada áudio. O
// estado é de módulo, para o clique num player trocar o rótulo dos outros
// que estão na tela, e o `localStorage` é só conveniência de aparelho —
// modo privado cai para 1× sem quebrar nada.
// ------------------------------------------------------------

const CHAVE_DA_VELOCIDADE = "cb-audio-velocidade";
let velocidadeLembrada: Velocidade | null = null;
const ouvintesDaVelocidade = new Set<() => void>();

function velocidadeDoAparelho(): Velocidade {
  if (velocidadeLembrada === null) {
    let bruto: string | null = null;
    try {
      bruto = window.localStorage.getItem(CHAVE_DA_VELOCIDADE);
    } catch {
      // Armazenamento bloqueado: vale 1×.
    }
    velocidadeLembrada = lerVelocidade(bruto);
  }
  return velocidadeLembrada;
}

function lembrarVelocidade(v: Velocidade) {
  velocidadeLembrada = v;
  try {
    window.localStorage.setItem(CHAVE_DA_VELOCIDADE, String(v));
  } catch {
    // Sem armazenamento a escolha vale até recarregar a página.
  }
  for (const avisar of ouvintesDaVelocidade) avisar();
}

function assinarVelocidade(avisar: () => void) {
  ouvintesDaVelocidade.add(avisar);
  return () => {
    ouvintesDaVelocidade.delete(avisar);
  };
}

const VELOCIDADE_NO_SERVIDOR = (): Velocidade => 1;

/**
 * Um áudio por vez: dar play num pausa o que estava tocando. O nativo
 * deixava dois tocarem por cima um do outro.
 */
let tocandoAgora: HTMLAudioElement | null = null;

// ------------------------------------------------------------
// A onda é lida do PRÓPRIO arquivo, no navegador.
//
// ⚠️ Não é enfeite: uma onda sorteada afirmaria volume onde há silêncio. O
// arquivo é baixado inteiro (CORS aberto no bucket público) e decodificado
// num `OfflineAudioContext` a 8 kHz — a taxa baixa é o que segura a memória:
// o `decodeAudioData` entrega o áudio JÁ reamostrado para a taxa do
// contexto. Medido em 23/09/2026 no Chromium 152, com um áudio sintético de
// 10 min (maior que qualquer um da conta: a mediana é 75 KB e o maior,
// 874 KB): 1,1 MB baixados, 0,7 s de decodificação (assíncrona) e ~19 MB
// temporários; a 44,1 kHz a mesma conta dá ~104 MB.
//
// Só roda quando o player aparece na tela (`IntersectionObserver`): uma
// conversa tem até 49 áudios, e o fio abre no fim. O resultado fica em
// memória por endereço, então a remontagem do fio (volta à aba, troca de
// conversa) não baixa de novo. Falha não é guardada — a próxima montagem
// tenta outra vez —, e enquanto isso a onda é uma fileira de pontos, nunca
// um desenho inventado.
// ------------------------------------------------------------

interface Onda {
  picos: number[];
  duracao: number;
}

const TAXA_DA_ONDA = 8000;
const ondasProntas = new Map<string, Onda>();
const ondasEmCurso = new Map<string, Promise<Onda | null>>();
const ONDA_VAZIA: number[] = Array(BARRAS_DA_ONDA).fill(ALTURA_MINIMA);

function carregarOnda(src: string): Promise<Onda | null> {
  const pronta = ondasProntas.get(src);
  if (pronta) return Promise.resolve(pronta);
  let carga = ondasEmCurso.get(src);
  if (!carga) {
    carga = decodificarOnda(src).finally(() => ondasEmCurso.delete(src));
    ondasEmCurso.set(src, carga);
  }
  return carga;
}

async function decodificarOnda(src: string): Promise<Onda | null> {
  try {
    const resposta = await fetch(src);
    if (!resposta.ok) return null;
    const bytes = await resposta.arrayBuffer();
    const contexto = new OfflineAudioContext(1, 1, TAXA_DA_ONDA);
    const audio = await contexto.decodeAudioData(bytes);
    const onda: Onda = {
      picos: picosDaOnda(audio.getChannelData(0), BARRAS_DA_ONDA),
      duracao: audio.duration,
    };
    ondasProntas.set(src, onda);
    return onda;
  } catch {
    // Formato que o navegador não decodifica, rede, CORS: sem onda, o
    // player continua tocando (quem toca é o `<audio>`, não isto).
    return null;
  }
}

/**
 * No toque, o dedo que encosta na onda pode estar só ROLANDO o fio. Por isso
 * o toque não pula na hora de encostar: pula no arraste que passa desta
 * distância na horizontal, ou no toque curto (menos que o toque longo, que
 * abre o menu da mensagem). Sem isto, rolar uma conversa cheia de áudios no
 * celular ia pulando a posição de cada um que o dedo atravessasse.
 */
const ARRASTE_MINIMO_PX = 8;
const TOQUE_LONGO_MS = 500;

/** Salto das setas do teclado, em segundos. */
const SALTO_DO_TECLADO = 5;

interface PlayerDeAudioProps {
  src: string;
  /**
   * Dentro da bolha da equipe, que é preenchida com `bg-primary`: tudo lê
   * contra o primary. Na do cliente, contra o `bg-muted`.
   */
  naBolhaDaEquipe: boolean;
}

/**
 * Um arquivo, uma instância: posição, duração e onda são DAQUELE arquivo, e
 * a `key` garante que um endereço novo nunca herde o estado do anterior.
 */
export function PlayerDeAudio(props: PlayerDeAudioProps) {
  return <Player key={props.src} {...props} />;
}

function Player({ src, naBolhaDaEquipe }: PlayerDeAudioProps) {
  const t = useTranslations("Inbox.audioPlayer");
  const velocidade = useSyncExternalStore(
    assinarVelocidade,
    velocidadeDoAparelho,
    VELOCIDADE_NO_SERVIDOR,
  );
  const audioRef = useRef<HTMLAudioElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const arrasteRef = useRef<{
    id: number;
    toque: boolean;
    x: number;
    desde: number;
    moveu: boolean;
  } | null>(null);

  const [tocando, setTocando] = useState(false);
  const [bufferizando, setBufferizando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [duracaoDoArquivo, setDuracaoDoArquivo] = useState<number | null>(
    null,
  );
  const [onda, setOnda] = useState<Onda | null>(
    () => ondasProntas.get(src) ?? null,
  );
  const [falhou, setFalhou] = useState(false);

  // A duração do `<audio>` vale mais; a da decodificação cobre o arquivo
  // que o elemento ainda não mediu.
  const duracao = duracaoDoArquivo ?? onda?.duracao ?? null;
  const progresso = duracao ? Math.min(1, posicao / duracao) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // ⚠️ As duas: recarregar o arquivo devolve `playbackRate` ao padrão.
    audio.defaultPlaybackRate = velocidade;
    audio.playbackRate = velocidade;
  }, [velocidade]);

  // O `timeupdate` chega ~4×/s e a bolinha andaria aos saltos: enquanto
  // toca, a posição é lida a cada quadro.
  useEffect(() => {
    const audio = audioRef.current;
    if (!tocando || !audio) return;
    let quadro = requestAnimationFrame(function passo() {
      setPosicao(audio.currentTime);
      quadro = requestAnimationFrame(passo);
    });
    return () => cancelAnimationFrame(quadro);
  }, [tocando]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (tocandoAgora === audio) tocandoAgora = null;
    };
  }, []);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || ondasProntas.has(src)) return;
    let vivo = true;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        void carregarOnda(src).then((lida) => {
          if (vivo && lida) setOnda(lida);
        });
      },
      { rootMargin: "200px 0px" },
    );
    observador.observe(raiz);
    return () => {
      vivo = false;
      observador.disconnect();
    };
  }, [src]);

  function alternar() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    audio.play().catch((erro: unknown) => {
      // Pausar antes de o áudio carregar rejeita com `AbortError` — não é
      // falha. `NotSupportedError` é: o navegador não toca este arquivo.
      if (erro instanceof DOMException && erro.name === "NotSupportedError") {
        setFalhou(true);
      }
    });
  }

  function irPara(fracao: number) {
    const audio = audioRef.current;
    if (!audio || !duracao) return;
    const alvo = fracao * duracao;
    audio.currentTime = alvo;
    setPosicao(alvo);
  }

  function fracaoDoPonteiro(e: PointerEvent<HTMLDivElement>) {
    const caixa = e.currentTarget.getBoundingClientRect();
    return fracaoNoPonto(e.clientX, caixa.left, caixa.width);
  }

  function aoApertar(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !duracao) return;
    const toque = e.pointerType === "touch";
    arrasteRef.current = {
      id: e.pointerId,
      toque,
      x: e.clientX,
      desde: e.timeStamp,
      moveu: false,
    };
    if (!toque) irPara(fracaoDoPonteiro(e));
    // Depois do salto, e protegido: a captura LANÇA quando o ponteiro já
    // não está ativo, e o clique perderia o salto junto.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sem captura, o arraste para quando o ponteiro sai da onda.
    }
  }

  function aoMover(e: PointerEvent<HTMLDivElement>) {
    const arraste = arrasteRef.current;
    if (arraste?.id !== e.pointerId) return;
    if (
      arraste.toque &&
      !arraste.moveu &&
      Math.abs(e.clientX - arraste.x) < ARRASTE_MINIMO_PX
    ) {
      return;
    }
    arraste.moveu = true;
    irPara(fracaoDoPonteiro(e));
  }

  function aoSoltar(e: PointerEvent<HTMLDivElement>) {
    const arraste = arrasteRef.current;
    if (arraste?.id !== e.pointerId) return;
    arrasteRef.current = null;
    const toqueCurto =
      arraste.toque &&
      !arraste.moveu &&
      e.timeStamp - arraste.desde < TOQUE_LONGO_MS;
    if (toqueCurto) irPara(fracaoDoPonteiro(e));
  }

  function aoDesistir(e: PointerEvent<HTMLDivElement>) {
    // O navegador ficou com o gesto (a rolagem do fio): nada a pular.
    if (arrasteRef.current?.id === e.pointerId) arrasteRef.current = null;
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duracao) return;
    let alvo: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        alvo = audio.currentTime + SALTO_DO_TECLADO;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        alvo = audio.currentTime - SALTO_DO_TECLADO;
        break;
      case "Home":
        alvo = 0;
        break;
      case "End":
        alvo = duracao;
        break;
      default:
        return;
    }
    e.preventDefault();
    irPara(fracaoNoPonto(alvo, 0, duracao));
  }

  // ⚠️ Cor por `currentColor` (`bg-current`), nunca por classe de cor
  // fixa: a bolha que NÃO foi entregue reescreve a cor de texto de todo
  // descendente para `!text-foreground` sobre um fundo claro, e barras
  // `bg-primary-foreground` ficariam brancas sobre branco. Com
  // `currentColor` a onda acompanha a troca sozinha.
  const cor = naBolhaDaEquipe ? "text-primary-foreground" : "text-foreground";

  if (falhou) {
    // Em PALAVRAS: o nativo mostrava um controle cinza sem dizer nada, e
    // um botão de play que não faz nada seria pior. O arquivo continua
    // alcançável — o navegador pode baixá-lo, e o celular tocá-lo.
    return (
      <div className={cn("flex w-64 max-w-full items-center gap-2 text-xs", cor)}>
        <VolumeX className="h-4 w-4 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">{t("falhou")}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-medium underline underline-offset-2"
        >
          {t("abrirArquivo")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  const picos = onda?.picos ?? ONDA_VAZIA;
  // Parado no começo mostra a DURAÇÃO; tocando (ou parado no meio), onde
  // está. Duração ainda desconhecida vira traço, e não "0:00" — zero seria
  // afirmar um áudio vazio.
  const tempo =
    tocando || posicao > 0
      ? formatarTempo(posicao)
      : duracao !== null
        ? formatarTempo(duracao)
        : "–:––";

  return (
    <div
      ref={raizRef}
      className={cn("flex w-64 max-w-full items-center gap-2", cor)}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={(e) => {
          const audio = e.currentTarget;
          if (tocandoAgora && tocandoAgora !== audio) tocandoAgora.pause();
          tocandoAgora = audio;
          setTocando(true);
        }}
        onPause={(e) => {
          if (tocandoAgora === e.currentTarget) tocandoAgora = null;
          setTocando(false);
          setBufferizando(false);
          setPosicao(e.currentTarget.currentTime);
        }}
        onEnded={(e) => {
          // Como no WhatsApp: acabou, volta ao começo e mostra a duração.
          e.currentTarget.currentTime = 0;
          setPosicao(0);
        }}
        onTimeUpdate={(e) => setPosicao(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setDuracaoDoArquivo(Number.isFinite(d) && d > 0 ? d : null);
        }}
        onWaiting={() => setBufferizando(true)}
        onPlaying={() => setBufferizando(false)}
        onError={() => setFalhou(true)}
      />

      <button
        type="button"
        onClick={alternar}
        aria-label={tocando ? t("pausar") : t("tocar")}
        title={tocando ? t("pausar") : t("tocar")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-current/10 focus-visible:ring-2 focus-visible:ring-current/50 focus-visible:outline-none"
      >
        {tocando && bufferizando ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : tocando ? (
          <Pause className="h-5 w-5 fill-current" />
        ) : (
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("posicao")}
          aria-valuemin={0}
          aria-valuemax={Math.floor(duracao ?? 0)}
          aria-valuenow={Math.floor(posicao)}
          aria-valuetext={
            duracao !== null
              ? t("posicaoValor", {
                  atual: formatarTempo(posicao),
                  total: formatarTempo(duracao),
                })
              : formatarTempo(posicao)
          }
          aria-disabled={duracao === null}
          onPointerDown={aoApertar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoDesistir}
          onKeyDown={aoTeclar}
          className="relative flex h-8 cursor-pointer touch-pan-y items-center justify-between rounded select-none focus-visible:ring-2 focus-visible:ring-current/50 focus-visible:outline-none"
        >
          {picos.map((altura, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                "w-[3px] rounded-full bg-current transition-[height] duration-300",
                (i + 0.5) / picos.length <= progresso
                  ? "opacity-90"
                  : "opacity-35",
              )}
              style={{ height: `${Math.round(altura * 100)}%` }}
            />
          ))}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm",
              // Na bolha do cliente a bolinha leva a cor do tema, como o
              // azul do WhatsApp; na da equipe o primary é o próprio fundo.
              naBolhaDaEquipe ? "bg-current" : "bg-primary",
            )}
            style={{ left: `${progresso * 100}%` }}
          />
        </div>
        <span className="mt-0.5 block text-[11px] leading-none tabular-nums opacity-70">
          {tempo}
        </span>
      </div>

      <button
        type="button"
        onClick={() => lembrarVelocidade(proximaVelocidade(velocidade))}
        aria-label={t("velocidadeDica", { valor: velocidade })}
        title={t("velocidadeDica", { valor: velocidade })}
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums focus-visible:ring-2 focus-visible:ring-current/50 focus-visible:outline-none",
          naBolhaDaEquipe
            ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
            : "bg-foreground/10 hover:bg-foreground/15",
        )}
      >
        {t("velocidade", { valor: velocidade })}
      </button>
    </div>
  );
}
