"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { sessionIdDoToken } from "@/lib/auth/token";
import { sairDesteAparelho } from "@/lib/auth/sair";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { User } from "@supabase/supabase-js";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";
import type { ContextoDeAcesso, PerfilDeAcesso } from "@/lib/perfis/tipos";
import { ehSecaoConhecida, ehTelaConhecida } from "@/lib/perfis/catalogo";
import {
  CHAVE_DA_SIMULACAO,
  podeSimular,
  resolverAcesso,
} from "@/lib/perfis/simulacao";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  // `default_currency` (migration 021) NÃO vem para o cliente: o CB
  // Advogados fixou o real, os seletores de moeda saíram da interface e
  // `formatCurrency` não recebe mais moeda nenhuma. A coluna continua no
  // banco; carregá-la aqui só sugeriria uma escolha que não existe.

  /**
   * Dono da conta (`accounts.owner_user_id`, NOT NULL). É o `user_id` que
   * TODO caminho client-side que cria contato/conversa/campo tem de gravar
   * — essas colunas são `ON DELETE CASCADE` para `auth.users`, e gravar o
   * membro que clicou faz o offboarding dele (apagar o login no dashboard
   * do Supabase) levar junto o cliente e todo o histórico, que são do
   * escritório. Nunca caia para `user.id` quando isto for nulo: falhe a
   * ação (é a regressão que `dono-duravel.test.ts` existe para barrar).
   */
  owner_user_id: string;

  /**
   * Assinatura ligada (migration 923). Vem para o cliente por UM motivo:
   * a bolha otimista precisa nascer assinada. O compositor desenha a
   * mensagem antes de falar com o servidor — sem saber disto, ela aparece
   * sem o nome e muda sozinha um instante depois, parecendo que o sistema
   * reescreveu o que o atendente digitou.
   *
   * ⚠️ NÃO é a fonte da verdade do envio: quem assina de fato é o servidor
   * (`send-message.ts`). Este valor só desenha.
   */
  assinatura_ativa: boolean;
}

/**
 * Whether we managed to establish what this user may do.
 *
 * `unlinked` and `error` are the states worth surfacing: every RLS
 * policy checks `is_account_member(account_id, …)` and every `useCan`
 * gate returns false without a role, so in both the app silently
 * becomes read-only — the whole UI renders, and nothing saves. That is
 * indistinguishable from a bug unless we say so (issue #471).
 */
export type AccountStatus =
  /** Profile row still in flight. */
  | "loading"
  /** Account + role resolved; normal operation. */
  | "ready"
  /** Signed in, but no profile row / no account / no role on it. */
  | "unlinked"
  /** The profile lookup itself failed after retrying. */
  | "error";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until the FIRST `fetchProfile` for the
   * signed-in user settles (success, missing row, or error) — a later
   * `refreshProfile()` do MESMO usuário NÃO a reergue, de propósito: o
   * dashboard-shell troca a tela inteira por spinner enquanto isto é true,
   * e cada save de nome/avatar remontava a página perdendo rolagem e
   * rascunho. Code that branches on `profile.beta_features` MUST gate on
   * this — otherwise it sees the `{ loading: false, profile: null }` window
   * during initial load and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  /**
   * `session_id` do token de acesso — a sessão de LOGIN —, ou nulo sem
   * sessão ou com token sem a claim. Publicado no MESMO passo que `user`
   * (init e listener), nunca como estado preenchido depois: é a chave com
   * que a porta de entrada decide "este login já confirmou o Meu dia?"
   * (`src/components/entrada/porta-de-entrada.tsx`). O `SIGNED_IN` do
   * listener não serve para isso — dispara a cada carga e a cada volta à aba.
   */
  sessionId: string | null;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /**
   * Outcome of resolving this user's account + role. Anything other
   * than `ready` means writes will be rejected — render
   * `<AccountAccessAlert />` (already mounted in the dashboard shell)
   * rather than letting the user discover it one failed save at a time.
   */
  accountStatus: AccountStatus;
  /** Underlying message when `accountStatus` is 'error' / 'unlinked'. */
  accountStatusDetail: string | null;
  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + assinatura. Null while loading. */
  account: AccountSummary | null;
  /** Assinatura ligada — só para a bolha otimista nascer certa. */
  assinaturaAtiva: boolean;
  /**
   * Dono da conta, para escrever em coluna `user_id` que CASCADE de
   * `auth.users` (contatos, conversas, campos personalizados). Nulo
   * enquanto carrega OU se o lookup da conta falhou — nesse caso a ação
   * tem de FALHAR, nunca cair para `user.id` (ver `AccountSummary`).
   */
  ownerUserId: string | null;
  /**
   * Perfil de acesso da pessoa (956), ou `null` para SEM RESTRIÇÃO.
   * ⚠️ Nulo nunca significa "não vê nada" — ver `@/lib/perfis/tipos`.
   */
  perfilDeAcesso: PerfilDeAcesso | null;
  /**
   * Papel + perfil no formato que `@/lib/perfis` consome. Use com
   * `podeVerTela` / `podeVerSecao` / `conversaNoEscopo` — nunca leia
   * `perfilDeAcesso.telas` direto, ou as travas (dono vê tudo, admin não
   * perde Configurações) ficam de fora.
   *
   * ⚠️ Durante `profileLoading` este valor é `{ papel: null, perfil: null }`,
   * e perfil nulo significa SEM RESTRIÇÃO — ou seja, `podeVerTela` responde
   * `true` para tudo enquanto carrega. Gate de menu/rota tem de conferir
   * `profileLoading` ANTES de decidir (fail-closed, como o `useCan` faz),
   * senão o item proibido pisca na tela a cada carga e some em seguida.
   */
  acesso: ContextoDeAcesso;
  /**
   * Simulação de perfil em curso NESTA ABA ("ver como" — só admin/dono; ver
   * `lib/perfis/simulacao.ts`). Enquanto ela dura, `accountRole`, `acesso`,
   * os `isX` e os `canX` são os do perfil simulado; `profile` continua
   * sendo o real. `papelReal` é o papel de quem está simulando.
   */
  simulacao: { perfil: PerfilDeAcesso; papelReal: AccountRole } | null;
  /** Passa a ver o CRM como o perfil dado. Ignorado fora de admin/dono. */
  simularPerfil: (perfilId: string) => void;
  encerrarSimulacao: () => void;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Attempts at the profile lookup, including the first. */
const PROFILE_FETCH_ATTEMPTS = 2;
const PROFILE_FETCH_RETRY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shape of the `profiles` select below. */
interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[] | null;
  account_id: string | null;
  account_role: string | null;
  perfil_id: string | null;
}

/** Shape do select em `cb_perfis_de_acesso` (o mesmo nos dois lugares). */
interface PerfilRow {
  id: string;
  account_id: string;
  nome: string;
  papel_base: PerfilDeAcesso["papel_base"];
  telas: string[] | null;
  secoes_config: string[] | null;
  channel_ids: string[] | null;
  pipeline_ids: string[] | null;
  sistema: boolean | null;
}

const PERFIL_SELECT =
  "id, account_id, nome, papel_base, telas, secoes_config, channel_ids, pipeline_ids, sistema";

/** Linha do banco → `PerfilDeAcesso`, descartando id de tela/seção que o app não conhece mais. */
function perfilDaLinha(row: PerfilRow): PerfilDeAcesso {
  return {
    id: row.id,
    account_id: row.account_id,
    nome: row.nome,
    papel_base: row.papel_base,
    // O array não tem FK e uma rota removida deixa lixo para trás.
    telas: (row.telas ?? []).filter(ehTelaConhecida),
    secoes_config: (row.secoes_config ?? []).filter(ehSecaoConhecida),
    channel_ids: row.channel_ids ?? [],
    pipeline_ids: row.pipeline_ids ?? [],
    sistema: Boolean(row.sistema),
  };
}

/** O que fica na aba: o perfil simulado E quem o ligou. */
interface SimulacaoGravada {
  perfil: string;
  usuario: string;
}

/**
 * ⚠️ Amarrada ao USUÁRIO que a ligou. A chave vive na aba, e a aba
 * sobrevive à sessão: um SIGNED_OUT vindo de outra aba (ou de sessão
 * invalidada) não passa pelo `signOut` daqui, e outra pessoa da mesma conta
 * entrando nesta aba herdaria a lente do anterior (Codex, PR #118). Com o
 * id gravado junto, a chave de outra pessoa é simplesmente ignorada — e o
 * ramo de saída do listener a limpa de qualquer forma.
 */
function lerSimulacaoDaAba(): SimulacaoGravada | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_DA_SIMULACAO);
    if (!bruto) return null;
    const o = JSON.parse(bruto) as Partial<SimulacaoGravada> | null;
    return o && typeof o.perfil === "string" && typeof o.usuario === "string"
      ? { perfil: o.perfil, usuario: o.usuario }
      : null;
  } catch {
    return null;
  }
}

function gravarSimulacaoNaAba(valor: SimulacaoGravada | null) {
  try {
    if (valor) {
      window.sessionStorage.setItem(CHAVE_DA_SIMULACAO, JSON.stringify(valor));
    } else {
      window.sessionStorage.removeItem(CHAVE_DA_SIMULACAO);
    }
  } catch {
    // Aba sem storage (modo privado restrito): a simulação vale até o reload.
  }
}

/** Teto para a linha do perfil simulado chegar; passado isso, a simulação cai. */
const SIMULACAO_TIMEOUT_MS = 8_000;

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getSession() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Só a mensagem de erro do "Sair"; o provider vive sob o NextIntlClientProvider do layout raiz.
  const t = useTranslations("DashboardShell");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // ⚠️ `null` = SEM RESTRIÇÃO, nunca "não vê nada". É o estado de todo mundo
  // até a Fase 5 e o destino de quem teve o perfil apagado (ON DELETE SET
  // NULL na 956).
  const [perfilDeAcesso, setPerfilDeAcesso] = useState<PerfilDeAcesso | null>(
    null,
  );
  // Simulação de perfil ("ver como"): o ID vive no sessionStorage desta aba;
  // a LINHA é buscada de novo a cada montagem, para a lente refletir o perfil
  // como ele está hoje. Linha de outro id (troca rápida de alvo) é ignorada
  // na leitura, então não há reset síncrono a fazer aqui.
  const [simulacaoGravada, setSimulacaoGravada] =
    useState<SimulacaoGravada | null>(() => lerSimulacaoDaAba());
  const [perfilSimulado, setPerfilSimulado] = useState<PerfilDeAcesso | null>(
    null,
  );
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Why the account/role couldn't be established, when it couldn't.
  // Null on the happy path.
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  // Tracked separately from `loading`. The session settles fast (one
  // local cookie read); the profile fetch crosses the network and
  // settles later. Callers that gate on `profile.*` need to know which
  // window they're in — see the type doc above.
  const [profileLoading, setProfileLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Tracks the user ID we've successfully initiated/completed fetching
  // a profile for. This prevents redundant re-fetches and toggling
  // profileLoading back to true on window focus events/token refresh.
  const lastFetchedUserIdRef = useRef<string | null>(null);

  // ⚠️ Quem já teve UMA resolução de profile nesta sessão. É o que impede o
  // refreshProfile() (salvar nome/avatar, retry do alerta) de reerguer
  // `profileLoading` — o dashboard-shell gateia a TELA INTEIRA nele, então
  // cada recarga trocava o app por spinner e REMONTAVA a página, perdendo
  // rolagem, seleção e rascunho (ledger 48h). A recarga do MESMO usuário
  // atualiza por baixo do app montado; pessoa DIFERENTE (troca de sessão na
  // mesma aba) volta a gatear, senão o acesso de A pintaria sob o login de B.
  const resolvedUserIdRef = useRef<string | null>(null);

  // Shared across init, auth-state-change listener, and the exposed
  // refreshProfile() callback. Reads the current session's user id and
  // pulls the matching profile row along with its account summary.
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    // Ver `resolvedUserIdRef`: só a PRIMEIRA resolução de cada pessoa gateia
    // a tela. Recarga do mesmo usuário roda com o app montado.
    if (resolvedUserIdRef.current !== userId) setProfileLoading(true);
    setStatusDetail(null);
    lastFetchedUserIdRef.current = userId;
    try {
      let data: ProfileRow | null = null;
      for (let attempt = 1; ; attempt++) {
        const result = await supabase
          .from("profiles")
          .select(
            "id, full_name, email, avatar_url, role, beta_features, account_id, account_role, perfil_id",
          )
          .eq("user_id", userId)
          .maybeSingle();

        if (!result.error) {
          data = result.data;
          break;
        }

        const error = result.error;
        console.error("[AuthProvider] fetchProfile error:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        // One hiccup here used to lock the session read-only for good:
        // the profile stayed null, so every `useCan` gate answered
        // false and no page offered a way to recover (issue #471).
        // Retry, then hand the reason to the UI.
        if (attempt < PROFILE_FETCH_ATTEMPTS) {
          await sleep(PROFILE_FETCH_RETRY_MS);
          continue;
        }
        lastFetchedUserIdRef.current = null;
        setStatusDetail(error.message);
        return;
      }

      if (data) {
        // Load the account with a plain lookup by id instead of an
        // embedded FK join. The embed (`account:accounts!inner(...)`)
        // forces PostgREST to resolve the profiles.account_id →
        // accounts.id relationship from its schema cache; a stale cache
        // (common right after a migration adds the FK) makes it fail
        // hard with PGRST200 and blanks the whole profile — the user
        // then loses account context everywhere (issue #294). A point
        // lookup by id needs no relationship inference, so the profile
        // (with account_id / account_role) still resolves even if the
        // account name lookup itself can't.
        let accountRow: AccountSummary | null = null;
        if (data.account_id) {
          const { data: account, error: accountErr } = await supabase
            .from("accounts")
            .select("id, name, assinatura_ativa, owner_user_id")
            .eq("id", data.account_id)
            .maybeSingle();
          if (accountErr) {
            console.error("[AuthProvider] fetchAccount error:", {
              message: accountErr.message,
              details: accountErr.details,
              hint: accountErr.hint,
              code: accountErr.code,
            });
          } else if (account) {
            accountRow = {
              id: account.id,
              name: account.name,
              assinatura_ativa: Boolean(account.assinatura_ativa),
              owner_user_id: account.owner_user_id,
            };
          }
        }

        // ------------------------------------------------------------
        // Perfil de acesso (956). Consulta separada, pelo mesmo motivo do
        // lookup da conta acima: embed obriga o PostgREST a resolver a FK
        // pelo cache de schema, e cache velho — comum logo depois da
        // migration que cria a FK — falharia com PGRST200 e apagaria o
        // perfil inteiro.
        //
        // ⚠️ FALHA ABERTA de propósito: erro aqui deixa `perfil` nulo, que
        // significa "sem restrição". O oposto deixaria a pessoa sem menu
        // nenhum por causa de um hiccup de rede, que é a forma da issue
        // #471 (perfil nulo travando a sessão inteira em read-only). E
        // lembrar do que este recorte é: organização de visão, não
        // segurança — não há RLS por área para ele contradizer.
        let perfilRow: PerfilDeAcesso | null = null;
        if (data.perfil_id) {
          const { data: perfilData, error: perfilErr } = await supabase
            .from("cb_perfis_de_acesso")
            .select(PERFIL_SELECT)
            .eq("id", data.perfil_id)
            .maybeSingle();
          if (perfilErr) {
            console.error("[AuthProvider] fetchPerfil error:", {
              message: perfilErr.message,
              code: perfilErr.code,
            });
          } else if (perfilData) {
            perfilRow = perfilDaLinha(perfilData);
          }
        }
        setPerfilDeAcesso(perfilRow);

        // Narrow the DB enum into our AccountRole union. The DB
        // constraint should make this unconditional, but a future
        // migration that broadens the enum without updating TS would
        // otherwise crash here — fall back to null and let UI gates
        // treat the caller as least-privileged.
        const accountRole = isAccountRole(data.account_role)
          ? data.account_role
          : null;

        setProfile({
          id: data.id,
          full_name: data.full_name,
          email: data.email,
          avatar_url: data.avatar_url,
          role: data.role,
          // `beta_features` is `NOT NULL DEFAULT ARRAY[]` in the DB, but
          // narrow defensively in case the column hasn't been migrated yet
          // (older deployments running 011 lazily) — `null` reads as no
          // opt-ins, which is the safe default for any future beta gate.
          beta_features: data.beta_features ?? [],
          account_id: data.account_id ?? null,
          account_role: accountRole,
        });
        setAccount(accountRow);
        if (!data.account_id || !accountRole) {
          // The row exists but carries no tenancy. Migration 017 made
          // both columns NOT NULL for new signups, so this is a user
          // whose bootstrap didn't complete (handle_new_user swallows a
          // failure as a WARNING) or one predating that migration.
          // Every insert and update they attempt will be denied by RLS.
          setStatusDetail(
            `profile ${data.id} has no ${!data.account_id ? "account_id" : "account_role"}`,
          );
        }
      } else {
        lastFetchedUserIdRef.current = null;
        setStatusDetail("no profiles row for the signed-in user");
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
      lastFetchedUserIdRef.current = null;
      setStatusDetail(err instanceof Error ? err.message : "profile fetch failed");
    } finally {
      // Resolvido INCLUSIVE em falha: o gate já caía aqui de qualquer jeito
      // (fail-open documentado do shell), e um retry do alerta não deve
      // trocar a tela por spinner — o AccountAccessAlert é quem narra.
      resolvedUserIdRef.current = userId;
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn("[AuthProvider] getSession() timed out after 3s");
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) console.error("[AuthProvider] getSession error:", error.message);

        if (!mounted) return;
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setSessionId(sessionIdDoToken(session?.access_token));

        if (currentUser) {
          // Don't block session loading on profile fetch — chrome
          // (header, sidebar) can render from the user object alone,
          // profile enriches async. Callers that need to branch on
          // profile data gate on `profileLoading` instead.
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load. Flip profileLoading off so
          // pages that gate on it don't wait forever on the logged-out
          // path (the route guard or redirect should fire instead).
          setProfileLoading(false);
        }
      } catch (err) {
        console.error("[AuthProvider] init threw:", err);
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setSessionId(sessionIdDoToken(session?.access_token));

      if (currentUser) {
        if (currentUser.id !== lastFetchedUserIdRef.current) {
          fetchProfile(currentUser.id);
        }
      } else {
        lastFetchedUserIdRef.current = null;
        // Sem isto, sair e entrar DE NOVO como a mesma pessoa pulava o gate
        // (ref ainda lembrava a resolução antiga sobre profile já nulado) e
        // o shell pintava o flash fail-open que o gate existe para matar.
        resolvedUserIdRef.current = null;
        setProfile(null);
        setAccount(null);
        setPerfilDeAcesso(null);
        // Qualquer saída (outra aba, sessão invalidada) apaga a lente.
        gravarSimulacaoNaAba(null);
        setSimulacaoGravada(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    // ⚠️ Só DESTE aparelho (decisão D4 do plano Meu dia, 12/09/2026). Até
    // aqui era `signOut()` sem escopo — GLOBAL na biblioteca, e o "Sair" do
    // computador derrubava o celular sem ninguém ter decidido isso. "Sair de
    // todos os aparelhos" continua em Configurações → Segurança. O helper
    // devolve o erro: um signOut que falha por rede NÃO apaga a sessão do
    // cookie, e navegar para /login assim formaria o laço /login → /dashboard.
    const resultado = await sairDesteAparelho(supabase.auth);
    if (!resultado.ok) {
      toast.error(t("signOutError", { message: resultado.erro }));
      return;
    }
    setUser(null);
    setProfile(null);
    setAccount(null);
    setPerfilDeAcesso(null);
    // A lente não pode sobreviver à troca de pessoa na mesma aba.
    gravarSimulacaoNaAba(null);
    setSimulacaoGravada(null);
    resolvedUserIdRef.current = null;
    window.location.href = "/login";
  }, [t]);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  // A lente só vale para quem a ligou (ver `lerSimulacaoDaAba`); enquanto o
  // `user` não resolve, não há simulação a buscar.
  const simulacaoId =
    simulacaoGravada && user?.id === simulacaoGravada.usuario
      ? simulacaoGravada.perfil
      : null;

  // A linha do perfil simulado. Qualquer membro lê `cb_perfis_de_acesso`
  // (policy da 956), então a busca vale para o admin que simula. Perfil que
  // sumiu, erro ou demora além do teto DERRUBAM a simulação e limpam a chave
  // — uma chave presa faria toda montagem futura esperar por nada.
  useEffect(() => {
    if (!simulacaoId) return;
    let encerrado = false;
    const desistir = (motivo: string) => {
      if (encerrado) return;
      encerrado = true;
      console.warn(`[AuthProvider] simulação de perfil encerrada: ${motivo}`);
      gravarSimulacaoNaAba(null);
      setSimulacaoGravada(null);
    };
    const timer = setTimeout(
      () => desistir("a linha do perfil não chegou a tempo"),
      SIMULACAO_TIMEOUT_MS,
    );
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cb_perfis_de_acesso")
        .select(PERFIL_SELECT)
        .eq("id", simulacaoId)
        .maybeSingle();
      if (encerrado) return;
      clearTimeout(timer);
      if (error || !data) {
        desistir(error ? error.message : "perfil não existe mais");
        return;
      }
      setPerfilSimulado(perfilDaLinha(data));
    })();
    return () => {
      encerrado = true;
      clearTimeout(timer);
    };
  }, [simulacaoId]);

  const simularPerfil = useCallback(
    (perfilId: string) => {
      // Guarda de ESCALADA no cliente: só admin/dono começa uma simulação. O
      // provider ignora a chave de qualquer forma (`resolverAcesso`); aqui é
      // para nem gravá-la.
      if (!user || !podeSimular(profile?.account_role ?? null)) return;
      const valor = { perfil: perfilId, usuario: user.id };
      gravarSimulacaoNaAba(valor);
      setSimulacaoGravada(valor);
    },
    [user, profile?.account_role],
  );

  const encerrarSimulacao = useCallback(() => {
    gravarSimulacaoNaAba(null);
    setSimulacaoGravada(null);
  }, []);

  // A linha só vale para o id em vigor: troca rápida de alvo não pode deixar
  // a resposta atrasada vencer a intenção nova.
  const perfilSimuladoEmVigor =
    simulacaoId !== null && perfilSimulado?.id === simulacaoId
      ? perfilSimulado
      : null;
  // Há simulação pedida e a linha ainda não chegou: o app espera, em vez de
  // pintar a visão do admin e trocar para a do perfil um instante depois.
  const simulacaoPendente = simulacaoId !== null && perfilSimuladoEmVigor === null;

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const papelReal = profile?.account_role ?? null;
    const accountId = profile?.account_id ?? null;
    const real = { papel: papelReal, perfil: perfilDeAcesso } satisfies ContextoDeAcesso;
    // ⚠️ Daqui para baixo TUDO deriva do acesso EFETIVO — o simulado quando
    // há simulação honrada, o real caso contrário. É o que faz menu, seções,
    // recortes e botões seguirem a lente sem que nenhum consumidor saiba
    // que ela existe. Ver `lib/perfis/simulacao.ts`.
    const { acesso, simulado } = resolverAcesso(real, perfilSimuladoEmVigor, accountId);
    const role = acesso.papel;
    return {
      accountRole: role,
      accountId,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
      acesso,
      simulacao:
        simulado && papelReal ? { perfil: simulado, papelReal } : null,
    };
  }, [profile?.account_role, profile?.account_id, perfilDeAcesso, perfilSimuladoEmVigor]);

  // Signed out is not a broken account — the shell redirects to /login
  // before anything reads this.
  const accountStatus: AccountStatus = !user
    ? "loading"
    : profileLoading
      ? "loading"
      : !profile
        ? "error"
        : derived.accountId && derived.accountRole
          ? "ready"
          : "unlinked";

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        sessionId,
        // A simulação pendente entra aqui de propósito: o shell troca a tela
        // por spinner e REMONTA a página quando isto é true — para começar
        // a ver como outro perfil, é exatamente o que se quer (a app
        // "recarrega" já na lente), e evita o flash da visão do admin.
        profileLoading: profileLoading || simulacaoPendente,
        signOut,
        refreshProfile,
        simularPerfil,
        encerrarSimulacao,
        perfilDeAcesso,
        account,
        assinaturaAtiva: account?.assinatura_ativa ?? false,
        ownerUserId: account?.owner_user_id ?? null,
        accountStatus,
        accountStatusDetail: statusDetail,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      sessionId: null,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      // ⚠️ Fora do provider o perfil é nulo = SEM RESTRIÇÃO, ao contrário do
      // resto deste fallback, que fecha em falso. Não é descuido: as telas
      // que fazem o recorte só renderizam DENTRO do provider, e fechar aqui
      // esconderia menu de quem está no meio de uma montagem. A barreira
      // real de escrita continua sendo o papel, que segue nulo abaixo.
      perfilDeAcesso: null,
      acesso: { papel: null, perfil: null },
      simulacao: null,
      simularPerfil: () => {},
      encerrarSimulacao: () => {},
      // Fecha em falso como todo o resto do fallback: sem provider a bolha
      // nasce sem assinatura, e o servidor decide.
      assinaturaAtiva: false,
      // Nulo = os escritores de contato/conversa/campo falham fechado.
      ownerUserId: null,
      // Outside the provider there is nothing to resolve yet — 'loading'
      // keeps the access alert from firing on, say, the login page.
      accountStatus: "loading",
      accountStatusDetail: null,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
