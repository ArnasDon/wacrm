'use client';

// ============================================================
// A porta de entrada: o Meu dia NO LUGAR do app, até o "Continuar".
//
// Não é um Dialog por cima do app, de propósito. O app montado por trás
// teria efeitos antes da confirmação: um link `/inbox?c=X` abriria o fio e
// zeraria as não lidas daquela conversa para a conta inteira, e o heartbeat
// publicaria presença. Aqui o layout inteiro (menu, cabeçalho, página,
// heartbeat) só monta depois do clique.
//
// ⚠️ TRAVA DE MÃO ÚNICA. A decisão "mostra?" é tomada UMA vez por carga de
// página, no inicializador do estado, e só FECHA — nunca reabre por evento
// de auth (o `SIGNED_IN` dispara a cada volta à aba), por remontagem (o
// spinner do "Ver como" e a troca de usuário remontam o que está abaixo do
// shell) nem pela virada do dia com a aba aberta. Abrir no meio do uso
// desmontaria o compositor: o rascunho se perde, o anexo preparado é
// apagado do bucket e a mensagem na janela de desfazer é ENVIADA.
// Remontagem é coberta pelo `Set` de módulo "liberados nesta carga".
//
// ⚠️ A ÚNICA EXCEÇÃO é `reabrir`, chamada só pela guarda de inatividade
// (F2a): 4 h sem ninguém mexer em nenhuma aba deste navegador — e a guarda
// intercepta o gesto que acorda a tela (`stopPropagation`), então o Enter ou
// o clique não chegam ao app antes de o Meu dia se pôr na frente. O caso
// "aba reaberta depois de 4 h" é decidido aqui mesmo, no inicializador, sem
// montar o app por um quadro.
//
// ⚠️ A confirmação vive no `localStorage`, por pessoa (a régua está em
// `src/lib/resumo-do-dia/pendencia.ts`): sessão nova OU primeiro acesso do
// dia. Outra aba que confirma libera esta pelo evento `storage` — só quando
// a confirmação é da MESMA sessão e do MESMO dia que esta aba capturou.
//
// ⚠️ Conta que não resolveu (`accountStatus !== 'ready'`) PULA a tela: as
// consultas falhariam ou mentiriam, e o `AccountAccessAlert` do shell é quem
// narra esse problema.
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useGuardaDeInatividade } from '@/hooks/use-guarda-de-inatividade';
import { decidir } from '@/lib/auth/inatividade';
import { sairDesteAparelho } from '@/lib/auth/sair';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import {
  gravarAtividadeNoNavegador,
  gravarRegistroNoNavegador,
  lerAtividadeDoNavegador,
  lerRegistroDoNavegador,
} from '@/lib/resumo-do-dia/navegador';
import {
  chaveDoRegistro,
  decidirEntrada,
  inicioDasNovidades,
  lerRegistro,
  novoRegistro,
  precisaMostrar,
} from '@/lib/resumo-do-dia/pendencia';
import { createClient } from '@/lib/supabase/client';
import { diaLocal } from '@/lib/tasks/prazo';

import { LimiteDeErro } from './limite-de-erro';
import { ResumoDoDia } from './resumo-do-dia';

/** Quem já passou pela porta NESTA carga de página — remontar não reabre. */
const liberadosNestaCarga = new Set<string>();

interface Decisao {
  pendente: boolean;
  /** O dia e a sessão que esta aba capturou ao decidir. */
  dia: string;
  sessao: string | null;
  /** O instante da decisão — a régua do relógio da tela (saudação, data). */
  agoraMs: number;
  desdeMs: number;
  /** A âncora das novidades é a confirmação anterior (senão, 24 h). */
  daConfirmacao: boolean;
}

/** A decisão de AGORA, com o registro do navegador — a mesma para a carga e para a reabertura. */
function decidirAgora(
  userId: string,
  sessionId: string | null,
  pendente: (registroAusente: boolean) => boolean
): Decisao {
  const agora = new Date();
  const registro = lerRegistroDoNavegador(userId);
  const inicio = inicioDasNovidades(registro, agora.getTime());
  return {
    pendente: pendente(registro === null),
    dia: diaLocal(agora),
    sessao: sessionId,
    agoraMs: agora.getTime(),
    desdeMs: inicio.desdeMs,
    daConfirmacao: inicio.daConfirmacao,
  };
}

export function PortaDeEntrada({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const { sessionId, accountStatus, accountId, profile, perfilDeAcesso } =
    useAuth();

  const [decisao, setDecisao] = useState<Decisao>(() => {
    const agoraMs = Date.now();
    const registro = lerRegistroDoNavegador(userId);
    const pendente = decidirEntrada({
      registro,
      sessionId,
      hoje: diaLocal(new Date(agoraMs)),
      accountStatus,
      jaLiberadoNestaCarga: liberadosNestaCarga.has(userId),
      // Aba reaberta depois de 4 h paradas: o Meu dia volta já na carga.
      inatividadeExpirou:
        decidir(lerAtividadeDoNavegador(userId), sessionId, agoraMs) ===
        'expirou',
    });
    return decidirAgora(userId, sessionId, () => pendente);
  });

  // Liberada (agora ou desde o início) = nesta carga não volta a abrir.
  useEffect(() => {
    if (!decisao.pendente) liberadosNestaCarga.add(userId);
  }, [decisao.pendente, userId]);

  // Outra aba confirmou: destrava esta, se a confirmação vale para ela.
  useEffect(() => {
    if (!decisao.pendente) return;
    const chave = chaveDoRegistro(userId);
    const aoMudar = (e: StorageEvent) => {
      if (e.key !== chave) return;
      if (
        !precisaMostrar(lerRegistro(e.newValue), decisao.sessao, decisao.dia)
      ) {
        setDecisao((d) => ({ ...d, pendente: false }));
      }
    };
    window.addEventListener('storage', aoMudar);
    return () => window.removeEventListener('storage', aoMudar);
  }, [decisao.pendente, decisao.sessao, decisao.dia, userId]);

  const confirmar = useCallback(() => {
    // O dia e a sessão de AGORA, não os capturados: quem deixa a tela aberta
    // até depois da meia-noite confirma o dia em que clicou.
    const agora = new Date();
    gravarRegistroNoNavegador(
      userId,
      novoRegistro(sessionId, diaLocal(agora), agora)
    );
    // É o "Continuar" que regrava o relógio de atividade depois de uma
    // expiração — a guarda NÃO grava ao expirar (relógio compartilhado; ver
    // `passoDaGuarda`). Sem isto, o gesto seguinte reabriria de novo.
    if (sessionId)
      gravarAtividadeNoNavegador(userId, sessionId, agora.getTime());
    liberadosNestaCarga.add(userId);
    setDecisao((d) => ({ ...d, pendente: false }));
  }, [userId, sessionId]);

  // A única exceção à trava de mão única — só a guarda de inatividade chama.
  // Já pendente = nada a fazer (a guarda pode conferir de novo antes do
  // clique em Continuar).
  const reabrir = useCallback(() => {
    // Calculado FORA do updater: `decidirAgora` lê o relógio e o storage, e o
    // updater roda na fase de render (e duas vezes no StrictMode).
    const nova = decidirAgora(userId, sessionId, () => true);
    setDecisao((d) => (d.pendente ? d : nova));
  }, [userId, sessionId]);

  // Conta que não resolveu nunca reabre (a mesma cerca de `decidirEntrada`).
  useGuardaDeInatividade({
    userId,
    sessionId,
    ativa: !decisao.pendente && accountStatus === 'ready',
    aoExpirar: reabrir,
  });

  const sair = useCallback(async (): Promise<string | null> => {
    const resultado = await sairDesteAparelho(createClient().auth);
    if (!resultado.ok) return resultado.erro;
    // Só com sucesso: com a sessão ainda no cookie, `/login` devolveria
    // para `/dashboard` e formaria um laço.
    window.location.href = '/login';
    return null;
  }, []);

  // O contexto REAL, nunca a lente do "Ver como": `acesso` do useAuth é o
  // efetivo. Memoizado porque entra nas dependências do efeito de carga.
  const papel = profile?.account_role ?? null;
  const ctx = useMemo<ContextoDeAcesso>(
    () => ({ papel, perfil: perfilDeAcesso }),
    [papel, perfilDeAcesso]
  );

  if (!decisao.pendente || !accountId) return <>{children}</>;

  return (
    <LimiteDeErro fallback={children}>
      <ResumoDoDia
        userId={userId}
        accountId={accountId}
        ctx={ctx}
        primeiroNome={profile?.full_name?.trim().split(/\s+/)[0] || null}
        agoraMs={decisao.agoraMs}
        desdeMs={decisao.desdeMs}
        temConfirmacaoAnterior={decisao.daConfirmacao}
        onContinuar={confirmar}
        onSair={sair}
      />
    </LimiteDeErro>
  );
}
