'use client';

// ============================================================
// A guarda de 4 h sem atividade (F2a do plano Meu dia).
//
// Escuta os gestos da pessoa em TODA a janela (fase de captura, passivo),
// mantém o relógio compartilhado entre as abas e, quando descobre que
// passaram 4 h, avisa a porta de entrada — que reabre o Meu dia. A régua e
// o "o que fazer a cada conferência" são puros e testados
// (`src/lib/auth/inatividade.ts`: `decidir` e `passoDaGuarda`); aqui mora
// só o encanamento.
//
// ⚠️ O que conta como atividade: `pointerdown`, `keydown`, `wheel`,
// `touchstart` e `mousemove` (este só quando a posição muda). `scroll` NÃO
// conta — o fio da conversa escreve `scrollTop` sozinho e dispararia um.
// Heartbeat, realtime, renovação de token e mensagem chegando também não.
// E a conferência periódica (60 s) e a de volta à aba só CONFEREM, nunca
// gravam — o relógio andando sozinho foi o defeito da primeira versão
// (pego pela revisão fria: 12 h simuladas, zero expirações).
//
// ⚠️ CONFERE ANTES DE GRAVAR, e o gesto que descobre a expiração leva
// `stopPropagation()`: o ouvinte está em `window` na fase de captura, antes
// do container onde o React pendura os seus, então os handlers do React
// para ESSES cinco eventos não rodam — o Enter não chega ao `onKeyDown` do
// compositor, o `pointerdown` não chega ao botão. A ação padrão do
// navegador continua (o caractere entra no campo; o `click` que segue o
// `pointerdown` é outro evento), e é a reabertura do Meu dia, que desmonta
// o app em seguida, que impede o resto. (`passive` só desliga o
// `preventDefault`; o `stopPropagation` funciona.)
//
// ⚠️ Gesto lê o storage no máximo uma vez por segundo (`LER_A_CADA_MS`):
// `mousemove` dispara dezenas de vezes por segundo, e arrastar um card no
// funil não pode custar uma leitura de `localStorage` + `JSON.parse` por
// pixel. A régua de 4 h não perde nada com 1 s de granularidade.
//
// ⚠️ Storage que não grava DESLIGA a guarda: sem o relógio compartilhado, a
// aba ociosa derrubaria quem trabalha na outra. E `sessionId` nulo também
// desliga — a régua não decide sem a sessão.
//
// A conferência inicial vai por `setTimeout(0)`, não no corpo do efeito: a
// porta já decide o caso "reaberto depois de 4 h" no inicializador dela
// (síncrono, sem montar o app por um quadro), e um `setState` direto no
// efeito reprovaria o lint do React Compiler.
// ============================================================

import { useEffect, useRef } from 'react';

import { CONFERIR_A_CADA_MS, passoDaGuarda } from '@/lib/auth/inatividade';
import {
  gravarAtividadeNoNavegador,
  lerAtividadeDoNavegador,
  storageDisponivel,
} from '@/lib/resumo-do-dia/navegador';

/** Teto de leitura do storage no caminho de GESTO. */
const LER_A_CADA_MS = 1_000;

export function useGuardaDeInatividade({
  userId,
  sessionId,
  ativa,
  aoExpirar,
}: {
  userId: string;
  sessionId: string | null;
  /** O app está na tela? Com o Meu dia já aberto, expirar de novo é ruído. */
  ativa: boolean;
  aoExpirar: () => void;
}) {
  const ativaRef = useRef(ativa);
  const aoExpirarRef = useRef(aoExpirar);
  useEffect(() => {
    ativaRef.current = ativa;
    aoExpirarRef.current = aoExpirar;
  }, [ativa, aoExpirar]);

  useEffect(() => {
    if (!sessionId) return;
    if (!storageDisponivel(userId)) return;

    const conferir = (agoraMs: number, porGesto: boolean, evento?: Event) => {
      const passo = passoDaGuarda({
        registro: lerAtividadeDoNavegador(userId),
        sessao: sessionId,
        agoraMs,
        ativa: ativaRef.current,
        porGesto,
      });
      if (passo.expirar) {
        evento?.stopPropagation();
        aoExpirarRef.current();
      }
      if (passo.gravar) gravarAtividadeNoNavegador(userId, sessionId, agoraMs);
    };

    let ultimaLeituraPorGesto = 0;
    const aoGesto = (e: Event) => {
      const agoraMs = Date.now();
      if (agoraMs - ultimaLeituraPorGesto < LER_A_CADA_MS) return;
      ultimaLeituraPorGesto = agoraMs;
      conferir(agoraMs, true, e);
    };
    let ultimoX = -1;
    let ultimoY = -1;
    const aoMover = (e: MouseEvent) => {
      if (e.clientX === ultimoX && e.clientY === ultimoY) return;
      ultimoX = e.clientX;
      ultimoY = e.clientY;
      aoGesto(e);
    };
    const aoVoltar = () => {
      if (document.visibilityState === 'hidden') return;
      conferir(Date.now(), false);
    };

    const opcoes: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', aoGesto, opcoes);
    window.addEventListener('keydown', aoGesto, opcoes);
    window.addEventListener('wheel', aoGesto, opcoes);
    window.addEventListener('touchstart', aoGesto, opcoes);
    window.addEventListener('mousemove', aoMover, opcoes);
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('pageshow', aoVoltar);
    const intervalo = setInterval(
      () => conferir(Date.now(), false),
      CONFERIR_A_CADA_MS
    );
    const inicial = setTimeout(() => conferir(Date.now(), false), 0);

    return () => {
      window.removeEventListener('pointerdown', aoGesto, opcoes);
      window.removeEventListener('keydown', aoGesto, opcoes);
      window.removeEventListener('wheel', aoGesto, opcoes);
      window.removeEventListener('touchstart', aoGesto, opcoes);
      window.removeEventListener('mousemove', aoMover, opcoes);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('pageshow', aoVoltar);
      clearInterval(intervalo);
      clearTimeout(inicial);
    };
  }, [userId, sessionId]);
}
