'use client';

// ============================================================
// /meu-dia — o painel próprio, para rever o dia a qualquer hora (F3).
//
// A MESMA tela da entrada, em modo página: sem "Continuar", sem "Sair", com
// "Atualizar". Fica FORA do catálogo de perfis de propósito (`telaDoCaminho`
// devolve null e a guarda deixa passar): uma tela nova no catálogo nasceria
// invisível para todo perfil já gravado. Também não vira a tela de chegada
// de quem não tem o Painel (D15 do plano): logo depois do "Continuar" o
// resumo apareceria de novo.
//
// As novidades e a fila "nova" contam a partir da última confirmação da
// entrada, lida do navegador — a mesma âncora da porta.
// ============================================================

import { useState } from 'react';

import { ResumoDoDia } from '@/components/entrada/resumo-do-dia';
import { useAuth } from '@/hooks/use-auth';
import { lerRegistroDoNavegador } from '@/lib/resumo-do-dia/navegador';
import { inicioDasNovidades } from '@/lib/resumo-do-dia/pendencia';

interface Pedido {
  agoraMs: number;
  desdeMs: number;
  daConfirmacao: boolean;
}

function montarPedido(userId: string | null): Pedido {
  const agoraMs = Date.now();
  const inicio = inicioDasNovidades(
    userId ? lerRegistroDoNavegador(userId) : null,
    agoraMs
  );
  return {
    agoraMs,
    desdeMs: inicio.desdeMs,
    daConfirmacao: inicio.daConfirmacao,
  };
}

export default function MeuDiaPage() {
  const { user, accountId, accountStatus, profile, acesso } = useAuth();
  const userId = user?.id ?? null;

  // O pedido nasce no inicializador e só muda no clique em "Atualizar" — o
  // relógio novo (`agoraMs`) é a chave que faz o hook consultar de novo.
  const [pedido, setPedido] = useState<Pedido>(() => montarPedido(userId));

  // O shell já segura sessão e perfil; conta quebrada é narrada pelo
  // `AccountAccessAlert` acima desta página.
  if (!userId || !accountId || accountStatus !== 'ready') return null;

  return (
    <ResumoDoDia
      modo="pagina"
      userId={userId}
      accountId={accountId}
      // A LENTE do "Ver como" (`acesso`), e não o contexto real: esta tela
      // vive DENTRO do app, onde o shell bloqueia telas pela lente — com o
      // ctx real, o admin simulando um Observador veria links para telas
      // que a TelaBloqueada recusaria. O ctx real fica só na porta.
      ctx={acesso}
      primeiroNome={profile?.full_name?.trim().split(/\s+/)[0] || null}
      agoraMs={pedido.agoraMs}
      desdeMs={pedido.desdeMs}
      temConfirmacaoAnterior={pedido.daConfirmacao}
      versao={pedido.agoraMs}
      onContinuar={() => {}}
      onSair={async () => null}
      onAtualizar={() => setPedido(montarPedido(userId))}
    />
  );
}
