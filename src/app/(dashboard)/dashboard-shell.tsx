'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { TelaBloqueada } from '@/components/auth/tela-bloqueada';
import { FaixaDeSimulacao } from '@/components/auth/faixa-de-simulacao';
import { PortaDeEntrada } from '@/components/entrada/porta-de-entrada';
import { ROTA_DA_TELA, TODAS_AS_TELAS } from '@/lib/perfis/catalogo';
import { podeVerTela, telaDoCaminho } from '@/lib/perfis/visibilidade';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profileLoading, acesso } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('DashboardShell');

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const tela = telaDoCaminho(pathname, ROTA_DA_TELA);
  const bloqueada = tela !== null && !podeVerTela(acesso, tela);

  /**
   * ⚠️ `/dashboard` é o destino FIXO de login, cadastro, raiz e middleware —
   * ninguém o escolhe, é para onde a sessão simplesmente começa. E os dois
   * perfis de fábrica restritos (Advogado e Observador) não incluem a tela
   * Painel, por decisão do operador: visão de gestão. O resultado era que
   * TODO login dessas pessoas abria na TelaBloqueada, todo dia, exigindo um
   * clique para chegar a uma tela que elas podem ver.
   *
   * O desvio vale para TODO `/dashboard` bloqueado — inclusive digitado na
   * barra, porque daqui não dá para distinguir intenção de aterrissagem. O
   * que fica explicado pela TelaBloqueada são as OUTRAS telas: `/pipelines`
   * digitado por quem não o tem continua dizendo "existe e está fora do seu
   * perfil", nunca um redirect mudo.
   */
  const primeiraPermitida = TODAS_AS_TELAS.find((t) => podeVerTela(acesso, t));
  const desviarDaAterrissagem =
    bloqueada && tela === 'dashboard' && !loading && !profileLoading;
  useEffect(() => {
    if (!desviarDaAterrissagem) return;
    router.replace(ROTA_DA_TELA[primeiraPermitida ?? 'settings']);
  }, [desviarDaAterrissagem, primeiraPermitida, router]);

  // ⚠️ `profileLoading` entra no gate junto com a sessão (Fase 2 dos
  // perfis). Enquanto o profile não chega, `acesso` é
  // { papel: null, perfil: null } = SEM RESTRIÇÃO — renderizar o shell nesse
  // estado faria o menu pintar completo e encolher meio segundo depois para
  // quem tem perfil restrito (o flash que o JSDoc de `acesso` descreve).
  // Segurar o spinner até o profile resolver mata o flash nos DOIS sentidos,
  // ao custo de uma ida ao banco que o dashboard já fazia de qualquer forma.
  // Falha de fetch não trava aqui: o finally do fetchProfile sempre derruba
  // o profileLoading, e aí o acesso nulo = tudo visível (fail-open da 956).
  if (loading || profileLoading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // ⚠️ TUDO abaixo fica DENTRO da porta de entrada (Meu dia). Enquanto ela
  // está pendente, o layout continua desenhado ATRÁS do cartão (desfocado e
  // inerte — é o fundo que o operador pediu), mas a PÁGINA e o
  // `PresenceHeartbeat` NÃO montam: montá-los devolveria os efeitos que a
  // porta existe para segurar (não lidas zeradas por um deep link, presença
  // publicada antes da confirmação). Daí o filho ser uma FUNÇÃO. A `key`
  // amarra a decisão da porta à pessoa: troca de usuário na mesma aba
  // decide de novo.
  return (
    <PortaDeEntrada key={user.id} userId={user.id}>
      {(entradaPendente) => (
        <div className="bg-background flex h-screen overflow-hidden">
          {/* Reports this tab's online/away presence once we know a user is
            signed in. Headless — renders nothing. */}
          {!entradaPendente && <PresenceHeartbeat />}
          <Sidebar open={sidebarOpen} onClose={closeSidebar} />
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* "Ver como": acima do cabeçalho, em toda página, com a saída —
              o perfil simulado pode esconder a tela de Perfis. */}
            <FaixaDeSimulacao />
            <Header onOpenSidebar={() => setSidebarOpen(true)} />
            {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
            <main className="flex-1 overflow-y-auto p-4 sm:p-6">
              {/* Above every page: writes are being rejected and here's why.
                Renders nothing unless the account/role failed to resolve. */}
              <AccountAccessAlert />
              {/* Guarda de tela dos perfis (Fase 2) — UM ponto para todas as
                páginas do dashboard, em vez de uma guarda por page.tsx: rota
                nova cai aqui de graça, e a regra continua morando só em
                `podeVerTela`. Caminho fora do catálogo (null) passa — não é
                uma tela recortável. NUNCA 404: a pessoa precisa entender que
                a página existe e está fora do perfil dela. */}
              {entradaPendente || desviarDaAterrissagem ? null : bloqueada ? (
                <TelaBloqueada />
              ) : (
                children
              )}
            </main>
          </div>
        </div>
      )}
    </PortaDeEntrada>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
